import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../security/permissions.js";
import { validateFilePath, listProjectFiles, PathSecurityError } from "../security/validatePath.js";

const MAX_CONTENT_LENGTH = 8000;

/**
 * Repository logic for the read_project_file MCP tool, kept independent of
 * MCP itself so it can be unit tested or reused elsewhere.
 *
 * All security enforcement lives here (or in validateFilePath /
 * listProjectFiles, which this calls) - never in a system prompt. Path
 * traversal ("../../../.env"), blocked filenames (".env" requested
 * directly), and disallowed extensions are all rejected before any
 * filesystem read is attempted. Throws PathSecurityError on any violation.
 */
export async function readProjectFile(requestedPath) {
  const resolved = validateFilePath(requestedPath);

  // Defense in depth: the resolved file must also be part of the approved
  // listing (same rules listProjectFiles applies), so anything that could
  // slip past validateFilePath's checks (e.g. a symlink) still gets caught.
  const relative = path.relative(PROJECT_ROOT, resolved).split(path.sep).join("/");
  const approvedFiles = await listProjectFiles();
  if (!approvedFiles.includes(relative)) {
    throw new PathSecurityError("Access denied.", "not_in_allowlist");
  }

  let content;
  try {
    content = await fs.readFile(resolved, "utf8");
  } catch {
    throw new PathSecurityError("File not found.", "not_found");
  }

  const truncated = content.length > MAX_CONTENT_LENGTH;
  return {
    file: relative,
    content: truncated ? `${content.slice(0, MAX_CONTENT_LENGTH)}\n... [truncated]` : content,
  };
}
