import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embedText } from "./embeddings.js";
import { cosineSimilarity } from "./similarity.js";
import { guardrails } from "../security/guardrails.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.resolve(__dirname, "..", "..", "data", "vectors.json");

let cachedIndex = null;

/** Loads the local vector store (data/vectors.json), caching it in memory. */
export async function loadVectorIndex() {
  if (cachedIndex) return cachedIndex;

  let raw;
  try {
    raw = await readFile(VECTORS_PATH, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`No vector index found at data/vectors.json. Run "npm run index" first to build it.`);
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
 * @param {string} question
 * @param {object} [options] { metrics }
 */
export async function semanticSearch(question, options = {}) {
  const index = await loadVectorIndex();
  const questionEmbedding = await embedText(question, options);

  const scored = index.map((chunk) => ({
    id: chunk.id,
    source: chunk.source,
    section: chunk.section,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    score: cosineSimilarity(questionEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Plain keyword/substring fallback search (Part 12: "No Useful RAG
 * Result" -> keyword fallback), used when semantic search either fails
 * (e.g. embedding call errors) or returns nothing above the relevance
 * threshold. Scores chunks by how many query words they contain.
 * @param {string} question
 */
export async function keywordSearch(question) {
  const index = await loadVectorIndex();
  const words = question
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);

  const scored = index.map((chunk) => {
    const lowerText = chunk.text.toLowerCase();
    const hits = words.filter((w) => lowerText.includes(w)).length;
    return { ...chunk, score: words.length ? hits / words.length : 0 };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Retrieves the top-K most relevant chunks for a question, falling back to
 * keyword search if semantic search errors out or the best semantic score
 * is below the relevance threshold. `usedFallback` tells the caller which
 * path was used, for logging (Part 16).
 * @param {string} question
 * @param {object} [options] { k, metrics }
 */
export async function retrieveTopChunks(question, options = {}) {
  const { k = guardrails.ragTopK, metrics } = options;

  let scored;
  let usedFallback = false;
  try {
    scored = await semanticSearch(question, { metrics });
    if ((scored[0]?.score ?? 0) < guardrails.minRelevanceScore) {
      const keywordScored = await keywordSearch(question);
      if ((keywordScored[0]?.score ?? 0) > 0) {
        scored = keywordScored;
        usedFallback = true;
      }
    }
  } catch (err) {
    scored = await keywordSearch(question);
    usedFallback = true;
  }

  return { chunks: scored.slice(0, k), usedFallback };
}

/**
 * Combines retrieved chunks into a single context block, grouped by source
 * so multiple chunks from the same file read as one section.
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
 * between each consecutive pair instead of repeating it verbatim.
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
