/**
 * Central, enforced safety limits (Part 13). These are read by actual
 * JavaScript checks throughout the app (agent loop, RAG, router, server) -
 * never relied on as prompt instructions alone. A model can be asked
 * nicely to stop after 8 steps; only code can guarantee it.
 */
export const guardrails = {
  /** Hard cap on agent tool-calling turns (Part 11). */
  maxAgentSteps: 8,
  /** Hard cap on total tool invocations across an agent run. */
  maxToolCalls: 10,
  /** Largest file content (bytes) the agent is allowed to read at once. */
  maxFileSize: 100_000,
  /** Largest number of search_project_files results returned. */
  maxSearchResults: 20,
  /** Largest user input accepted by /api/ask. */
  maxInputLength: 5_000,
  /**
   * Per-model-call timeout before it is retried once, then fails. Set well
   * above Ollama's typical single-call latency because this machine runs
   * inference on CPU (no GPU offload) - later agent steps carry a growing
   * conversation history (prior tool results), and prompt-eval time scales
   * with context length, so a single chat() call can legitimately take
   * 30-60s+ once a couple of files have been read into context.
   */
  requestTimeoutMs: 90_000,
  /** The agent/tools may never write, delete, or execute anything. */
  allowWrites: false,
  /** Minimum cosine similarity before RAG will trust a chunk (Part 6/12). */
  minRelevanceScore: 0.35,
  /** Number of top chunks retrieved per RAG query. */
  ragTopK: 3,
  /** Only these tool names may ever be invoked by the agent. */
  toolAllowList: ["list_project_files", "search_project_files", "read_project_file"],
};
