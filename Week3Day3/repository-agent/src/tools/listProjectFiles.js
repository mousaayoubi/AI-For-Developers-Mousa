import fs from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_ROOT,
  IGNORED_DIRECTORIES,
  isBlockedFilename,
  hasAllowedExtension,
} from "../security/permissions.js";

/**
 * Tool: list_project_files
 *
 * Recursively lists every approved file inside the sample project, using
 * the same filtering rules (blocked filenames, ignored directories,
 * allowed extensions) that read_project_file enforces - so nothing ever
 * shows up in a listing that couldn't also be read. Returns POSIX-style
 * relative paths, sorted, e.g. "src/services/authService.js".
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
