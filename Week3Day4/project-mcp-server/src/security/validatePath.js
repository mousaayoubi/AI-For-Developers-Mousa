import fs from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_ROOT,
  IGNORED_DIRECTORIES,
  isBlockedFilename,
  hasAllowedExtension,
} from "./permissions.js";

/**
 * Thrown for every rejected file access - path traversal, blocked files,
 * bad input, etc. `reason` is a stable machine-readable code; `message` is
 * the human-facing string that gets sent back to the MCP client.
 */
export class PathSecurityError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "PathSecurityError";
    this.reason = reason;
  }
}

/**
 * Resolves a requested file path against the sample project root and
 * enforces every access rule before any filesystem read happens:
 *
 *   1. must be a non-empty string
 *   2. the bare filename must not match a blocked name/pattern
 *      (blocks ".env" even when requested directly)
 *   3. the resolved, absolute path must stay inside PROJECT_ROOT
 *      (blocks "../../../.env" and absolute paths outside the project)
 *   4. the extension must be on the allow-list
 *
 * Returns the resolved absolute path on success; throws PathSecurityError
 * on any violation. This is the single choke point every filesystem read
 * in this server is required to go through - never trust a path that
 * hasn't passed through here.
 */
export function validateFilePath(requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new PathSecurityError("A non-empty file path is required.", "invalid_input");
  }

  const cleaned = requestedPath.trim();

  // Null bytes are a classic filesystem-check bypass trick - reject outright.
  if (cleaned.includes("\0")) {
    throw new PathSecurityError("Access denied.", "invalid_input");
  }

  const baseName = path.basename(cleaned.replace(/\\/g, "/"));
  if (isBlockedFilename(baseName)) {
    throw new PathSecurityError("Sensitive file access denied.", "blocked_file");
  }

  const resolved = path.resolve(PROJECT_ROOT, cleaned);
  const rootWithSep = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;

  if (resolved !== PROJECT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new PathSecurityError("Access denied.", "path_traversal");
  }

  if (!hasAllowedExtension(resolved)) {
    throw new PathSecurityError("Access denied.", "extension_not_allowed");
  }

  return resolved;
}

/**
 * Recursively lists every approved file inside the sample project, applying
 * the same filtering rules (blocked filenames, ignored directories, allowed
 * extensions) that validateFilePath enforces for a single file - so nothing
 * ever shows up in search results or listings that couldn't also be read
 * through read_project_file. Returns POSIX-style relative paths, sorted.
 */
export async function listProjectFiles() {
  const results = [];
  await walk(PROJECT_ROOT, results);
  return results.sort();
}

async function walk(dir, results) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), results);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isBlockedFilename(entry.name)) continue;
    if (!hasAllowedExtension(entry.name)) continue;

    const relative = path
      .relative(PROJECT_ROOT, path.join(dir, entry.name))
      .split(path.sep)
      .join("/");
    results.push(relative);
  }
}
