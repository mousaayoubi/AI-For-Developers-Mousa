import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { retrieveTopChunks, buildContext } from "./retrieve.js";
import { buildGroundedPrompt } from "./prompts.js";
import { generateAnswer } from "./generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const PORT = process.env.PORT || 3000;
const TOP_K = 3;
// Below this cosine similarity, we don't trust the retrieved chunks enough
// to even ask the LLM — this is a safety net on top of the prompt
// instructions so the app never invents answers for undocumented topics.
const MIN_RELEVANCE_SCORE = 0.35;

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.post("/api/ask", async (req, res) => {
  const question = (req.body?.question ?? "").trim();

  if (!question) {
    return res.status(400).json({ error: "A non-empty 'question' field is required." });
  }

  try {
    // Semantic search: embed the question, score chunks, take top K.
    const topChunks = await retrieveTopChunks(question, TOP_K);
    const bestScore = topChunks[0]?.score ?? 0;

    if (bestScore < MIN_RELEVANCE_SCORE) {
      return res.json({
        answer:
          "The available project documentation does not contain information relevant to that question.",
        sources: [],
        retrieved: topChunks,
      });
    }

    // Build the grounded context + prompt, then generate the answer.
    const context = buildContext(topChunks);
    const prompt = buildGroundedPrompt(context, question);
    const rawAnswer = await generateAnswer(prompt);

    const { answer, sources } = splitAnswerAndSources(rawAnswer, topChunks);

    res.json({ answer, sources, retrieved: topChunks });
  } catch (err) {
    console.error("Error handling /api/ask:", err);
    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Document Q&A Assistant listening on http://localhost:${PORT}`);
});

/**
 * Strips the model's trailing "Source: a.md, b.md" line from the answer
 * body and determines the sources to display.
 *
 * The sources shown are NOT taken from the model's self-reported Source
 * line — a small local model is unreliable at that (observed: citing
 * testing.md for an answer that only appeared in architecture.md, purely
 * because both files happened to contain the word "frontend"). Instead,
 * sources are computed deterministically from the chunks that were
 * actually retrieved and fed to the model as context, which is both more
 * trustworthy and easier to reason about.
 */
function splitAnswerAndSources(rawAnswer, topChunks) {
  const sourceLineMatch = rawAnswer.match(/\n?Source:\s*(.+)\s*$/i);
  const answer = sourceLineMatch ? rawAnswer.slice(0, sourceLineMatch.index).trim() : rawAnswer;

  // If the model says it couldn't confirm an answer, nothing was actually
  // grounded — don't show sources merely because they were retrieved.
  const isUnconfirmed = /does not specify|cannot be confirmed/i.test(answer);
  const sources = isUnconfirmed ? [] : [...new Set(topChunks.map((c) => c.source))];

  return { answer, sources };
}
