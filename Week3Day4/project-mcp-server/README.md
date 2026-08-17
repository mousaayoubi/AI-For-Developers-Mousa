# Project MCP Server

A vanilla JavaScript MCP server that exposes read-only, security-bounded
access to a sample project (`sample-project/`) through the [Model Context
Protocol](https://modelcontextprotocol.io/). It is the MCP equivalent of the
Week 3 Day 3 Read-Only Repository Agent: the same repository logic
(search, read, path validation), but reached through a standard MCP
interface instead of being wired directly into one agent.

```
AI Application
      ↓
MCP Client
      ↓
Project MCP Server
      ↓
sample-project/
```

## What this server exposes

| Type     | Name                      | Purpose                                             |
| -------- | ------------------------- | ---------------------------------------------------- |
| Tool     | `search_project_files`    | Search approved project files for a word/phrase      |
| Tool     | `read_project_file`       | Read one approved project file                       |
| Resource | `project://architecture`  | The project's architecture documentation             |
| Prompt   | `analyse_codebase`        | Reusable instructions for analysing the repository   |

### Tool: `search_project_files`

- **Purpose**: Case-insensitive substring search for a word or phrase across
  every approved file in `sample-project/`.
- **Input**:
  ```json
  { "query": "authentication" }
  ```
  `query` must be a string, 1–200 characters. Empty strings, non-strings, and
  overly long queries are rejected by the input schema before the handler
  ever runs.
- **Output**: A JSON array of matches, most matches first, e.g.
  ```json
  [
    { "file": "src/routes/authRoutes.js", "matches": 1 },
    { "file": "src/services/authService.js", "matches": 1 }
  ]
  ```
  A query with no hits returns a plain "No files matched" message rather
  than an empty array framed as an error — there is nothing wrong with the
  request, there's just nothing to find.
- **Restrictions**: Only searches files inside `sample-project/` that pass
  the allow-listed-extension and not-blocked-filename rules (see
  [Security model](#security-model)). Blocked files (e.g. `.env`) are never
  read, so their contents can never leak through a search hit either.

### Tool: `read_project_file` (optional feature, implemented)

- **Purpose**: Read the full contents of one approved project file.
- **Input**:
  ```json
  { "filePath": "src/services/authService.js" }
  ```
  `filePath` must be a string, 1–400 characters.
- **Output**:
  ```json
  { "file": "src/services/authService.js", "content": "..." }
  ```
  Content over 8000 characters is truncated with a `[truncated]` marker.
- **Restrictions**: Every request passes through `security/validatePath.js`
  before any filesystem access:
  1. Must be a non-empty string with no null bytes.
  2. The bare filename must not match a blocked name/pattern (e.g. `.env`,
     `credentials.json`, `private-key.pem`, anything containing `secret`).
  3. The resolved absolute path must stay inside `sample-project/` — this is
     what rejects `../../../.env`-style path traversal.
  4. The extension must be on the allow-list (`.js`, `.ts`, `.md`, `.json`).
  5. As defense in depth, the resolved path must also appear in the same
     approved-file listing that `search_project_files` uses.

  Any failure returns a tool error result (`isError: true`) with a short
  message ("Access denied." / "Sensitive file access denied." / "File not
  found.") instead of throwing or returning file contents.

### Resource: `project://architecture`

- **Purpose**: Returns the contents of `sample-project/architecture.md` —
  the project's architecture documentation — as context a client can read
  without calling a tool.
- **Input**: None (fixed URI).
- **Output**: The Markdown contents of `architecture.md` as `text/markdown`.
- **Restrictions**: Backed by a single, hard-coded path inside
  `sample-project/`. It never accepts a client-supplied path, so there is no
  traversal surface here at all.

### Prompt: `analyse_codebase` (optional feature, implemented)

- **Purpose**: Reusable instructions for analysing the repository —
  architecture, maintainability, testing, and security — that ask the model
  to use the available tools/resource rather than guessing, and to separate
  confirmed findings from assumptions.
- **Input**: None.
- **Output**: A single user-role prompt message containing the analysis
  instructions.

## Security model

```
Requested path
      ↓
Resolve absolute path
      ↓
Check project boundary   (must resolve inside sample-project/)
      ↓
Check blocked filenames  (.env, credentials.json, private-key.pem, *secret*, ...)
      ↓
Check allowed extensions (.js, .ts, .md, .json)
      ↓
Allow or reject
```

All of this lives in `src/security/permissions.js` (the rules) and
`src/security/validatePath.js` (the enforcement + the approved-file
listing used by both tools). Nothing in `src/tools/` or `src/server.js`
touches the filesystem without going through `validateFilePath` /
`listProjectFiles` first — the boundary is enforced in code, not left to
model instructions.

`sample-project/.env` exists specifically so this boundary can be tested:
requesting it directly, or via `../../../.env`, is rejected before any file
read is attempted.

## Project structure

```
project-mcp-server/
├── src/
│   ├── server.js                   MCP registration + stdio transport
│   ├── tools/
│   │   ├── searchProjectFiles.js   search_project_files logic
│   │   └── readProjectFile.js      read_project_file logic
│   ├── resources/
│   │   └── projectArchitecture.js  project://architecture logic
│   ├── prompts/
│   │   └── analyseCodebase.js      analyse_codebase prompt text
│   └── security/
│       ├── permissions.js          project root, block-lists, allow-list
│       └── validatePath.js         path validation + approved-file listing
├── sample-project/                 the read-only target repository
│   ├── README.md
│   ├── architecture.md
│   ├── .env                        intentionally blocked, for testing
│   ├── src/
│   └── tests/
└── package.json
```

The MCP layer (`server.js`) is kept separate from the repository logic
(`tools/`, `resources/`, `security/`) so the underlying functions can be
unit tested or reused outside of MCP entirely.

## Install

```bash
npm install
```

## Start the server

```bash
npm start
```

The server communicates over stdio (stdin/stdout carry the MCP JSON-RPC
protocol). All logging goes to stderr via `console.error`, so it never
corrupts the protocol stream — you'll see `Project MCP server running on
stdio` printed there on startup. A bare `npm start` will then appear to
hang with no further output; that's expected; it's waiting for a client to
connect over stdin/stdout.

## Launch MCP Inspector

```bash
npx @modelcontextprotocol/inspector node src/server.js
```

or

```bash
npm run inspector
```

This opens the Inspector UI in your browser, connected to the server via
stdio. From there you can browse and call every capability interactively.

## Test the server

### Capability discovery

Connect with Inspector and confirm you see:

```
Tools
├── search_project_files
└── read_project_file

Resources
└── project://architecture

Prompts
└── analyse_codebase
```

### Valid search

Call `search_project_files` with:

```json
{ "query": "authentication" }
```

Expect matching files such as `src/routes/authRoutes.js` and
`src/services/authService.js`.

### Resource access

Read `project://architecture`. Expect the Markdown contents of
`sample-project/architecture.md`.

### Empty / invalid search

```json
{ "query": "" }
```

```json
{ "query": 42 }
```

Both are rejected by the input schema with a validation error — the
handler never runs.

### Sensitive file

Call `read_project_file` with:

```json
{ "filePath": ".env" }
```

Expect `Sensitive file access denied.` and no file contents.

### Path traversal

```json
{ "filePath": "../../../.env" }
```

Expect a denial (`Sensitive file access denied.` for this exact input,
since `.env` is also a blocked filename; a traversal attempt against a
non-blocked filename, e.g. `../../package.json`, is rejected as `Access
denied.` instead — either way, nothing outside `sample-project/` is ever
read).

### Unknown information

Search for a term that doesn't exist in the project, e.g.
`zzz_nonexistent_zzz`. Expect a clear "No files matched" response, not an
invented answer.

## Notes

- Everything here is vanilla JavaScript (ESM, Node.js) — no TypeScript
  build step.
- The only third-party dependencies are `@modelcontextprotocol/sdk` (MCP
  server primitives + stdio transport) and `zod` (input schema
  validation).
