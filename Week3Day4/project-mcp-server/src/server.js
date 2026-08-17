#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchProjectFiles } from "./tools/searchProjectFiles.js";
import { readProjectFile } from "./tools/readProjectFile.js";
import { getProjectArchitecture } from "./resources/projectArchitecture.js";
import { ANALYSE_CODEBASE_PROMPT } from "./prompts/analyseCodebase.js";
import { PathSecurityError } from "./security/validatePath.js";

/**
 * Project MCP Server
 *
 * Exposes read-only access to sample-project/ through MCP, so any MCP
 * client (not just one hard-wired agent) can search, read, and get
 * documentation about the project through a standard interface:
 *
 *   Tools:     search_project_files, read_project_file
 *   Resources: project://architecture
 *   Prompts:   analyse_codebase
 *
 * This file only wires MCP registration to the repository logic in
 * tools/, resources/, and prompts/ - it contains no filesystem access or
 * security logic of its own. All access control lives in security/.
 */
const server = new McpServer({
  name: "project-mcp-server",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: search_project_files
// ---------------------------------------------------------------------------
server.registerTool(
  "search_project_files",
  {
    title: "Search project files",
    description:
      "Case-insensitive substring search for a word or phrase across every approved file " +
      "in the sample project. Returns the matching files sorted by number of hits.",
    inputSchema: {
      query: z
        .string()
        .min(1, "query must not be empty.")
        .max(200, "query must be 200 characters or fewer."),
    },
  },
  async ({ query }) => {
    const results = await searchProjectFiles(query);

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No files matched "${query}".` }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: read_project_file
// ---------------------------------------------------------------------------
server.registerTool(
  "read_project_file",
  {
    title: "Read project file",
    description:
      "Reads one approved file from the sample project. Rejects paths outside the project " +
      "directory and requests for sensitive files (e.g. .env, credentials.json).",
    inputSchema: {
      filePath: z
        .string()
        .min(1, "filePath must not be empty.")
        .max(400, "filePath must be 400 characters or fewer."),
    },
  },
  async ({ filePath }) => {
    try {
      const result = await readProjectFile(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      if (error instanceof PathSecurityError) {
        return {
          content: [{ type: "text", text: error.message }],
          isError: true,
        };
      }
      throw error;
    }
  },
);

// ---------------------------------------------------------------------------
// Resource: project://architecture
// ---------------------------------------------------------------------------
server.registerResource(
  "project-architecture",
  "project://architecture",
  {
    title: "Project architecture",
    description: "The project's architecture documentation (sample-project/architecture.md).",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const { found, content } = await getProjectArchitecture();

    if (!found) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "architecture.md was not found in the project.",
          },
        ],
      };
    }

    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
    };
  },
);

// ---------------------------------------------------------------------------
// Prompt: analyse_codebase
// ---------------------------------------------------------------------------
server.registerPrompt(
  "analyse_codebase",
  {
    title: "Analyse codebase",
    description:
      "Reusable instructions for analysing the project repository: architecture, " +
      "maintainability, testing, and security.",
  },
  async () => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: ANALYSE_CODEBASE_PROMPT },
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// Transport: stdio
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for MCP protocol messages - all logging must go to
  // stderr, or it will corrupt the stdio JSON-RPC stream.
  console.error("Project MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting Project MCP server:", error);
  process.exit(1);
});
