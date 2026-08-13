const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";

/**
 * Requests an embedding vector for a single piece of text from Ollama.
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
  const response = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Ollama embedding request failed (${response.status}): ${body || response.statusText}. ` +
        `Is Ollama running and is the "${EMBEDDING_MODEL}" model pulled? Try: ollama pull ${EMBEDDING_MODEL}`
    );
  }

  const data = await response.json();
  if (!Array.isArray(data.embedding)) {
    throw new Error("Ollama response did not contain an embedding array.");
  }
  return data.embedding;
}

/**
 * Embeds many chunks of text sequentially against the local Ollama server.
 * Sequential (rather than parallel) requests keep this friendly to a single
 * local Ollama instance and make progress logging straightforward.
 *
 * @param {string[]} texts
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts, onProgress) {
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(await embedText(texts[i]));
    onProgress?.(i + 1, texts.length);
  }
  return vectors;
}
