# Bug Report Analyser

A small Vanilla JavaScript app that sends a bug report to a **local Ollama
model** and gets back a structured diagnosis (`summary`, `severity`,
`possibleCauses`, `nextStep`). Built with system/user/assistant messages,
reusable prompt files, structured JSON output, and a `get_project_info`
tool the model can call instead of guessing at project details.

## Project structure

```
bug-report-analyser/
├── public/
│   ├── index.html        # form + results UI
│   ├── styles.css
│   └── app.js             # fetch(), client-side validation, rendering
│
├── src/
│   ├── prompts/
│   │   ├── systemPrompt.js        # debugging-assistant persona & rules
│   │   └── bugAnalysisPrompt.js   # builds the user message from form fields
│   │
│   ├── tools/
│   │   └── projectInfo.js         # get_project_info tool + definition
│   │
│   ├── services/
│   │   └── llm.js                 # talks to Ollama, tool-call loop, validation
│   │
│   └── server.js                  # Express server + /api/analyze endpoint
│
├── package.json
└── README.md
```

The browser never talks to Ollama directly — it calls `POST /api/analyze`
on the small Express server, which owns the conversation with Ollama
(system prompt, tool calling, structured output) and returns clean,
validated JSON to the frontend.

## Prerequisites

1. **[Ollama](https://ollama.com)** installed and running:
   ```bash
   ollama serve
   ```
2. A tool-calling-capable model pulled locally, e.g.:
   ```bash
   ollama pull llama3.2:3b
   ```
   This was verified end-to-end with `llama3.2:3b` (~2GB, ~15-35s per
   analysis on CPU) — it reliably calls `get_project_info` and returns
   valid structured JSON. `llama3.1`, `qwen2.5`, `mistral-nemo`, or any
   other Ollama model that supports `tools` + structured `format` also
   works — set `OLLAMA_MODEL` below. **Avoid large (20B+) models on
   CPU-only machines** — a 26B model tested here took >60s to even start
   responding to a trivial prompt, making the app unusably slow since
   each analysis needs 2+ round trips.
3. **Node.js 18+** (for built-in `fetch`).

## Setup & run

```bash
cd bug-report-analyser
npm install
npm start
```

Then open **http://localhost:3000**.

### Configuration (optional environment variables)

| Variable       | Default                              | Purpose                          |
|----------------|---------------------------------------|-----------------------------------|
| `OLLAMA_URL`   | `http://localhost:11434/api/chat`    | Ollama chat endpoint              |
| `OLLAMA_MODEL` | `llama3.1`                            | Model to use (e.g. `llama3.2:3b`) |
| `PORT`         | `3000`                                | Express server port               |

## How it works

1. The user fills in **Expected**, **Actual**, **Error**, **Reproduction**
   (and an optional free-text question).
2. The server builds `messages: [system, user]` using
   `prompts/systemPrompt.js` and `prompts/bugAnalysisPrompt.js`, and calls
   Ollama's `/api/chat` with the `get_project_info` tool declared.
3. **Tool calling:** if the model requests `get_project_info(section)`,
   the server runs the real function in `tools/projectInfo.js`, appends
   the result as a `tool` message, and calls the model again — up to 4
   rounds.
4. **Structured output:** once the model has no more tool calls to make,
   the server asks it to finalize its answer and sends the request again
   with `format` set to a JSON schema
   (`summary` / `severity` / `possibleCauses` / `nextStep`, severity
   constrained to `low | medium | high | critical`), which Ollama enforces
   at generation time.
5. The server **validates** the parsed JSON (required fields + severity
   enum) before returning it. The **frontend also validates independently**
   before rendering, so a bad payload never reaches the UI unchecked.
6. The UI renders each field as its own section — summary text, a colored
   severity badge, a bulleted cause list, and the next step. The raw JSON
   is available in a collapsed "debug" `<details>` panel, never as the
   primary UI.

## Testing the app

### Test 1 — Normal bug report
Fill in all four fields, e.g.:
- Expected: `Invalid login should return 401.`
- Actual: `The API returns 500.`
- Error: `Cannot read properties of null.`
- Reproduction: `Attempt login using an email that does not exist.`

**Expected result:** a structured analysis with summary, severity,
possible causes, and a next step.

### Test 2 — Missing information
Leave most fields blank or vague (e.g. only fill in "Actual: it doesn't
work"). The system prompt instructs the model to name what's missing
instead of inventing details — check `possibleCauses`/`nextStep` call out
the missing information rather than fabricating a root cause.

### Test 3 — Project information via tool
Fill in a bug report and add to **Additional question**:
`Could this issue be related to the testing framework?`

**Expected result:** open the "Tool calls used by the model" panel under
the result — it should show `get_project_info("testing")` and the
returned value (`Vitest and Supertest`), and the analysis text should
reference it.

### Test 4 — Invalid/malformed response
Check **"Simulate a malformed AI response"** before submitting. This
bypasses Ollama entirely and returns a deliberately broken payload
(invalid `severity`, wrong type for `nextStep`). The app should show a
red error banner explaining what's wrong — not crash, not render garbage.

## Error handling

The server distinguishes:
- **503** — Ollama isn't running (`fetch` connection refused)
- **502** — the configured model isn't pulled / Ollama returned an error
- **422** — the model's response couldn't be parsed or failed validation
- **400** — the submitted bug report was empty

The frontend surfaces all of these as a plain-language banner instead of
an unhandled exception or a raw stack trace.
