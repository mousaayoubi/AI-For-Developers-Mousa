import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgent } from "./agent.js";
import { OllamaUnavailableError, ModelUnavailableError, InvalidResponseError } from "./ollama.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.post("/api/agent", async (req, res) => {
  const goal = (req.body?.goal ?? "").trim();

  if (!goal) {
    return res.status(400).json({ ok: false, error: 'A non-empty "goal" is required.', code: "BAD_REQUEST" });
  }

  try {
    const { answer, filesInspected, log, stopped } = await runAgent(goal);
    res.json({ ok: true, answer, filesInspected, log, stopped });
  } catch (err) {
    if (err instanceof OllamaUnavailableError) {
      return res.status(503).json({ ok: false, error: err.message, code: "OLLAMA_UNAVAILABLE" });
    }
    if (err instanceof ModelUnavailableError) {
      return res.status(502).json({ ok: false, error: err.message, code: "MODEL_UNAVAILABLE" });
    }
    if (err instanceof InvalidResponseError) {
      return res.status(422).json({ ok: false, error: err.message, code: "INVALID_RESPONSE" });
    }
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Unexpected server error.", code: "UNKNOWN" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Repository Agent listening on http://localhost:${PORT}`);
});
