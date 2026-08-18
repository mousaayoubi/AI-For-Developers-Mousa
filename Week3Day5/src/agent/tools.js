/**
 * Repository tools available to the agent, expressed both as the Ollama
 * tool-calling schema (TOOL_DEFS) and as executable functions that go
 * through the MCP client rather than touching the filesystem directly
 * (Part 7/8/9). The agent only ever sees these three tool names - it has
 * no other way to interact with the repository.
 */
import { callProjectTool, McpUnavailableError } from "../mcp/client.js";
import { guardrails } from "../security/guardrails.js";

export class ToolBlockedError extends Error {}
export class UnknownToolError extends Error {}

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_project_files",
      description:
        "List every approved file inside the sample project repository. Takes no arguments. " +
        "Use this first when you don't yet know what files exist.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_project_files",
      description:
        "Search all approved project files for a word or phrase and return which files contain " +
        "it and how many times. Use this to narrow down which files are relevant before reading " +
        "whole files - much cheaper than reading everything.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: 'The word or phrase to search for, e.g. "authentication" or "JWT".',
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_project_file",
      description:
        "Read the full contents of one approved project file, given its path exactly as returned " +
        'by list_project_files or search_project_files (e.g. "src/services/authService.js"). ' +
        "Cannot read .env or any other blocked/sensitive file, or anything outside the project.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: 'Relative path of the file to read, e.g. "src/services/authService.js".',
          },
        },
        required: ["filePath"],
      },
    },
  },
];

export const KNOWN_TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.function.name));

/**
 * Executes one tool call through the MCP client. JavaScript - not the
 * model - decides what is actually permitted (Part 11): the tool allow
 * list is checked here regardless of what the model asked for.
 *
 * @param {string} name
 * @param {object} args
 * @param {object} [metrics] Accumulator from ollama.js's newMetrics().
 */
export async function executeTool(name, args, metrics) {
  if (!guardrails.toolAllowList.includes(name)) {
    throw new ToolBlockedError(`Tool "${name}" is not on the approved tool allow list.`);
  }
  if (!KNOWN_TOOL_NAMES.has(name)) {
    throw new UnknownToolError(`Unknown tool "${name}".`);
  }

  const mcpArgs = name === "list_project_files" ? {} : args;
  const { text, isError } = await callProjectTool(name, mcpArgs, { metrics });

  if (isError) {
    // The MCP server returns isError for security rejections (blocked
    // file, path traversal, etc.) - surface that as a blocked-tool error
    // rather than a generic failure, so the agent gets a clear signal it
    // must not retry the same path.
    throw new ToolBlockedError(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export { McpUnavailableError };
