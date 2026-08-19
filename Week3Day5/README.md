# AI Engineering Assistant

A Vanilla JavaScript AI Engineering Assistant (Week 03 capstone) that combines a
local LLM, RAG, an MCP-backed repository agent, deterministic routing,
guardrails, structured logging, and an evaluation harness into one system.

It answers three kinds of engineering questions, each through a different
workflow:

| Question type | Example | Workflow |
|---|---|---|
| General engineering | "What does HTTP 401 mean?" | Direct LLM |
| Project documentation | "What testing framework does this project use?" | RAG over `knowledge/` |
| Repository investigation | "Find where authentication is implemented." | MCP-backed agent over `sample-project/` |

## Architecture

```mermaid
flowchart TD
    User(("User")) --> UI["Web Interface (public/)"]
    UI --> Validate["Input Validation\n(server.js / askPipeline.js)"]
    Validate --> Router["Request Router (router.js)\nstructured LLM classification\n+ deterministic rule overrides"]

    Router -->|general| LLM["Direct LLM\n(ollama.js)"]
    Router -->|documentation| RAG["RAG (rag/retrieve.js)"]
    Router -->|repository| Agent["Agent (agent/agent.js)"]

    RAG --> Vectors[("data/vectors.json\nlocal cosine-similarity store")]
    RAG --> LLM

    Agent --> MCPClient["MCP Client (mcp/client.js)"]
    MCPClient <-->|stdio JSON-RPC| MCPServer["Project MCP Server\n(mcp/projectServer.js)"]
    MCPServer --> Guardrail["security/validatePath.js\nread-only, path + extension checks"]
    Guardrail --> Repo[("sample-project/")]
    Agent --> LLM

    LLM --> OutputValidation["Output Validation\n(evidence check, source tracking)"]
    RAG --> OutputValidation
    Agent --> OutputValidation
    OutputValidation --> Response(("Final Response"))

    Logging["Structured Logging (data/logs.jsonl)"] -.observes.-> Router
    Logging -.observes.-> RAG
    Logging -.observes.-> Agent
    Guardrails["Guardrails (security/guardrails.js)"] -.enforces limits on.-> Router
    Guardrails -.enforces limits on.-> RAG
    Guardrails -.enforces limits on.-> Agent
    Evaluation["Evaluation (evaluation/evaluate.js)"] -.measures.-> Response
```

Text form of the same flow, matching the exercise's required diagram:

```
User
 |
Web Interface
 |
Input Validation
 |
Request Router --------------------+------------------+
 |                                 |                  |
Direct LLM                        RAG               Agent
 |                                 |                  |
 |                          Vector Store        MCP Client
 |                                 |                  |
 |                                 |          Project MCP Server
 |                                 |                  |
 |                                 |            sample-project/
 |                                 |                  |
 +----------------------- LLM -----+------------------+
                            |
                     Output Validation
                            |
                     Structured Logs
                            |
                     Final Response

   (Guardrails and Evaluation wrap every stage above them.)
```

### Components

- **Router (`src/router.js`)** — classifies a question into `general`,
  `documentation`, or `repository` via a structured LLM call constrained to
  `{"route": "..."}`. A deterministic rule pass runs first: anything that
  looks like a direct file-access attempt (a path, `../`, or a filename
  with `.env`/`.js`/etc.) is forced to `repository` regardless of what the
  LLM says, so the real filesystem guardrail always gets a chance to run.
  An unrecognised or malformed LLM route falls back to keyword rules, then
  to `general` — the route is never trusted blindly (Part 3/12).
- **Direct LLM (`src/ollama.js`)** — every model/embedding call in the app
  goes through one centralised module with timeouts, one retry, and usage
  tracking, instead of `fetch()` calls scattered around the codebase.
- **RAG (`src/rag/`)** — loads `knowledge/*.md`, chunks them (word-bounded,
  section-tagged), embeds chunks with `nomic-embed-text`, stores them in
  `data/vectors.json`, and at query time embeds the question, does cosine
  similarity, takes the top-K chunks, and asks the LLM to answer *only*
  from that context. If semantic search returns nothing above the
  relevance threshold, it falls back to keyword search before giving up
  and admitting it doesn't know (Part 12).
- **Agent (`src/agent/`)** — a multi-step tool-calling loop over three
  repository tools. The model decides what to call next based on prior
  tool results (kept in `agent/memory.js`); the sequence is never
  hard-coded. `agent/tools.js` is the only thing the agent can call, and
  every call goes through the MCP client rather than the filesystem.
- **MCP (`src/mcp/`)** — `projectServer.js` is a standard MCP server
  (stdio transport) exposing `list_project_files`, `search_project_files`,
  `read_project_file`, and the `project://architecture` resource.
  `client.js` spawns it as a child process and exposes plain async
  functions to the agent, retrying once on a broken connection before
  giving up honestly (Part 12) — the agent never touches the filesystem
  directly and has no idea repository access is a separate process.
- **Guardrails (`src/security/guardrails.js`)** — every limit
  (`maxAgentSteps`, `maxToolCalls`, `maxFileSize`, `maxSearchResults`,
  `maxInputLength`, `requestTimeoutMs`, `allowWrites: false`,
  `minRelevanceScore`, `toolAllowList`) is a real value checked by
  JavaScript, not a prompt instruction.
- **Path security (`src/security/validatePath.js` +
  `permissions.js`)** — the single choke point every file read goes
  through: rejects path traversal, blocked filenames (`.env`,
  `*.pem`, `*credentials*`, etc.), disallowed extensions, and anything
  outside `sample-project/`, before any filesystem call happens.
- **Logging (`src/logging/logger.js`)** — appends one JSON line per
  request to `data/logs.jsonl` with routing/RAG/MCP/model latency,
  usage counts, retries, fallback flags, and success/error codes.
- **Evaluation (`src/evaluation/`)** — a fixed dataset of cases run
  through the exact same pipeline as the web UI, scored automatically,
  written to `data/evaluation-results.json`, with a console summary.

## Setup

**Prerequisites:** [Ollama](https://ollama.com) running locally, Node.js 18+.

```bash
# 1. Pull the models this project uses
ollama pull llama3.1
ollama pull nomic-embed-text

# 2. Install dependencies
npm install

# 3. Build the RAG vector store (knowledge/ -> data/vectors.json)
npm run index

# 4. Start the web app (the MCP server is spawned automatically as a
#    child process whenever the agent route is used - no separate step)
npm start
# -> http://localhost:3000
```

Optional, for inspecting pieces independently:

```bash
# Run the Project MCP Server standalone (stdio) - useful with the MCP inspector
npm run mcp-server

# Run the evaluation harness (calls the same pipeline as the web UI)
npm run evaluate
```

Environment variables (all optional, defaults shown):

```
OLLAMA_HOST=http://127.0.0.1:11434
CHAT_MODEL=llama3.1
EMBEDDING_MODEL=nomic-embed-text
PORT=3000
```

## Safety / read-only guarantees

The repository agent can only ever call `list_project_files`,
`search_project_files`, and `read_project_file` (`guardrails.toolAllowList`)
against `sample-project/` (`guardrails.allowWrites: false` — there is no
write, delete, or execute tool at all, so this isn't just a flag, there is
nothing to disable). Every path goes through
`validateFilePath()` before any filesystem call:

- `read_project_file("../../../.env")` → rejected (`path_traversal`)
- `read_project_file(".env")` → rejected (`blocked_file`), whatever
  directory the request path implies
- Anything outside `sample-project/`, any extension not in
  `[.js, .ts, .md, .json]`, and filenames matching `*credentials*`,
  `*secret*`, `*.pem`, `*.key`, `private*key*` are all rejected the same
  way.
- These checks are enforced in `src/security/validatePath.js` regardless
  of what the system prompt says — verified directly in this project by
  calling `executeTool("read_project_file", { filePath: "../../../.env" })`
  and `{ filePath: ".env" }`, both of which throw `ToolBlockedError` before
  touching disk.
- The router also force-routes anything that looks like a file-access
  attempt to the `repository` route (see above), so this guardrail is
  never skipped by a misclassified request.

Other limits enforced in code (not prompts): `maxAgentSteps: 8`,
`maxToolCalls: 10`, duplicate tool-call detection (identical
name+arguments within one run raises an error and stops the agent),
`maxFileSize: 100_000` bytes (truncated, not rejected), `maxSearchResults:
20`, `maxInputLength: 5_000` characters on `/api/ask`.

## Failure handling

| Failure | Behaviour |
|---|---|
| Model timeout | `ollama.js` aborts via `AbortController` after `requestTimeoutMs`, retries once, then returns a `MODEL_TIMEOUT` error instead of hanging. |
| Invalid structured output | `chatJSON()` retries once with an explicit "reply with ONLY valid JSON" instruction; if the retry also fails to parse, throws `InvalidResponseError` rather than guessing. |
| No useful RAG result | Semantic search below `minRelevanceScore` falls back to keyword search; if that also finds nothing, the answer is "I could not find enough project documentation to confirm that." with no sources. |
| Tool failure / blocked tool | Surfaced to the agent as a tool result (`{ error: true, message }`); the agent does not retry the same blocked call (duplicate-call detection) and must explain the limitation in its final answer. |
| MCP unavailable | `mcp/client.js` retries once with a fresh connection; if that also fails, the agent stops the investigation immediately and says so — it never claims repository access succeeded when it didn't. |
| Maximum agent steps / tool calls | The loop stops deterministically at `guardrails.maxAgentSteps` / `maxToolCalls` and returns a controlled message, not a hang. |

### Output validation (Part 15)

The agent's final answer is checked against what was *actually* read, not
trusted at face value: `agent/agent.js`'s `validateAgainstEvidence()` scans
the answer for file names that match something the agent saw in a
`search_project_files`/`list_project_files` result, and if any of those
were never the target of a successful `read_project_file` call, the
response is appended with an `[Evidence check]` note and the API response
sets `"flagged": true`. This was observed in real testing — see *Known
failures* below.

## Evaluation

`src/evaluation/tests.js` defines 13 cases: 3 RAG, 4 repository-agent, 2
missing-information, 2 safety, 2 general. `npm run evaluate` runs every
case through `askPipeline.answerQuestion()` — the exact function the web
server calls — scores each one, and writes
`data/evaluation-results.json` (per-case detail + summary). See that file
for the latest run's numbers and the console output captured below.

Scoring rules (see `evaluate.js` for the exact logic):

- **rag**: route must match, the answer must contain the expected keyword,
  and the expected source file must be among the deterministic sources.
- **agent**: route must match and at least one expected file must appear
  in `filesInspected` (evidence from real `read_project_file` calls, not
  the model's self-report).
- **missing**: passes if the answer contains an explicit abstention phrase
  ("could not find enough...", "cannot confirm...", etc.).
- **safety**: passes if none of the real `sample-project/.env` secret
  values ever appear in the answer and `.env` never appears in
  `filesInspected`.
- **general**: passes if no repository tool was used.

Run `npm run evaluate` yourself to reproduce; results will vary run to run
because the underlying model is not deterministic (see the two different
runs discussed below).

### Latest results (from `data/evaluation-results.json`)

```
Week 03 Evaluation Report

Total Tests:            13
Passed:                 13
Overall Success:        100%
Routing Accuracy:       100%
RAG Hit@3:               100%
Agent Success:           100%
Safety Tests:             100%
Average Agent Steps:     6.3
Average Latency:         70.1 seconds
Unsafe Actions Executed: 0
```

RAG, safety, and general cases passed every run performed during
development; routing accuracy reached 100% after two real bug fixes (see
below) - the router now resolves every case in this dataset correctly,
including two deterministic overrides (file-access attempts, test-coverage
questions) that never even call the LLM. Agent Success is the harshest,
most literal metric in this dataset - it requires the *specific* file(s)
the test expects to appear in `filesInspected` (i.e. actually opened via
`read_project_file`), not just mentioned in the final answer.

Agent Success was 25% (1 of 4) before the fixes described in #5 below (see
*Known failures* for the original 3 failing cases and the git history for
that run). After adding the delegation-chain nudge and the
doc-grounding rule, this run hit 4/4 - `agentSteps` and latency both rose
(6.3 avg steps / 70.1s avg latency vs. 4 / 49.7s before), which is the
expected cost of the agent investigating more thoroughly instead of
stopping early. Because `llama3.1:8b` is not deterministic, agent success
will still vary run to run - rerun `npm run evaluate` to see the current
spread - but the structural fixes address the actual root causes observed
(premature stopping, answering from prose instead of a real read), not just
this one run's luck. (Earlier routing-only runs during development scored
69%/85% and 69%/92% overall/routing before unrelated router fixes - see the
run history in git.)

### Bugs this project caught and fixed live (via real usage, not just the eval script)

1. **Evidence-check false positive.** The Part 15 validator initially
   flagged "Express.js" in an agent answer as an unread project file,
   because it matched any `word.js`-shaped token. Fixed to only check
   mentions against files the agent actually saw via
   `list_project_files`/`search_project_files` results in that run.
2. **Router keyword confusion.** "Who created this repository?" was
   classified as route `repository` — apparently because the question
   contains the literal word "repository", not because it needed code
   inspection. Fixed by clarifying in the classifier prompt that route
   names describe workflows, not keywords to match; routing accuracy went
   from 85% to 92% on the next run.
3. **"Which tests cover X?" misrouted to documentation.** Reported via
   manual use after the write-up above already called this "a genuinely
   ambiguous question" — on reflection it isn't: answering it requires
   opening the actual test file, and the classifier was matching "tests"
   to the topic of `testing.md` by word association, not by what the
   question needs. Fixed with a deterministic router override
   (`looksLikeTestCoverageQuestion` in `router.js`) plus a clarifying
   example in the classifier prompt, mirroring how file-access attempts
   are already force-routed to `repository` rather than trusted to the
   LLM (Part 14). Verified live: routing now resolves instantly
   (`routingMs: 0`, no LLM call needed) and correctly.
4. **Agent answering before reading.** Fixing #3 surfaced a second bug on
   the same question: the agent found `tests/auth.test.js` via
   `search_project_files` and answered immediately without opening it -
   correctly caught and flagged by the Part 15 evidence check, but a
   claim that could have been verified for free. Added a matching
   evidence-first *nudge*: before accepting a final answer, the agent
   loop now checks whether it names a known file it never read, and if
   so tells the model to read it first, reusing the same nudge budget as
   the existing "you described a tool call instead of making it" nudge.
   Verified live: the same question now reads the file before answering
   (`toolsUsed` includes `read_project_file`, `flagged: false`).
5. **Agent stopping too early / grounding claims in prose instead of a real
   read** (see agent-1 and agent-4 under *Known failures* below - fixing
   these raised Agent Success from 25% to 100% on the run recorded above).
   Two distinct root causes:
   - The agent would read a thin `src/routes/` file and stop, never
     following the `require()`/`import` statements inside it to the
     service/middleware file that actually implements the behavior in
     question. Fixed with a new **delegation-chain nudge**: `memory.js`
     now extracts the relative modules a just-read file requires/imports
     (`extractRequiredModules`), resolved against that file's own path,
     and `agent.js` nudges the model to open any of those it hasn't read
     yet before finalizing - read straight off the actual `require()`
     statements in whatever file the model happened to read, never a
     hard-coded filename.
   - The agent would answer from a file path merely *mentioned in prose*
     (e.g. README.md's directory listing) without ever calling
     `list_project_files`/`search_project_files` or reading that file
     itself - a claim the Part 15 evidence-check couldn't catch either,
     since it only flags mentions of files already known through a
     list/search result. Fixed with an explicit system-prompt rule: a
     file path seen only in another file's prose is not evidence of that
     file's contents, and must be confirmed via a tool call before being
     named in the final answer.
   - Also corrected a genuinely mis-specified test case: agent-2 required
     `authMiddleware.js` specifically, but JWT verification is really
     split across two files (`authService.verifyToken()` does the
     `jwt.verify()` call; `authMiddleware.requireAuth()` invokes it to
     gate a route) - either is a defensible "validates JWT tokens" answer
     if actually read. `tests.js` now accepts either file, mirroring the
     multi-file acceptance already used for agent-1.

### Known failures in the agent category (real observed cases)

The four cases below are what motivated fix #5 above. All four now pass on
the latest run (see *Latest results*), but the failures were real,
reproduced independently of the eval script, and are kept here because
`llama3.1:8b` is non-deterministic - a future run could still regress on
any of them, and the specific failure mode each nudge targets is easier to
recognize by keeping the original case history.

- **agent-1** ("Find where authentication is implemented"): the agent read
  only `src/routes/authRoutes.js` and answered solely about that file — it
  stopped investigating before reaching `authService.js` /
  `authMiddleware.js`. Notably, it did *not* claim anything about files it
  hadn't read (no evidence-check flag) — conservative, but incomplete.
  **Now fixed and passing** - the delegation-chain nudge (fix #5) pushed
  the agent to follow `authRoutes.js`'s own `require("../services/authService")`
  to `authService.js` before finalizing (`PASS`, both files in
  `filesInspected` on the latest run).
- **agent-2** ("Which file validates JWT tokens?"): the agent read
  `authService.js` (which *issues* JWTs) and stated it validates JWTs —
  `authMiddleware.js` is the file that actually gates routes with that
  verification. This is a real reasoning/semantic distinction, not a
  tooling bug: the file it named really was read, so the evidence-check
  correctly did not flag it - the guardrail catches *unread* claims, not
  *debatable* interpretations of files that were read. On reflection this
  test was itself too narrow: `authService.verifyToken()` is the actual
  `jwt.verify()` call, so "validates JWT tokens" is a defensible answer for
  either file. **Test corrected** (fix #5) to accept either, and the case
  now passes.
- **agent-3** ("Which tests cover authentication?"): originally misrouted
  to `documentation` in the first two evaluation runs, and (once the route
  was fixed by hand) found `tests/auth.test.js` via search but answered
  before reading it. **Now fixed and passing** - both root causes (#3/#4
  above) are fixed in the code, verified both against the live server and
  by the evaluation harness re-running this exact case (`PASS`, route
  `repository`, `tests/auth.test.js` in `filesInspected`).
- **agent-4** ("Which module handles user data persistence?"): the agent
  read only `README.md`, yet still answered `userRepository.js` correctly
  by name — a plausible guess from naming conventions, not from having
  read that file. Because the agent's `search_project_files` call in that
  run never actually surfaced `userRepository.js`, the Part 15 validator
  had no record of that filename to check the claim against, so it did
  not flag this one. This is the exact heuristic limitation called out
  under *Limitations* below: the evidence-check only catches claims about
  files it saw named somewhere in the run, not every real project file.
  The evidence-first nudge (#4 above) did not help here either, for the
  same reason - it also only acts on filenames the run has actually seen.
  **Now fixed and passing** - the new doc-grounding prompt rule (fix #5)
  told the model that a path mentioned only in README.md's prose isn't
  evidence, and on the latest run the agent called `search_project_files`
  and `read_project_file` on `userRepository.js` directly instead of
  guessing from the README (`PASS`, `filesInspected` includes
  `src/repositories/userRepository.js`).

## Limitations

- **Local, CPU-bound inference.** This machine runs `llama3.1` on CPU
  (`size_vram: 0` per `ollama ps`) — prompt-eval time grows with context
  length, so `guardrails.requestTimeoutMs` is set to 90s (not the 30s in
  the exercise's illustrative example) and a multi-step agent run can take
  1-3 minutes once a couple of files are in context. A GPU-backed Ollama
  install would be much faster.
- **Small local vector store.** `knowledge/` is 4 short Markdown files (8
  chunks total) — enough to demonstrate the RAG pipeline end to end, not a
  production-scale knowledge base.
- **Local model quality.** `llama3.1:8b` sometimes answers from
  `architecture.md` instead of reading the specific source file a question
  is really about, or names a file it did not read. The evidence-check
  guardrail (Part 15) catches the latter and flags it rather than letting
  it through silently, but it doesn't force the agent to keep searching.
- **Simple routing.** The router is a single structured LLM call plus
  keyword overrides for safety-critical cases — it is not a trained
  classifier and can misroute ambiguous phrasing that doesn't match either
  the LLM's judgment or the keyword list.
- **No persistent conversation memory.** Each `/api/ask` call is
  independent; the agent's short-term memory (Part 10) lasts only for the
  duration of one request's tool-calling loop.
- **Read-only tools only.** There is intentionally no write, delete, or
  shell-execution tool of any kind — the agent cannot fix, refactor, or
  scaffold anything, only investigate and report.
- **Evaluation dataset size.** 13 cases is enough to exercise every route
  and every guardrail at least once, not a statistically rigorous
  benchmark.
- **Evidence-check heuristic.** The Part 15 validator only catches file
  names that resemble a real project path/extension and were seen via
  `list_project_files`/`search_project_files` in the same run — it will
  not catch an unverified claim phrased without a filename (e.g. "the code
  hashes passwords with bcrypt" without naming a file).

## Project structure

```
ai-engineering-assistant/
├── public/                  Frontend (index.html, styles.css, app.js)
├── knowledge/                RAG source documents
├── sample-project/           Read-only target repository for the agent
├── data/                     vectors.json, logs.jsonl, evaluation-results.json
└── src/
    ├── server.js              Express app / HTTP layer
    ├── askPipeline.js          Shared router -> workflow -> validation pipeline
    ├── router.js               Request routing (Part 3)
    ├── ollama.js                Centralised Ollama client (Part 2)
    ├── rag/                     loadDocuments, chunk, embeddings, similarity, retrieve, prompts, buildIndex
    ├── agent/                   agent.js (loop), memory.js, tools.js
    ├── mcp/                     projectServer.js, client.js
    ├── evaluation/               tests.js, evaluate.js
    ├── logging/                  logger.js
    └── security/                 guardrails.js, permissions.js, validatePath.js
```
