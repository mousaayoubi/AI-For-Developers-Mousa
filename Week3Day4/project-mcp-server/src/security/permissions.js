import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The only directory the MCP server is ever allowed to touch. */
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "sample-project");

/** Exact filenames that are never readable, listable, or searchable, whatever
 *  the path used to reach them. */
export const BLOCKED_FILENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "credentials.json",
  "private-key.pem",
]);

/** Filename patterns that catch variants of the exact names above. */
export const BLOCKED_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /credentials/i,
  /secret/i,
  /private[-_]?key/i,
];

/** Only these extensions are ever listed, searched, or read. */
export const ALLOWED_EXTENSIONS = new Set([".js", ".ts", ".md", ".json"]);

/** Directories that are never descended into. */
export const IGNORED_DIRECTORIES = new Set(["node_modules", ".git"]);

/** True if a bare filename (no directories) is blocked for any reason. */
export function isBlockedFilename(name) {
  const lower = name.toLowerCase();
  if (BLOCKED_FILENAMES.has(lower)) return true;
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(lower));
}

/** True if a file's extension is on the allowed list. */
export function hasAllowedExtension(name) {
  return ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase());
}
