/**
 * Thin RAG-facing wrapper over the centralised Ollama module (Part 2/5) -
 * kept as its own file so the RAG pipeline reads as
 * load -> chunk -> embed -> store, matching the suggested project layout.
 */
export { embed as embedText, embedMany as embedTexts } from "../ollama.js";
