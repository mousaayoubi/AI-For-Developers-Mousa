const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const MODEL = process.env.OLLAMA_MODEL || "llama3.1";

export class OllamaUnavailableError extends Error {}
export class ModelUnavailableError extends Error {}
export class InvalidResponseError extends Error {}

/**
 * Sends a chat request to a local Ollama model, optionally with tool
 * definitions, and returns the assistant message (which may contain
 * `tool_calls`). Non-streaming - the agent loop needs the full message,
 * including tool_calls, before it can decide what to do next.
 */
export async function chat(messages, { tools } = {}) {
  let response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        // Low temperature: tool-calling reliability on small local models
        // drops noticeably above ~0.2-0.3.
        options: { temperature: 0.1 },
        ...(tools ? { tools } : {}),
      }),
    });
  } catch (err) {
    throw new OllamaUnavailableError(
      `Could not reach Ollama at ${OLLAMA_URL}. Is "ollama serve" running? (${err.message})`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 404) {
      throw new ModelUnavailableError(
        `Model "${MODEL}" is not available. Run "ollama pull ${MODEL}" first. ${body}`
      );
    }
    throw new ModelUnavailableError(`Ollama returned HTTP ${response.status}: ${body}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new InvalidResponseError(`Ollama response was not valid JSON: ${err.message}`);
  }

  if (!data?.message) {
    throw new InvalidResponseError('Ollama response was missing a "message" field.');
  }

  return data.message;
}
