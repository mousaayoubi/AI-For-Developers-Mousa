import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embedText } from "./embeddings.js";
import { cosineSimilarity } from "./similarity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.resolve(__dirname, "..", "data", "vectors.json");

let cachedIndex = null;

/**
 * Loads the local vector store (data/vectors.json), caching it in memory.
 * @returns {Promise<Array<object>>}
 */
export async function loadVectorIndex() {
  if (cachedIndex) return cachedIndex;

  let raw;
  try {
    raw = await readFile(VECTORS_PATH, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `No vector index found at data/vectors.json. Run "npm run index" first to build it.`
      );
    }
    throw err;
  }

  cachedIndex = JSON.parse(raw);
  return cachedIndex;
}

/** Clears the in-memory index cache (useful after re-indexing). */
export function clearIndexCache() {
  cachedIndex = null;
}

/**
 * Embeds a question and scores it against every chunk in the vector store
 * using cosine similarity, returning results sorted best-first.
 *
 * @param {string} question
 * @returns {Promise<Array<{ id: string, source: string, chunkIndex: number, text: string, score: number }>>}
 */
export async function semanticSearch(question) {
  const index = await loadVectorIndex();
  const questionEmbedding = await embedText(question);

  const scored = index.map((chunk) => ({
    id: chunk.id,
    source: chunk.source,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    score: cosineSimilarity(questionEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Retrieves the top-K most relevant chunks for a question.
 * @param {string} question
 * @param {number} [k=3]
 */
export async function retrieveTopChunks(question, k = 3) {
  const scored = await semanticSearch(question);
  return scored.slice(0, k);
}

/**
 * Combines retrieved chunks into a single context block, grouped by source
 * so multiple chunks from the same file read as one section.
 *
 * Chunks from the same source are merged in chunkIndex order with their
 * word-level overlap collapsed (chunkDocuments.js gives adjacent chunks a
 * shared overlap window). Without this, the overlap text is repeated
 * verbatim — often truncated mid-sentence on its first occurrence — which
 * reads as garbled and has been observed to make small local LLMs decline
 * to answer even when the fact is present in the context.
 *
 * @param {Array<{ source: string, chunkIndex: number, text: string }>} chunks
 * @returns {string}
 */
export function buildContext(chunks) {
  const bySource = new Map();
  for (const chunk of chunks) {
    if (!bySource.has(chunk.source)) bySource.set(chunk.source, []);
    bySource.get(chunk.source).push(chunk);
  }

  return [...bySource.entries()]
    .map(([source, sourceChunks]) => {
      const ordered = [...sourceChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
      const mergedText = mergeOverlappingTexts(ordered.map((c) => c.text));
      return `Source: ${source}\n\n${mergedText}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Joins a sequence of texts, collapsing the trailing/leading word overlap
 * between each consecutive pair (if any) instead of repeating it.
 *
 * @param {string[]} texts
 * @returns {string}
 */
function mergeOverlappingTexts(texts) {
  if (texts.length === 0) return "";

  let mergedWords = texts[0].split(/\s+/).filter(Boolean);

  for (let i = 1; i < texts.length; i++) {
    const nextWords = texts[i].split(/\s+/).filter(Boolean);
    const maxCheck = Math.min(mergedWords.length, nextWords.length);

    let overlapLen = 0;
    for (let k = maxCheck; k > 0; k--) {
      const tail = mergedWords.slice(-k).join(" ");
      const head = nextWords.slice(0, k).join(" ");
      if (tail === head) {
        overlapLen = k;
        break;
      }
    }

    mergedWords = mergedWords.concat(nextWords.slice(overlapLen));
  }

  return mergedWords.join(" ");
}
