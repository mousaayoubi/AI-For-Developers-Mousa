import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBugAnalysisPrompt } from './prompts/bugAnalysisPrompt.js';
import {
  analyzeBugReport,
  OllamaUnavailableError,
  ModelUnavailableError,
  InvalidResponseError,
} from './services/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/analyze', async (req, res) => {
  const { expected, actual, error, reproduction, question, simulateInvalid } = req.body || {};

  // Test 4 hook: lets the UI deliberately request a malformed "AI response"
  // (skipping Ollama entirely) so we can prove the frontend/backend handle
  // bad data without crashing.
  if (simulateInvalid) {
    return res.json({
      ok: true,
      result: { summary: 'Simulated malformed response', severity: 'catastrophic', nextStep: 42 },
      trace: [],
      simulated: true,
    });
  }

  if (!expected && !actual && !error && !reproduction) {
    return res.status(400).json({
      ok: false,
      error: 'Provide at least one of: expected behaviour, actual behaviour, error message, reproduction steps.',
      code: 'BAD_REQUEST',
    });
  }

  const prompt = buildBugAnalysisPrompt({ expected, actual, error, reproduction, question });

  try {
    const { result, trace } = await analyzeBugReport(prompt);
    res.json({ ok: true, result, trace });
  } catch (err) {
    if (err instanceof OllamaUnavailableError) {
      return res.status(503).json({ ok: false, error: err.message, code: 'OLLAMA_UNAVAILABLE' });
    }
    if (err instanceof ModelUnavailableError) {
      return res.status(502).json({ ok: false, error: err.message, code: 'MODEL_UNAVAILABLE' });
    }
    if (err instanceof InvalidResponseError) {
      return res.status(422).json({ ok: false, error: err.message, code: 'INVALID_RESPONSE' });
    }
    console.error(err);
    res.status(500).json({ ok: false, error: 'Unexpected server error.', code: 'UNKNOWN' });
  }
});

app.listen(PORT, () => {
  console.log(`Bug Report Analyser running at http://localhost:${PORT}`);
});
