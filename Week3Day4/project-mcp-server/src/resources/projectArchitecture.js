import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../security/permissions.js";

/** The single file this resource is allowed to serve. Not derived from any
 *  client-supplied input, so there is nothing here for path traversal to
 *  exploit. */
const ARCHITECTURE_FILE = path.join(PROJECT_ROOT, "architecture.md");

/**
 * Backing logic for the project://architecture MCP resource.
 *
 * Returns the contents of sample-project/architecture.md, or a clear
 * error object if the file is missing - never throws for a missing file,
 * since a resource read should fail safely just like a tool call.
 */
export async function getProjectArchitecture() {
  try {
    const content = await fs.readFile(ARCHITECTURE_FILE, "utf8");
    return { found: true, content };
  } catch {
    return { found: false, content: "" };
  }
}
