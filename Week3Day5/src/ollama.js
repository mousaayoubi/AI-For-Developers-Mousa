/**
 * Centralised Ollama client. Every LLM/embedding call in the application
 * (direct answers, routing, RAG generation, agent decisions) goes through
 * this module instead of scattering `fetch()` calls around the codebase.
 * That keeps timeouts, retries, and usage tracking in one place.
 */
import { guardrails } from "./security/guardrails.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const CHAT_MODEL = process.env.CHAT_MODEL || "llama3.1";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";

export class OllamaUnavailableError extends Error {}
export class ModelUnavailableError extends Error {}
export class InvalidResponseError extends Error {}
export class TimeoutError extends Error {}

/**
 * Creates an empty usage/metrics accumulator. Callers pass the same object
 * into every ollama.js call for one request so counts and timings add up
 * across the whole request lifecycle (see Part 17/18 of the exercise).
 */
export function newMetrics() {
  return {
    modelCalls: 0,
    embeddingCalls: 0,
    retryCount: 0,
    modelMs: 0,
    embeddingMs: 0,
  };
}

/**
 * Sends a chat request to the local Ollama model, optionally with tool
 * definitions. Retries once on timeout or transport failure before giving
 * up with a controlled error - never lets a hung request stall forever.
 *
 * @param {Array<object>} messages
 * @param {object} [options]
 * @param {Array<object>} [options.tools]
 * @param {number} [options.temperature=0.1]
 * @param {"json"|undefined} [options.format] Ask Ollama to constrain output to JSON.
 * @param {number} [options.timeoutMs]
 * @param {object} [options.metrics] Accumulator from newMetrics().
 */
export async function chat(messages, options = {}) {
  const {
    tools,
    temperature = 0.1,
    format,
    timeoutMs = guardrails.requestTimeoutMs,
    metrics,
  } = options;

  const body = {
    model: CHAT_MODEL,
    messages,
    stream: false,
    options: { temperature },
    ...(tools ? { tools } : {}),
    ...(format ? { format } : {}),
  };

  const data = await requestWithRetry("/api/chat", body, timeoutMs, metrics, "modelMs", "modelCalls");

  if (!data?.message) {
    throw new InvalidResponseError('Ollama response was missing a "message" field.');
  }
  return data.message;
}

/**
 * Convenience wrapper around chat() for plain single-turn prompts that
 * don't need tool calling (general questions, RAG answers).
 * @param {string} prompt
 * @param {object} [options] See chat().
 * @returns {Promise<string>}
 */
export async function complete(prompt, options = {}) {
  const message = await chat([{ role: "user", content: prompt }], options);
  return (message.content ?? "").trim();
}

/**
 * Chat call that requires valid JSON matching `schemaHint` back from the
 * model. Parses the response; if parsing fails, retries once with an
 * explicit formatting instruction appended. Throws InvalidResponseError if
 * the second attempt also fails to parse - callers must not guess at a
 * broken structured response.
 *
 * @param {Array<object>} messages
 * @param {object} [options] See chat().
 * @returns {Promise<object>} Parsed JSON object.
 */
export async function chatJSON(messages, options = {}) {
  const first = await chat(messages, { ...options, format: "json" });
  const parsed = tryParseJSON(first.content);
  if (parsed) return parsed;

  // Retry once with an explicit formatting nudge before giving up.
  if (options.metrics) options.metrics.retryCount += 1;
  const retryMessages = [
    ...messages,
    { role: "assistant", content: first.content ?? "" },
    {
      role: "user",
      content:
        "That was not valid JSON. Reply with ONLY a single valid JSON object and nothing else - " +
        "no prose, no markdown code fences.",
    },
  ];
  const second = await chat(retryMessages, { ...options, format: "json" });
  const parsedRetry = tryParseJSON(second.content);
  if (parsedRetry) return parsedRetry;

  throw new InvalidResponseError(
    `Model did not return valid JSON after a retry. Last response: ${(second.content ?? "").slice(0, 200)}`
  );
}

/**
 * Requests an embedding vector for a single piece of text.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {object} [options.metrics]
 * @returns {Promise<number[]>}
 */
export async function embed(text, options = {}) {
  const { timeoutMs = guardrails.requestTimeoutMs, metrics } = options;
  const data = await requestWithRetry(
    "/api/embeddings",
    { model: EMBEDDING_MODEL, prompt: text },
    timeoutMs,
    metrics,
    "embeddingMs",
    "embeddingCalls"
  );

  if (!Array.isArray(data.embedding)) {
    throw new InvalidResponseError("Ollama response did not contain an embedding array.");
  }
  return data.embedding;
}

/**
 * Embeds many chunks of text sequentially, so a single local Ollama
 * instance never gets a burst of parallel requests.
 * @param {string[]} texts
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function embedMany(texts, onProgress) {
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(await embed(texts[i]));
    onProgress?.(i + 1, texts.length);
  }
  return vectors;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Model timeout -> retry once -> still fails -> controlled error (Part 12). */
async function requestWithRetry(endpoint, body, timeoutMs, metrics, msField, callField) {
  const attempt = async () => {
    const start = Date.now();
    try {
      const result = await requestOnce(endpoint, body, timeoutMs);
      if (metrics) {
        metrics[msField] = (metrics[msField] || 0) + (Date.now() - start);
        metrics[callField] = (metrics[callField] || 0) + 1;
      }
      return result;
    } catch (err) {
      if (metrics) metrics[msField] = (metrics[msField] || 0) + (Date.now() - start);
      throw err;
    }
  };

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof ModelUnavailableError || err instanceof InvalidResponseError) throw err;
    // Timeout or transport failure: retry exactly once.
    if (metrics) metrics.retryCount += 1;
    return await attempt();
  }
}

async function requestOnce(endpoint, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${OLLAMA_HOST}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new TimeoutError(`Ollama request to ${endpoint} timed out after ${timeoutMs}ms.`);
    }
    throw new OllamaUnavailableError(
      `Could not reach Ollama at ${OLLAMA_HOST}. Is "ollama serve" running? (${err.message})`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 404) {
      throw new ModelUnavailableError(
        `Model not available for ${endpoint}. Run "ollama pull <model>" first. ${text}`
      );
    }
    throw new ModelUnavailableError(`Ollama returned HTTP ${response.status} for ${endpoint}: ${text}`);
  }

  try {
    return await response.json();
  } catch (err) {
    throw new InvalidResponseError(`Ollama response was not valid JSON: ${err.message}`);
  }
}

function tryParseJSON(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in a markdown code fence despite instructions -
    // try stripping that before giving up.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
