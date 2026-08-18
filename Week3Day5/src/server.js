import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { answerQuestion, InputValidationError, errorStatus } from "./askPipeline.js";
import { ROUTES } from "./router.js";
import { logRequest, newRequestId } from "./logging/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.post("/api/ask", async (req, res) => {
  const requestId = newRequestId();

  let result;
  try {
    result = await answerQuestion(req.body?.question);
  } catch (err) {
    if (err instanceof InputValidationError) {
      return res.status(errorStatus(err.code)).json({ error: err.message, code: err.code });
    }
    console.error(`[${requestId}] unexpected pipeline failure:`, err);
    return res.status(500).json({ error: err.message || "Unexpected server error.", code: "UNKNOWN" });
  }

  await logRequest({
    timestamp: new Date().toISOString(),
    requestId,
    requestType: result.route,
    route: result.route,
    question: req.body?.question,
    toolsUsed: result.toolsUsed,
    retrievedSources: result.sources,
    agentSteps: result.agentSteps,
    latencyMs: result.timings.totalMs,
    routingMs: result.timings.routingMs,
    retrievalMs: result.timings.retrievalMs,
    mcpMs: result.timings.mcpMs,
    modelMs: result.timings.modelMs,
    retryCount: result.metrics.retryCount || 0,
    fallbackUsed: result.fallbackUsed,
    modelCalls: result.metrics.modelCalls || 0,
    embeddingCalls: result.metrics.embeddingCalls || 0,
    toolCalls: result.metrics.toolCalls || 0,
    mcpCalls: result.metrics.mcpCalls || 0,
    flagged: result.flagged,
    stopped: result.stopped,
    errorCode: result.errorCode,
    success: result.success,
  });

  res.status(result.success ? 200 : errorStatus(result.errorCode)).json({
    ok: result.success,
    requestId,
    route: result.route,
    answer: result.answer,
    sources: result.sources,
    toolsUsed: result.toolsUsed,
    filesInspected: result.filesInspected,
    agentSteps: result.agentSteps,
    fallbackUsed: result.fallbackUsed,
    flagged: result.flagged,
    stopped: result.stopped,
    errorCode: result.errorCode,
    timings: result.timings,
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, routes: ROUTES }));

app.listen(PORT, () => {
  console.log(`AI Engineering Assistant listening on http://localhost:${PORT}`);
});
