#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readApprovedFile, searchApprovedFiles, listProjectFiles, PathSecurityError } from "../security/validatePath.js";
import { PROJECT_ROOT } from "../security/permissions.js";

/**
 * Project MCP Server (Part 8).
 *
 * Exposes read-only access to sample-project/ through MCP, so the agent
 * never touches the filesystem directly - it only knows the MCP tool
 * names and calls them through an MCP client (see mcp/client.js).
 *
 *   Tools:     list_project_files, search_project_files, read_project_file
 *   Resources: project://architecture
 *
 * All security enforcement (path traversal, blocked files, size/result
 * limits) lives in security/validatePath.js - this file only wires MCP
 * registration to that logic.
 */
const server = new McpServer({
  name: "project-mcp-server",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: list_project_files
// ---------------------------------------------------------------------------
server.registerTool(
  "list_project_files",
  {
    title: "List project files",
    description:
      "List every approved file inside the sample project repository. Takes no arguments. " +
      "Use this first when you don't yet know what files exist.",
    inputSchema: {},
  },
  async () => {
    const files = await listProjectFiles();
    return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
  }
);

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
      query: z.string().min(1, "query must not be empty.").max(200, "query must be 200 characters or fewer."),
    },
  },
  async ({ query }) => {
    const results = await searchApprovedFiles(query);
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No files matched "${query}".` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
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
      filePath: z.string().min(1, "filePath must not be empty.").max(400, "filePath must be 400 characters or fewer."),
    },
  },
  async ({ filePath }) => {
    try {
      const result = await readApprovedFile(filePath);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      if (error instanceof PathSecurityError) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
      throw error;
    }
  }
);

// ---------------------------------------------------------------------------
// Resource: project://architecture
// ---------------------------------------------------------------------------
server.registerResource(
  "project-architecture",
  "project://architecture",
  {
    title: "Project architecture",
    description: "The sample project's architecture documentation (sample-project/architecture.md).",
    mimeType: "text/markdown",
  },
  async (uri) => {
    try {
      const result = await readApprovedFile("architecture.md");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: result.content }] };
    } catch {
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: "architecture.md was not found in the project." }],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Transport: stdio
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for MCP protocol messages - all logging must go to
  // stderr, or it will corrupt the stdio JSON-RPC stream.
  console.error(`Project MCP server running on stdio (root: ${PROJECT_ROOT})`);
}

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error starting Project MCP server:", error);
    process.exit(1);
  });
}
