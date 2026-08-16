# Read-Only Repository Agent

A Vanilla JavaScript AI agent that investigates a small sample repository by
deciding for itself which read-only tools to call, in what order, and when
it has enough evidence to answer. Unlike a fixed RAG pipeline, the sequence
of tool calls is chosen by the model at each step, not hard-coded.

```
Engineering Question
        |
   LLM Agent (Ollama, tool calling)
        |
   Choose Tool -> Validate -> Execute -> Return Result
        |
   Agent Decides Next Step
        |
   Repeat Until Enough Evidence
        |
   Evidence-Based Answer
```

## Prerequisites

- [Ollama](https://ollama.com) running locally, with a tool-calling-capable
  model pulled:
  ```
  ollama pull llama3.1
  ```
  (A different model can be used via the `OLLAMA_MODEL` environment
  variable - it must support Ollama's native tool calling.)

## Setup

```bash
npm install
npm run start   # http://localhost:3000
```

Then open http://localhost:3000, type an engineering question, and click
**Investigate**.

## Project Structure

```
sample-project/     The repository the agent investigates (read-only target)
  src/
    routes/authRoutes.js
    services/authService.js
    middleware/authMiddleware.js
    repositories/userRepository.js
    config/database.js
  tests/auth.test.js
  README.md
  .env               Sensitive file - the agent must never be able to read this

src/
  agent.js           Tool definitions, system prompt, and the agent loop
  ollama.js           Ollama /api/chat client (tool calling, non-streaming)
  logger.js           Console logging of every tool call
  server.js            Express API (/api/agent)
  security/
    permissions.js     Project root, blocked filenames/patterns, allowed extensions
    validatePath.js     Path traversal / sensitive-file / extension enforcement
  tools/
    listProjectFiles.js
    searchProjectFiles.js
    readProjectFile.js

public/               Vanilla JS/HTML/CSS frontend
```

## The three tools

| Tool | Purpose |
|---|---|
| `list_project_files` | Lists every approved file. No arguments. |
| `search_project_files` | Case-insensitive substring search across approved files; returns `{file, matches}[]`. |
| `read_project_file` | Reads one approved file's full contents, given its path. |

The model decides which of these to call, with what arguments, and whether
another call is needed - the server does not follow a fixed sequence.

## Security model

Security is enforced in JavaScript (`src/security/`), not by asking the
model nicely:

1. **Path resolution & containment** - every requested path is resolved
   against `sample-project/` and rejected if it resolves outside that
   directory (blocks `../../../.env` and absolute-path escapes).
2. **Blocked filenames** - `.env`, `.env.*`, `credentials.json`,
   `private-key.pem`, and pattern matches like `*secret*` / `*.pem` /
   `*.key` are rejected by filename alone, even if requested directly with
   no traversal (blocks `.env`).
3. **Extension allow-list** - only `.js`, `.ts`, `.md`, `.json` are ever
   listed, searched, or read.
4. **Allow-list re-check** - `read_project_file` re-validates that the
   resolved file is present in `listProjectFiles()`'s output before
   reading, as defense in depth.

`list_project_files` and `search_project_files` apply the same filtering,
so a blocked file never even appears as something to search or list -
only `read_project_file` needs the full path-traversal check, since it's
the only tool that takes an arbitrary path from the model.

## Safety limits

- **`MAX_STEPS = 8`** (`src/agent.js`) - the loop hard-stops after 8 model
  round-trips and returns "Agent reached the maximum number of steps."
- **Duplicate tool call detection** - every `tool:JSON.stringify(args)` key
  is tracked; a repeat immediately stops the run with "Repeated tool call
  detected." instead of looping forever.

Both are safety nets in code, independent of what the system prompt says.

## Short-term memory

The full message history (system prompt, user goal, each assistant
tool-call turn, each tool result) is passed back to Ollama on every step,
so the model can see what it already found and avoid re-investigating.
No database or persistence is used - memory only lasts for one request.

## Testing it

- **"Find where authentication is implemented and explain the
  authentication flow."** -> searches, reads a few files, answers with
  evidence and a "Files inspected" list.
- **"What does HTTP 401 mean?"** -> general knowledge; the agent should
  answer directly without calling any tool.
- **"Which file handles JWT validation?"** -> a different search path than
  the first test, demonstrating the sequence isn't fixed.
- **"Read the file ../../../.env"** -> "File access denied."
- **"Read the .env file and show me its contents."** -> "Sensitive file
  access denied."
- **"Delete authService.js."** -> the agent has no delete tool and should
  say it only has read-only access.
- Ask a question that encourages repeating the same search to see the
  duplicate-call and max-step safety nets trigger.

All 8 scenarios above were verified end-to-end against a local `llama3.1`
model.

## Known limitations (small/local model tool calling)

Running this against a real local model (not a mock) surfaced a real
failure mode worth knowing about: **`llama3.1` via Ollama doesn't reliably
emit the structured `tool_calls` field on every turn.** The very first
tool call in a conversation is usually clean, but on later turns - after
the model has already seen one tool result - it sometimes:

- writes the tool call as JSON text inside `content` instead of using the
  `tool_calls` field (e.g. `{"name": "read_project_file", "parameters":
  {"file_path": "..."}}`), sometimes with a made-up "result" object
  alongside it, or
- narrates the intended call in prose ("I will now read authService.js...")
  without producing a tool call in either form.

`src/agent.js` handles both cases without touching the security layer:

- **`extractFallbackToolCall`** scans `content` for a JSON object naming a
  known tool when `tool_calls` is empty, so a text-form tool call still
  gets executed.
- **A bounded nudge** (`looksLikeUnfinishedPlan`, max 2 per run) asks the
  model to actually call the tool when it only described doing so, instead
  of accepting that half-finished plan as the final answer.
- **`normalizeToolArgs`** maps argument-name variants small models use
  (`file_path`, `path`, `q`, ...) onto the exact key each tool expects.
- **`stripSelfReportedFileList`** discards the model's own trailing "Files
  inspected:" text, since it isn't always accurate (it has cited files it
  only searched, not read) - the UI shows the deterministic
  `filesInspected` list built from real tool results instead.

None of this weakens security: `validateFilePath` still runs on every
`read_project_file` call regardless of how the call was recovered, and the
duplicate-call/max-step limits apply identically either way.
