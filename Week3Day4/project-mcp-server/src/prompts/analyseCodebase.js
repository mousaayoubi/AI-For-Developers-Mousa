/**
 * Backing text for the analyse_codebase MCP prompt.
 *
 * This is reusable workflow guidance, not data or an action - it tells a
 * model *how* to use the search_project_files tool, the read_project_file
 * tool, and the project://architecture resource together, without hunting
 * for a "right" set of instructions itself each time.
 */
export const ANALYSE_CODEBASE_PROMPT = `Analyse the project repository exposed by this MCP server.

Focus on:

- Architecture
- Maintainability
- Testing
- Security

Use the available project information where required:
- Read the project://architecture resource for the intended design.
- Use search_project_files to locate relevant files before reading them in full.
- Use read_project_file to inspect the files you found.

Separate confirmed findings (backed by something you actually read) from
assumptions (reasonable guesses you could not verify). Do not report a
finding as confirmed unless you have read the file or resource it is based
on. If a file or answer is not accessible through the approved tools, say so
plainly instead of inventing its contents.`;
