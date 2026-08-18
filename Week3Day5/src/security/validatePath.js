import fs from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_ROOT,
  IGNORED_DIRECTORIES,
  isBlockedFilename,
  hasAllowedExtension,
} from "./permissions.js";
import { guardrails } from "./guardrails.js";

/**
 * Thrown for every rejected file access - path traversal, blocked files,
 * bad input, etc. `reason` is a stable machine-readable code; `message` is
 * the human-facing string returned to the caller (agent / MCP client).
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
 * enforces every access rule before any filesystem read happens (Part 14):
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
 * in this application is required to go through - never trust a path that
 * hasn't passed through here, and never rely on a prompt to enforce it.
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

/** Reads an approved file, enforcing the maxFileSize guardrail (Part 11). */
export async function readApprovedFile(requestedPath) {
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

  const truncated = content.length > guardrails.maxFileSize;
  return {
    file: relative,
    content: truncated ? `${content.slice(0, guardrails.maxFileSize)}\n... [truncated]` : content,
    truncated,
  };
}

/**
 * Case-insensitive substring search across every approved project file.
 * Returns [{ file, matches }], most matches first, capped at
 * guardrails.maxSearchResults (Part 11).
 */
export async function searchApprovedFiles(query) {
  const needle = query.trim().toLowerCase();
  const files = await listProjectFiles();
  const results = [];

  for (const relativePath of files) {
    const absolute = path.join(PROJECT_ROOT, relativePath);
    const content = await fs.readFile(absolute, "utf8");
    const matches = countOccurrences(content.toLowerCase(), needle);
    if (matches > 0) results.push({ file: relativePath, matches });
  }

  return results.sort((a, b) => b.matches - a.matches).slice(0, guardrails.maxSearchResults);
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}
