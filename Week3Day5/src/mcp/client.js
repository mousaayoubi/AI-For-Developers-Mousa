/**
 * MCP client wrapper (Part 8). Spawns the Project MCP Server as a child
 * process over stdio and exposes its tools/resources through plain async
 * functions, so the agent never needs to know repository access is
 * implemented as a separate MCP server at all - it only sees "call this
 * tool, get this result."
 *
 * Handles the "MCP Failure" path from Part 12: a broken connection is
 * retried exactly once (a fresh reconnect); if that also fails, callers
 * get a McpUnavailableError instead of a fabricated success, so the agent
 * can stop investigating honestly rather than pretend repository access
 * worked.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, "projectServer.js");

export class McpUnavailableError extends Error {}

let client = null;
let connecting = null;

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    stderr: "pipe",
  });
  const c = new Client({ name: "ai-engineering-assistant", version: "1.0.0" });
  await c.connect(transport);
  return c;
}

async function getClient() {
  if (client) return client;
  if (!connecting) {
    connecting = connect()
      .then((c) => {
        client = c;
        connecting = null;
        return c;
      })
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}

/**
 * Drops the current connection so the next call reconnects from scratch.
 * Awaits close() so the child process is actually terminated before this
 * returns - otherwise its open stdio pipes keep the parent Node process
 * alive indefinitely, which matters for one-shot scripts (evaluate.js)
 * even though server.js never calls this in normal operation.
 */
async function resetConnection() {
  const closing = client;
  client = null;
  connecting = null;
  try {
    await closing?.close?.();
  } catch {
    // ignore - we're already discarding this connection
  }
}

/**
 * Calls a tool on the Project MCP Server, retrying once on any transport
 * failure with a fresh connection.
 *
 * @param {string} name Tool name, e.g. "search_project_files".
 * @param {object} args Tool arguments.
 * @param {object} [options]
 * @param {object} [options.metrics] Accumulator - increments mcpCalls/mcpMs.
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
export async function callProjectTool(name, args, options = {}) {
  const { metrics } = options;
  const start = Date.now();

  const attempt = async () => {
    const c = await getClient();
    const result = await c.callTool({ name, arguments: args });
    const text = result.content?.map((block) => block.text ?? "").join("\n") ?? "";
    return { text, isError: Boolean(result.isError) };
  };

  try {
    const result = await attempt();
    if (metrics) {
      metrics.mcpCalls = (metrics.mcpCalls || 0) + 1;
      metrics.mcpMs = (metrics.mcpMs || 0) + (Date.now() - start);
    }
    return result;
  } catch (err) {
    if (metrics) metrics.retryCount = (metrics.retryCount || 0) + 1;
    resetConnection();
    try {
      const result = await attempt();
      if (metrics) {
        metrics.mcpCalls = (metrics.mcpCalls || 0) + 1;
        metrics.mcpMs = (metrics.mcpMs || 0) + (Date.now() - start);
      }
      return result;
    } catch (retryErr) {
      resetConnection();
      throw new McpUnavailableError(
        `Project MCP server is unavailable after a retry: ${retryErr.message}`
      );
    }
  }
}

/** Reads the project://architecture MCP resource. */
export async function readProjectArchitectureResource(options = {}) {
  const { metrics } = options;
  const start = Date.now();
  try {
    const c = await getClient();
    const result = await c.readResource({ uri: "project://architecture" });
    if (metrics) {
      metrics.mcpCalls = (metrics.mcpCalls || 0) + 1;
      metrics.mcpMs = (metrics.mcpMs || 0) + (Date.now() - start);
    }
    return result.contents?.[0]?.text ?? "";
  } catch (err) {
    resetConnection();
    throw new McpUnavailableError(`Could not read project://architecture: ${err.message}`);
  }
}

/** Closes the MCP connection (used on server shutdown / one-shot scripts). */
export async function closeMcpClient() {
  await resetConnection();
}
