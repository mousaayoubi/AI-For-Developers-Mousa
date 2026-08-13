# Document Q&A Assistant (RAG)

A Vanilla JavaScript RAG application that answers questions about a project
using a small local knowledge base, local Ollama embeddings, and a local
Ollama LLM. It will not answer from general knowledge — it only answers from
what it retrieves out of `knowledge/`.

```
Documents -> Load -> Chunk -> Embed -> Store
                                          |
User Question -> Embed -> Semantic Search -> Retrieve Context
                                          |
                            Grounded LLM Prompt -> Answer + Sources
```

## Prerequisites

- [Ollama](https://ollama.com) running locally.
- Two local models pulled:
  ```
  ollama pull nomic-embed-text
  ollama pull llama3.2:3b
  ```
  (Different models can be used via the `EMBEDDING_MODEL` / `CHAT_MODEL`
  environment variables — see below.)

## Setup

```bash
npm install
npm run index   # Load + chunk + embed knowledge/ -> data/vectors.json
npm run start   # Start the web server on http://localhost:3000
```

Then open http://localhost:3000 and ask a question.

Re-run `npm run index` any time a file in `knowledge/` changes — embeddings
are generated once during indexing, not on every question.

## Project Structure

```
knowledge/        Source documents (the knowledge base)
data/vectors.json Local vector store (chunks + metadata + embeddings)
src/
  loadDocuments.js   Step 1: read every .md file in knowledge/
  chunkDocuments.js  Step 2-3: split into overlapping chunks + metadata
  embeddings.js      Step 4/7: call Ollama's embedding endpoint
  index.js           Step 5: indexing pipeline -> data/vectors.json
  similarity.js       Step 8: cosine similarity
  retrieve.js        Step 8-9: semantic search + context building
  prompts.js         Step 10: grounded prompt template
  generate.js        Step 11: call Ollama's generation endpoint
  server.js          Express API (/api/ask) + safety net for step 12
public/              Step 6/13: vanilla JS/HTML/CSS frontend
```

## Configuration

Environment variables (all optional):

| Variable          | Default             | Purpose                          |
|--------------------|----------------------|-----------------------------------|
| `OLLAMA_HOST`      | `http://127.0.0.1:11434` | Ollama server URL             |
| `EMBEDDING_MODEL`  | `nomic-embed-text`  | Model used for embeddings         |
| `CHAT_MODEL`       | `llama3.2:3b`        | Model used for answer generation |
| `PORT`             | `3000`               | Web server port                   |

## How "I don't know" is handled

Two layers keep answers grounded:

1. **Prompt-level:** the grounded prompt (`src/prompts.js`) instructs the
   model to answer only from context and to say so explicitly when the
   context is insufficient.
2. **Score-level safety net:** in `src/server.js`, if the best retrieved
   chunk's cosine similarity is below `MIN_RELEVANCE_SCORE` (0.35), the
   server returns a "not documented" response without even calling the LLM,
   so the model never gets a chance to invent an answer from a weak match.

## Known limitations (small local model)

Using a 3B chat model (`llama3.2:3b`) for generation surfaced two real
failure modes worth knowing about:

- **Garbled overlap text.** `chunkDocuments.js` gives adjacent chunks a
  30-word overlap so no chunk starts/ends mid-thought. But naively
  concatenating two overlapping chunks repeats that overlap text verbatim —
  often truncated mid-sentence on its first occurrence — which reads as
  garbled. The small model would sometimes decline to answer ("does not
  specify...") even when the fact was clearly present, purely because the
  surrounding text looked corrupted. Fixed in `retrieve.js`'s
  `buildContext()`, which merges same-source chunks in order and collapses
  the repeated overlap at the word level before handing context to the LLM.
- **Unreliable self-citation.** The model was asked to end its answer with
  `Source: file.md`, but a 3B model isn't reliable at that — e.g. it once
  cited `testing.md` for an answer that only appeared in `architecture.md`,
  apparently because both files happened to contain the word "frontend" in
  unrelated sentences. `server.js` now ignores the model's self-reported
  source line for the `sources` field entirely and instead reports the
  deterministic set of sources that were actually retrieved and fed into
  the prompt — trustworthy, if occasionally a little broader than the exact
  sentence(s) used. The dev panel's per-chunk scores let you judge which
  retrieved source was actually load-bearing.

Both would likely disappear with a larger chat model (e.g. swap
`CHAT_MODEL=gemma4:26b` locally), at the cost of slower responses.

## Testing it

Try these from the exercise:

- "Which database does the project use?" → direct match (architecture.md)
- "How does the application verify users before allowing access to private
  routes?" → different wording, should still find JWT authentication
  (security.md)
- A question whose answer spans multiple files (e.g. "What testing does the
  project do and how does that relate to Pull Requests?") → multiple sources
- "Which AWS region is production deployed to?" → not documented, assistant
  should say so instead of guessing
