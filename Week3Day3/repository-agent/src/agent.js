import { chat } from "./ollama.js";
import { logToolCall } from "./logger.js";
import { listProjectFiles } from "./tools/listProjectFiles.js";
import { searchProjectFiles, ToolValidationError } from "./tools/searchProjectFiles.js";
import { readProjectFile } from "./tools/readProjectFile.js";
import { PathSecurityError } from "./security/validatePath.js";

const MAX_STEPS = 8;

export const SYSTEM_PROMPT = `You are a repository investigation agent.

Your job is to answer engineering questions using evidence from the
provided repository. You do not have the repository's contents memorized -
you must look at it using your tools.

Rules:
- Use tools when repository information is required to answer accurately.
- For general knowledge questions unrelated to this repository (e.g. "what
  does HTTP 401 mean?"), answer directly without using any tool.
- Do not invent file names, code, or project behaviour you have not
  actually observed through a tool result.
- Prefer search_project_files before read_project_file, and prefer reading
  a few targeted files over many.
- Only the three tools you are given exist. There is no tool to create,
  modify, or delete files - if asked to change the repository, say plainly
  that you only have read-only access and cannot do that.
- Stop calling tools once you have enough evidence to answer.
- Base your final answer only on files you actually inspected with
  read_project_file. If you reference a file, you must have read it.
- When helpful, end your final answer with a short "Files inspected:" list
  of the paths you read.
- IMPORTANT: When you decide a tool is needed, actually call it through the
  tool-calling mechanism. Never just describe a tool call in plain text
  (e.g. do not write "I will call read_project_file on x.js" as your
  response) - either make the call or give your complete final answer.`;

/** Tool definitions in the schema Ollama's /api/chat "tools" field expects. */
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_project_files",
      description:
        "List every approved file inside the sample project repository. Takes no arguments. " +
        "Use this first when you don't yet know what files exist.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_project_files",
      description:
        "Search all approved project files for a word or phrase and return which files contain " +
        "it and how many times. Use this to narrow down which files are relevant before reading " +
        "whole files - much cheaper than reading everything.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'The word or phrase to search for, e.g. "authentication" or "JWT".',
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_project_file",
      description:
        "Read the full contents of one approved project file, given its path exactly as returned " +
        "by list_project_files or search_project_files (e.g. \"src/services/authService.js\"). " +
        "Cannot read .env or any other blocked/sensitive file, or anything outside the project.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: 'Relative path of the file to read, e.g. "src/services/authService.js".',
          },
        },
        required: ["filePath"],
      },
    },
  },
];

/** Terminal, expected stopping conditions - not application errors. */
export class DuplicateToolCallError extends Error {}
export class MaxStepsError extends Error {}

/**
 * Runs the agent loop for one engineering goal until the model returns a
 * final answer (no tool_calls) or a safety limit stops it.
 *
 * Returns { answer, filesInspected, log, stopped } where `stopped` is
 * null on a normal finish, or "duplicate_call" / "max_steps" when a
 * safety rule ended the run early.
 */
export async function runAgent(goal) {
  if (typeof goal !== "string" || !goal.trim()) {
    throw new Error("A non-empty goal is required.");
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: goal.trim() },
  ];

  const previousCalls = new Set();
  const filesInspected = new Set();
  const log = [];
  let nudgeCount = 0;
  const MAX_NUDGES = 2;

  try {
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const message = await chat(messages, { tools: TOOL_DEFS });

      // Small local models don't always emit the structured tool_calls
      // field - some turns come back as plain text containing a JSON tool
      // request instead (e.g. `{"name": "read_project_file", ...}` inside
      // `content`). Fall back to parsing that before giving up and
      // treating the turn as a final answer.
      const toolCalls = message.tool_calls?.length
        ? message.tool_calls
        : extractFallbackToolCall(message.content);

      if (!toolCalls || toolCalls.length === 0) {
        // Some turns narrate an intended tool call in prose without
        // actually calling it and without emitting parseable JSON either
        // ("I will now read authService.js to check..."). Rather than
        // treating that half-finished plan as the final answer, nudge the
        // model to actually act - bounded so it can't stall forever.
        if (nudgeCount < MAX_NUDGES && step < MAX_STEPS && looksLikeUnfinishedPlan(message.content)) {
          nudgeCount += 1;
          messages.push({ role: "assistant", content: message.content || "" });
          messages.push({
            role: "user",
            content:
              "You described using a tool in words instead of actually calling it. " +
              "Call the appropriate tool now, or give your complete final answer if you " +
              "already have enough evidence.",
          });
          continue;
        }

        return {
          answer: stripSelfReportedFileList(message.content?.trim()) ||
            "The agent finished without producing an answer.",
          filesInspected: [...filesInspected],
          log,
          stopped: null,
        };
      }

      // Keep the assistant's tool-call turn in history so the model can
      // see its own prior requests, then let it see each tool's result.
      messages.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });

      for (const call of toolCalls) {
        const name = call.function?.name;
        const args = normalizeToolArgs(name, parseArgs(call.function?.arguments));
        const callKey = `${name}:${JSON.stringify(args)}`;

        if (previousCalls.has(callKey)) {
          throw new DuplicateToolCallError("Repeated tool call detected.");
        }
        previousCalls.add(callKey);

        const entry = { step, tool: name, arguments: args, status: "success" };
        let result;

        try {
          result = await executeTool(name, args);
          if (name === "read_project_file" && result?.file) {
            filesInspected.add(result.file);
          }
        } catch (err) {
          entry.status = err instanceof PathSecurityError ? "denied" : "error";
          entry.error = err.message;
          result = { error: true, message: err.message };
        }

        log.push(entry);
        logToolCall(entry);

        messages.push({ role: "tool", name, content: JSON.stringify(result) });
      }
    }

    throw new MaxStepsError("Agent reached the maximum number of steps.");
  } catch (err) {
    if (err instanceof DuplicateToolCallError) {
      return { answer: err.message, filesInspected: [...filesInspected], log, stopped: "duplicate_call" };
    }
    if (err instanceof MaxStepsError) {
      return { answer: err.message, filesInspected: [...filesInspected], log, stopped: "max_steps" };
    }
    throw err;
  }
}

async function executeTool(name, args) {
  switch (name) {
    case "list_project_files":
      return await listProjectFiles();
    case "search_project_files":
      return await searchProjectFiles(args?.query);
    case "read_project_file":
      return await readProjectFile(args?.filePath);
    default:
      throw new ToolValidationError(`Unknown tool "${name}".`);
  }
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

const KNOWN_TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.function.name));

/**
 * The model's own trailing "Files inspected: ..." list is not reliable -
 * it sometimes lists files it only searched, not files it actually read
 * with read_project_file. Strip it; the caller shows the deterministic
 * `filesInspected` list (built from real tool results) instead.
 */
function stripSelfReportedFileList(content) {
  if (!content) return content;
  return content.replace(/\n+files?\s+inspected:?[\s\S]*$/i, "").trim();
}

/** Heuristic: does this look like "I will read/search X" rather than a completed answer? */
function looksLikeUnfinishedPlan(content) {
  if (typeof content !== "string" || !content.trim()) return false;
  const statesIntent = /\b(i will|i'll|i need to|let me|i am going to|i'm going to)\b/i;
  const mentionsAction = /\b(read|search|list|inspect|look at|check)\b/i;
  return statesIntent.test(content) && mentionsAction.test(content);
}

/**
 * Some local models, on some turns, ignore the structured tool-calling
 * protocol and instead write a JSON tool request directly into the
 * message content, e.g.:
 *   {"name": "read_project_file", "parameters": {"file_path": "..."}}
 * This recovers that intent so the agent loop doesn't misread it as a
 * final answer. Returns null (falls through to "final answer") if no
 * recognizable tool call is found.
 */
function extractFallbackToolCall(content) {
  if (typeof content !== "string" || !content.includes("{")) return null;

  // A model can emit more than one JSON-looking blob in one turn (e.g. a
  // fabricated tool call immediately followed by a fabricated "result").
  // Check every top-level object and use the first one that actually
  // names a known tool, rather than blindly trusting whichever comes first.
  for (const parsed of extractJsonObjects(content)) {
    if (!parsed || typeof parsed !== "object") continue;

    const name = parsed.name || parsed.tool || parsed.tool_name || parsed.function?.name;
    if (typeof name !== "string" || !KNOWN_TOOL_NAMES.has(name)) continue;

    const rawArgs = parsed.parameters ?? parsed.arguments ?? parsed.input ?? parsed.function?.arguments ?? {};
    return [{ function: { name, arguments: rawArgs } }];
  }

  return null;
}

/** Finds and parses every balanced top-level {...} object in a string, in order. */
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

    if (end === -1) break; // unbalanced from here on - stop

    try {
      objects.push(JSON.parse(text.slice(i, end + 1)));
    } catch {
      // not valid JSON - ignore and keep scanning past it
    }

    i = text.indexOf("{", end + 1);
  }

  return objects;
}

/** Maps common argument-name variants small models use onto the exact key each tool expects. */
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
    // Drop every alias key once resolved, so logs/callKeys show one clean field.
    for (const alias of aliases) {
      if (alias !== canonical) delete normalized[alias];
    }
  }
  return normalized;
}
