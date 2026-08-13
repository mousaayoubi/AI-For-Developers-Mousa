const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const CHAT_MODEL = process.env.CHAT_MODEL || "llama3.2:3b";

/**
 * Sends a prompt to a local Ollama chat/completion model and returns the
 * full generated text (non-streaming).
 *
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function generateAnswer(prompt) {
  const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Ollama generate request failed (${response.status}): ${body || response.statusText}. ` +
        `Is Ollama running and is the "${CHAT_MODEL}" model pulled? Try: ollama pull ${CHAT_MODEL}`
    );
  }

  const data = await response.json();
  return (data.response ?? "").trim();
}
