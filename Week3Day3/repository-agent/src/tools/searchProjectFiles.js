import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../security/permissions.js";
import { listProjectFiles } from "./listProjectFiles.js";

const MAX_QUERY_LENGTH = 100;

/** Thrown when the model calls search_project_files with a bad argument. */
export class ToolValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolValidationError";
  }
}

/**
 * Tool: search_project_files
 *
 * Case-insensitive substring search for `query` across every approved
 * project file. Returns [{ file, matches }], most matches first, omitting
 * files with zero hits - lets the agent narrow down which files matter
 * before reading any of them in full.
 */
export async function searchProjectFiles(query) {
  if (typeof query !== "string") {
    throw new ToolValidationError("query must be a string.");
  }

  const trimmed = query.trim();
  if (!trimmed) {
    throw new ToolValidationError("query must not be empty.");
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new ToolValidationError(`query must be ${MAX_QUERY_LENGTH} characters or fewer.`);
  }

  const files = await listProjectFiles();
  const needle = trimmed.toLowerCase();
  const results = [];

  for (const relativePath of files) {
    const absolute = path.join(PROJECT_ROOT, relativePath);
    const content = await fs.readFile(absolute, "utf8");
    const matches = countOccurrences(content.toLowerCase(), needle);
    if (matches > 0) {
      results.push({ file: relativePath, matches });
    }
  }

  return results.sort((a, b) => b.matches - a.matches);
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
