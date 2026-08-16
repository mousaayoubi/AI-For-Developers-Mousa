import path from "node:path";
import {
  PROJECT_ROOT,
  isBlockedFilename,
  hasAllowedExtension,
} from "./permissions.js";

/** Thrown for every rejected file access - path traversal, blocked files, bad input, etc. */
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
 *   2. the resolved, absolute path must stay inside PROJECT_ROOT
 *      (blocks "../../../.env" and absolute paths outside the project)
 *   3. the bare filename must not match a blocked name/pattern
 *      (blocks ".env" even when requested directly)
 *   4. the extension must be on the allow-list
 *
 * Returns the resolved absolute path on success; throws PathSecurityError
 * on any violation. This is the single choke point read_project_file (and
 * nothing else) is allowed to read through.
 */
export function validateFilePath(requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new PathSecurityError("A non-empty file path is required.", "invalid_input");
  }

  const cleaned = requestedPath.trim();

  // Null bytes are a classic filesystem-check bypass trick - reject outright.
  if (cleaned.includes("\0")) {
    throw new PathSecurityError("File access denied.", "invalid_input");
  }

  const baseName = path.basename(cleaned.replace(/\\/g, "/"));
  if (isBlockedFilename(baseName)) {
    throw new PathSecurityError("Sensitive file access denied.", "blocked_file");
  }

  const resolved = path.resolve(PROJECT_ROOT, cleaned);
  const rootWithSep = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;

  if (resolved !== PROJECT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new PathSecurityError("File access denied.", "path_traversal");
  }

  if (!hasAllowedExtension(resolved)) {
    throw new PathSecurityError("File access denied.", "extension_not_allowed");
  }

  return resolved;
}
