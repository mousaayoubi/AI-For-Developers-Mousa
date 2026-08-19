/**
 * Repository investigation agent (Part 9/10/11/15). Runs a multi-step
 * tool-calling loop against the MCP-backed repository tools until the
 * model returns a final answer, or a safety limit stops it. The exact
 * sequence of tool calls is never hard-coded - the model decides what to
 * call next based on prior results (kept in short-term memory).
 */
import { chat, newMetrics } from "../ollama.js";
import { executeTool, TOOL_DEFS, ToolBlockedError, UnknownToolError, McpUnavailableError } from "./tools.js";
import { createMemory, isDuplicateCall, recordToolCall } from "./memory.js";
import { guardrails } from "../security/guardrails.js";

export const SYSTEM_PROMPT = `You are a repository investigation agent.

Your job is to answer engineering questions using evidence from the
provided repository. You do not have the repository's contents memorized -
you must look at it using your tools.

Rules:
- Use tools when repository information is required to answer accurately.
- Prefer search_project_files before read_project_file, and prefer reading
  a few targeted files over many.
- When search results include both source code files (under src/, e.g.
  services/, middleware/, routes/, repositories/) and documentation files
  (e.g. architecture.md, README.md), read the actual source code files
  before answering - documentation describes intent, not the real
  implementation. Do not rely on architecture.md alone to explain how code
  works.
- A file path you only saw mentioned in another file's prose (e.g. a
  directory listing inside README.md) is not evidence of what that file
  contains. Before naming it in your final answer, confirm it with
  list_project_files/search_project_files or open it directly - do not
  answer a "which file/module does X" question from a README structure
  list alone.
- A thin routing/controller file (typically under src/routes/) rarely
  contains the real implementation of what it delegates to. If a file you
  read requires()/imports another project module (a service, middleware,
  or repository file) that is directly relevant to the question, read that
  module too before concluding your investigation - don't stop at the
  first file just because it mentions the right topic.
- Only the three tools you are given exist. There is no tool to create,
  modify, or delete files - if asked to change the repository, say plainly
  that you only have read-only access and cannot do that.
- Never ask to read ".env" or any file outside the project - those requests
  will always be rejected, and you should not keep retrying them.
- Stop calling tools once you have enough evidence to answer.
- Base your final answer only on files you actually inspected with
  read_project_file. Do not name a specific file in your final answer, or
  describe what it contains or does, unless you called read_project_file
  on that exact file in this run - do not guess at what a file contains
  from its name or from another file mentioning it.
- When helpful, end your final answer with a short "Files inspected:" list
  of the paths you read.
- IMPORTANT: When you decide a tool is needed, actually call it through the
  tool-calling mechanism. Never just describe a tool call in plain text -
  either make the call or give your complete final answer.`;

export class DuplicateToolCallError extends Error {}
export class MaxStepsError extends Error {}
export class MaxToolCallsError extends Error {}

/**
 * Runs the agent loop for one engineering goal.
 *
 * @param {string} goal
 * @param {object} [options] { metrics } - an ollama.js newMetrics() accumulator, extended with agentSteps/toolCalls.
 * @returns {Promise<{ answer: string, filesInspected: string[], filesSearched: string[], toolsUsed: string[], log: object[], stopped: string|null, flagged: boolean }>}
 */
export async function runAgent(goal, options = {}) {
  if (typeof goal !== "string" || !goal.trim()) {
    throw new Error("A non-empty goal is required.");
  }

  const metrics = options.metrics || newMetrics();
  metrics.agentSteps = 0;
  metrics.toolCalls = 0;

  const memory = createMemory(SYSTEM_PROMPT, goal.trim());
  const log = [];
  let nudgeCount = 0;
  const MAX_NUDGES = 3;

  try {
    for (let step = 1; step <= guardrails.maxAgentSteps; step += 1) {
      memory.steps = step;
      metrics.agentSteps = step;
      const message = await chat(memory.messages, { tools: TOOL_DEFS, metrics });

      const toolCalls = message.tool_calls?.length
        ? message.tool_calls
        : extractFallbackToolCall(message.content);

      if (!toolCalls || toolCalls.length === 0) {
        if (nudgeCount < MAX_NUDGES && step < guardrails.maxAgentSteps && looksLikeUnfinishedPlan(message.content)) {
          nudgeCount += 1;
          memory.messages.push({ role: "assistant", content: message.content || "" });
          memory.messages.push({
            role: "user",
            content:
              "You described using a tool in words instead of actually calling it. " +
              "Call the appropriate tool now, or give your complete final answer if you " +
              "already have enough evidence.",
          });
          continue;
        }

        // Evidence-first nudge: the model found a plausible file via search
        // but is about to state facts about it without ever opening it.
        // Push it to actually read the file rather than accept a claim
        // that has no read_project_file evidence behind it yet (Part 15) -
        // cheaper and more useful than flagging it after the fact.
        const unverifiedMentions = findUnverifiedFileMentions(message.content || "", memory);
        if (nudgeCount < MAX_NUDGES && step < guardrails.maxAgentSteps && unverifiedMentions.length > 0) {
          nudgeCount += 1;
          memory.messages.push({ role: "assistant", content: message.content || "" });
          memory.messages.push({
            role: "user",
            content:
              `You named ${unverifiedMentions.join(", ")} but have not opened ${unverifiedMentions.length > 1 ? "them" : "it"} ` +
              `with read_project_file yet. Read ${unverifiedMentions.length > 1 ? "them" : "it"} now to confirm before finalizing your answer.`,
          });
          continue;
        }

        // Delegation-chain nudge: a file the agent actually read requires()/
        // imports another project module it never opened. Rather than
        // hard-coding "read authService after authRoutes", this is read
        // straight off the require()/import statements in whatever file the
        // model happened to read, so it generalizes to any thin
        // routing/controller file that delegates elsewhere (Part 15 follow-up).
        const unreadReferences = [...memory.referencedFiles].filter((f) => !memory.filesRead.has(f));
        if (nudgeCount < MAX_NUDGES && step < guardrails.maxAgentSteps && unreadReferences.length > 0) {
          nudgeCount += 1;
          memory.messages.push({ role: "assistant", content: message.content || "" });
          memory.messages.push({
            role: "user",
            content:
              `The file(s) you read delegate to ${unreadReferences.join(", ")}, which you have not opened. ` +
              `If it's relevant to the question, read it before finalizing your answer - a thin routing/controller ` +
              `file usually isn't where the real implementation lives.`,
          });
          continue;
        }

        const rawAnswer = stripSelfReportedFileList(message.content?.trim()) ||
          "The agent finished without producing an answer.";
        const { answer, flagged } = validateAgainstEvidence(rawAnswer, memory);

        return {
          answer,
          filesInspected: [...memory.filesRead],
          filesSearched: [...memory.filesSearched],
          toolsUsed: [...new Set(memory.toolsUsed)],
          log,
          stopped: null,
          flagged,
        };
      }

      memory.messages.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });

      for (const call of toolCalls) {
        const name = call.function?.name;
        const args = normalizeToolArgs(name, parseArgs(call.function?.arguments));

        if (isDuplicateCall(memory, name, args)) {
          throw new DuplicateToolCallError(
            "Repeated tool call detected - stopping to avoid an unproductive loop."
          );
        }
        if (metrics.toolCalls >= guardrails.maxToolCalls) {
          throw new MaxToolCallsError("Maximum tool call limit reached.");
        }
        metrics.toolCalls += 1;

        const entry = { step, tool: name, arguments: args, status: "success" };
        let result;

        try {
          result = await executeTool(name, args, metrics);
        } catch (err) {
          if (err instanceof McpUnavailableError) {
            // Part 12: MCP failure - stop investigating rather than let
            // the model pretend repository access succeeded.
            entry.status = "mcp_unavailable";
            entry.error = err.message;
            log.push(entry);
            recordToolCall(memory, { name, args, result: null, status: entry.status });
            return {
              answer:
                "I could not complete this investigation: the repository MCP server became " +
                "unavailable and a retry also failed. I am stopping rather than guessing at " +
                "repository contents I was not able to verify.",
              filesInspected: [...memory.filesRead],
              filesSearched: [...memory.filesSearched],
              toolsUsed: [...new Set(memory.toolsUsed)],
              log,
              stopped: "mcp_unavailable",
              flagged: false,
            };
          }
          entry.status = err instanceof ToolBlockedError ? "denied" : err instanceof UnknownToolError ? "unknown_tool" : "error";
          entry.error = err.message;
          result = { error: true, message: err.message };
        }

        recordToolCall(memory, { name, args, result, status: entry.status });
        log.push(entry);

        memory.messages.push({ role: "tool", name, content: JSON.stringify(result) });
      }
    }

    throw new MaxStepsError("Agent reached the maximum number of steps.");
  } catch (err) {
    if (err instanceof DuplicateToolCallError) {
      const { answer, flagged } = await bestEffortAnswer(
        memory,
        "a repeated tool call was detected, which usually means the investigation stopped converging",
        metrics
      );
      return {
        answer,
        filesInspected: [...memory.filesRead],
        filesSearched: [...memory.filesSearched],
        toolsUsed: [...new Set(memory.toolsUsed)],
        log,
        stopped: "duplicate_call",
        flagged,
      };
    }
    if (err instanceof MaxStepsError || err instanceof MaxToolCallsError) {
      const limit = err instanceof MaxStepsError ? "the maximum number of investigation steps" : "the maximum number of tool calls";
      const { answer, flagged } = await bestEffortAnswer(memory, `${limit} for one request was reached`, metrics);
      return {
        answer,
        filesInspected: [...memory.filesRead],
        filesSearched: [...memory.filesSearched],
        toolsUsed: [...new Set(memory.toolsUsed)],
        log,
        stopped: err instanceof MaxStepsError ? "max_steps" : "max_tool_calls",
        flagged,
      };
    }
    throw err;
  }
}

/**
 * When a safety guardrail cuts the investigation short (duplicate call,
 * max steps, max tool calls), the agent may still have real evidence
 * sitting in `memory` - returning the guardrail's own error text as the
 * "answer" throws all of that away. This makes one last LLM call with no
 * `tools` passed (so it physically cannot trigger another tool call or
 * another duplicate) asking the model to answer from what's already in
 * the conversation, honestly caveated by why the investigation was cut
 * short, instead of surfacing an internal stop reason as if it were an
 * answer to the user's question.
 */
async function bestEffortAnswer(memory, reasonText, metrics) {
  memory.messages.push({
    role: "user",
    content:
      `Stop investigating now - ${reasonText}, so no more tools will be called. Using only the ` +
      "tool results already above in this conversation, give your best final answer to the " +
      "original question. If what you already read isn't enough to answer confidently, say so " +
      "plainly rather than guessing.",
  });

  try {
    const message = await chat(memory.messages, { metrics });
    const rawAnswer = stripSelfReportedFileList(message.content?.trim());
    if (!rawAnswer) {
      return { answer: fallbackText(reasonText), flagged: false };
    }
    return validateAgainstEvidence(rawAnswer, memory);
  } catch {
    return { answer: fallbackText(reasonText), flagged: false };
  }
}

function fallbackText(reasonText) {
  return `I had to stop investigating because ${reasonText}, and could not produce an answer from the evidence gathered so far.`;
}

/**
 * Finds file names mentioned in `content` that this run actually knows
 * exist (seen via a list/search result) but were never the target of a
 * successful read_project_file call. Only checking against known
 * filenames - rather than any "word.js"-shaped token - avoids
 * false-positives like "Express.js" or "Node.js", which are library names
 * rather than project files.
 */
function findUnverifiedFileMentions(content, memory) {
  const knownFiles = new Set([...memory.filesSearched, ...memory.filesRead]);
  const knownBaseNames = new Set([...knownFiles].map((f) => f.split("/").pop().toLowerCase()));

  const mentionedTokens = [...content.matchAll(/\b[\w./-]+\.(?:js|ts|md|json)\b/gi)].map((m) => m[0]);
  const mentionedFiles = new Set(
    mentionedTokens.filter((token) => knownBaseNames.has(token.split("/").pop().toLowerCase()))
  );

  return [...mentionedFiles].filter((mention) => {
    const bareName = mention.split("/").pop().toLowerCase();
    const wasRead = [...memory.filesRead].some((f) => f.split("/").pop().toLowerCase() === bareName);
    return !wasRead;
  });
}

/**
 * Part 15: Validate Final Responses. If the final answer names a file
 * that was never actually read via read_project_file, flag the response
 * instead of silently trusting the model's claim.
 */
function validateAgainstEvidence(answer, memory) {
  const unverified = findUnverifiedFileMentions(answer, memory);
  if (unverified.length === 0) return { answer, flagged: false };

  const note =
    `\n\n[Evidence check] This answer references file(s) not confirmed by a read_project_file ` +
    `call in this run: ${unverified.join(", ")}. Treat those specific claims with caution.`;
  return { answer: answer + note, flagged: true };
}

function parseArgs(rawArgs) {
  if (rawArgs == null) return {};
  if (typeof rawArgs === "object") return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function stripSelfReportedFileList(content) {
  if (!content) return content;
  return content.replace(/\n+files?\s+inspected:?[\s\S]*$/i, "").trim();
}

function looksLikeUnfinishedPlan(content) {
  if (typeof content !== "string" || !content.trim()) return false;
  const statesIntent = /\b(i will|i'll|i need to|let me|i am going to|i'm going to)\b/i;
  const mentionsAction = /\b(read|search|list|inspect|look at|check)\b/i;
  return statesIntent.test(content) && mentionsAction.test(content);
}

/**
 * Some local models occasionally write a JSON tool request directly into
 * message content instead of using the structured tool-calling protocol.
 * This recovers that intent. Returns null if nothing recognizable is found.
 */
function extractFallbackToolCall(content) {
  if (typeof content !== "string" || !content.includes("{")) return null;

  for (const parsed of extractJsonObjects(content)) {
    if (!parsed || typeof parsed !== "object") continue;
    const name = parsed.name || parsed.tool || parsed.tool_name || parsed.function?.name;
    if (typeof name !== "string") continue;
    if (!["list_project_files", "search_project_files", "read_project_file"].includes(name)) continue;
    const rawArgs = parsed.parameters ?? parsed.arguments ?? parsed.input ?? parsed.function?.arguments ?? {};
    return [{ function: { name, arguments: rawArgs } }];
  }
  return null;
}

function extractJsonObjects(text) {
  const objects = [];
  let i = text.indexOf("{");

  while (i !== -1) {
    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length; j += 1) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    try {
      objects.push(JSON.parse(text.slice(i, end + 1)));
    } catch {
      // ignore
    }
    i = text.indexOf("{", end + 1);
  }
  return objects;
}

const ARG_ALIASES = {
  read_project_file: { filePath: ["filePath", "file_path", "path", "file"] },
  search_project_files: { query: ["query", "q", "search", "text"] },
};

function normalizeToolArgs(name, args) {
  const aliasMap = ARG_ALIASES[name];
  if (!aliasMap || typeof args !== "object" || args === null) return args ?? {};

  const normalized = { ...args };
  for (const [canonical, aliases] of Object.entries(aliasMap)) {
    if (normalized[canonical] === undefined) {
      const alias = aliases.find((key) => normalized[key] !== undefined);
      if (alias) normalized[canonical] = normalized[alias];
    }
    for (const alias of aliases) {
      if (alias !== canonical) delete normalized[alias];
    }
  }
  return normalized;
}
