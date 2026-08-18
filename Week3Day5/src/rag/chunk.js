/**
 * Splits a document's text into overlapping, word-bounded, section-aware
 * chunks (Part 5). Chunking is word-based (not character-based) so chunk
 * boundaries never cut a word in half. Each chunk records the nearest
 * preceding Markdown heading as its `section`, so retrieved evidence can
 * cite not just a file but a section within it (see the record shape in
 * Part 5 of the exercise: { id, source, section, text, embedding }).
 *
 * @param {{ source: string, text: string }} document
 * @param {object} [options]
 * @param {number} [options.chunkSize=160] Target words per chunk.
 * @param {number} [options.overlap=30] Words repeated between consecutive chunks.
 * @returns {Array<{ id: string, source: string, section: string, chunkIndex: number, text: string }>}
 */
export function chunkDocument(document, options = {}) {
  const { chunkSize = 160, overlap = 30 } = options;
  const { source, text } = document;

  const words = wordsWithSections(text);

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const slice = words.slice(start, end);
    const chunkText = slice.map((w) => w.word).join(" ").trim();

    if (chunkText.length > 0) {
      chunks.push({
        id: `${slugify(source)}-${String(chunkIndex).padStart(2, "0")}`,
        source,
        section: slice[0]?.section ?? "General",
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

/** Chunks every document in a collection. */
export function chunkDocuments(documents, options = {}) {
  return documents.flatMap((doc) => chunkDocument(doc, options));
}

/**
 * Splits text into words, tagging each word with the Markdown heading
 * ("## Section Name") that most recently preceded it.
 */
function wordsWithSections(text) {
  const lines = text.split("\n");
  const tagged = [];
  let currentSection = "General";

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      currentSection = heading[1].trim();
      continue;
    }
    for (const word of line.split(/\s+/).filter(Boolean)) {
      tagged.push({ word, section: currentSection });
    }
  }

  return tagged;
}

function slugify(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
