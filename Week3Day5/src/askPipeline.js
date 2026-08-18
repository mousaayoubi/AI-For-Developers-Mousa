/**
 * Core request pipeline: input validation -> router -> Direct LLM / RAG /
 * Agent -> output validation. Both server.js (HTTP) and
 * evaluation/evaluate.js (offline scoring) call this same function, so the
 * evaluation harness measures exactly the behaviour real users get instead
 * of a separate reimplementation.
 */
import { complete, newMetrics, OllamaUnavailableError, ModelUnavailableError, InvalidResponseError, TimeoutError } from "./ollama.js";
import { classifyRoute } from "./router.js";
import { retrieveTopChunks, buildContext } from "./rag/retrieve.js";
import { buildGroundedPrompt } from "./rag/prompts.js";
import { runAgent } from "./agent/agent.js";
import { McpUnavailableError } from "./mcp/client.js";
import { guardrails } from "./security/guardrails.js";

export class InputValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * Answers one question end to end.
 * @param {string} rawQuestion
 * @returns {Promise<object>} Everything server.js needs to respond and log.
 */
export async function answerQuestion(rawQuestion) {
  const totalStart = Date.now();
  const metrics = newMetrics();
  const timings = { routingMs: 0, retrievalMs: 0, mcpMs: 0, modelMs: 0, totalMs: 0 };

  const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
  if (!question) throw new InputValidationError('A non-empty "question" field is required.', "BAD_REQUEST");
  if (question.length > guardrails.maxInputLength) {
    throw new InputValidationError(`Question is too long (max ${guardrails.maxInputLength} characters).`, "INPUT_TOO_LONG");
  }

  const out = {
    route: null,
    answer: "",
    sources: [],
    toolsUsed: [],
    filesInspected: [],
    filesSearched: [],
    agentSteps: 0,
    fallbackUsed: false,
    flagged: false,
    stopped: null,
    success: true,
    errorCode: null,
  };

  try {
    const routeStart = Date.now();
    const { route } = await classifyRoute(question, { metrics });
    timings.routingMs = Date.now() - routeStart;
    out.route = route;

    if (route === "general") {
      const modelStart = Date.now();
      out.answer = await complete(buildGeneralPrompt(question), { metrics });
      timings.modelMs += Date.now() - modelStart;
    } else if (route === "documentation") {
      const retrievalStart = Date.now();
      const { chunks, usedFallback } = await retrieveTopChunks(question, { metrics });
      timings.retrievalMs = Date.now() - retrievalStart;
      out.fallbackUsed = usedFallback;

      const bestScore = chunks[0]?.score ?? 0;
      if (chunks.length === 0 || bestScore < guardrails.minRelevanceScore) {
        out.answer = "I could not find enough project documentation to confirm that.";
        out.sources = [];
      } else {
        const context = buildContext(chunks);
        const prompt = buildGroundedPrompt(context, question);
        const modelStart = Date.now();
        const rawAnswer = await complete(prompt, { metrics });
        timings.modelMs += Date.now() - modelStart;

        const { answer, sources } = splitAnswerAndSources(rawAnswer, chunks);
        out.answer = answer;
        out.sources = sources;
      }
    } else if (route === "repository") {
      const agentResult = await runAgent(question, { metrics });
      timings.modelMs += metrics.modelMs || 0;
      timings.mcpMs += metrics.mcpMs || 0;
      out.answer = agentResult.answer;
      out.toolsUsed = agentResult.toolsUsed;
      out.filesInspected = agentResult.filesInspected;
      out.filesSearched = agentResult.filesSearched;
      out.agentSteps = metrics.agentSteps || 0;
      out.stopped = agentResult.stopped;
      out.flagged = agentResult.flagged;
    } else {
      throw new Error(`Router produced an invalid route: ${route}`);
    }
  } catch (err) {
    out.success = false;
    const mapped = mapError(err);
    out.errorCode = mapped.code;
    out.answer = mapped.message;
  }

  timings.totalMs = Date.now() - totalStart;
  return { ...out, timings, metrics };
}

function buildGeneralPrompt(question) {
  return `You are a helpful, precise software engineering assistant. Answer the
following general engineering question directly and concisely, using your
own knowledge. Do not claim to have inspected any specific repository or
project - you have not.

Question:
${question}

Answer:`;
}

/**
 * Sources are computed deterministically from the chunks that were
 * actually retrieved and fed to the model as context (Part 6) - never
 * taken from the model's self-reported "Source:" line.
 */
function splitAnswerAndSources(rawAnswer, topChunks) {
  const sourceLineMatch = rawAnswer.match(/\n?Source:\s*(.+)\s*$/i);
  const answer = sourceLineMatch ? rawAnswer.slice(0, sourceLineMatch.index).trim() : rawAnswer;

  const isUnconfirmed = /could not find enough|does not specify|cannot be confirmed/i.test(answer);
  const sources = isUnconfirmed ? [] : [...new Set(topChunks.map((c) => c.source))];

  return { answer, sources };
}

export function mapError(err) {
  if (err instanceof TimeoutError) return { code: "MODEL_TIMEOUT", message: "The model timed out after a retry. Please try again." };
  if (err instanceof OllamaUnavailableError) return { code: "OLLAMA_UNAVAILABLE", message: "Could not reach Ollama. Is it running?" };
  if (err instanceof ModelUnavailableError) return { code: "MODEL_UNAVAILABLE", message: "The requested model is not available in Ollama." };
  if (err instanceof InvalidResponseError) return { code: "INVALID_RESPONSE", message: "The model returned an invalid response." };
  if (err instanceof McpUnavailableError) return { code: "MCP_UNAVAILABLE", message: "The repository MCP server is unavailable." };
  return { code: "UNKNOWN", message: err.message || "An unexpected error occurred." };
}

export function errorStatus(code) {
  switch (code) {
    case "MODEL_TIMEOUT":
      return 504;
    case "OLLAMA_UNAVAILABLE":
    case "MCP_UNAVAILABLE":
      return 503;
    case "MODEL_UNAVAILABLE":
      return 502;
    case "INVALID_RESPONSE":
      return 422;
    case "BAD_REQUEST":
    case "INPUT_TOO_LONG":
      return 400;
    default:
      return 500;
  }
}
