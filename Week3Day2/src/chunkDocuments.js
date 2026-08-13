/**
 * Splits a document's text into overlapping, word-bounded chunks.
 *
 * Chunking is word-based (not character-based) so chunk boundaries never cut
 * a word in half, and each chunk stays large enough to be meaningful on its
 * own when retrieved independently.
 *
 * @param {{ source: string, text: string }} document
 * @param {object} [options]
 * @param {number} [options.chunkSize=160] Target words per chunk.
 * @param {number} [options.overlap=30] Words repeated between consecutive chunks.
 * @returns {Array<{ id: string, source: string, chunkIndex: number, text: string }>}
 */
export function chunkDocument(document, options = {}) {
  const { chunkSize = 160, overlap = 30 } = options;
  const { source, text } = document;

  // Split into paragraphs first so we prefer breaking on natural boundaries,
  // then greedily pack paragraphs (or, if needed, individual words) into
  // chunks of roughly `chunkSize` words.
  const words = text.split(/\s+/).filter(Boolean);

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const chunkText = words.slice(start, end).join(" ").trim();

    if (chunkText.length > 0) {
      chunks.push({
        id: `${slugify(source)}-${String(chunkIndex).padStart(2, "0")}`,
        source,
        chunkIndex,
        text: chunkText,
      });
      chunkIndex += 1;
    }

    if (end === words.length) break;
    start = end - overlap; // step forward, re-including the overlap window
  }

  return chunks;
}

/**
 * Chunks every document in a collection.
 *
 * @param {Array<{ source: string, text: string }>} documents
 * @param {object} [options] See chunkDocument options.
 * @returns {Array<object>} Flat array of chunks across all documents.
 */
export function chunkDocuments(documents, options = {}) {
  return documents.flatMap((doc) => chunkDocument(doc, options));
}

function slugify(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
