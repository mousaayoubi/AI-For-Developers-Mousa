import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../security/permissions.js";
import { listProjectFiles } from "../security/validatePath.js";

/**
 * Repository logic for the search_project_files MCP tool, kept independent
 * of MCP itself so it can be unit tested or reused elsewhere.
 *
 * Case-insensitive substring search for `query` across every approved
 * project file. Returns [{ file, matches }], most matches first, omitting
 * files with zero hits.
 *
 * Callers are expected to have already validated `query` (see the zod
 * schema in server.js) - this function assumes it received a clean,
 * non-empty string.
 */
export async function searchProjectFiles(query) {
  const needle = query.trim().toLowerCase();
  const files = await listProjectFiles();
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
