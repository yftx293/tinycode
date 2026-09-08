import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import { join, relative } from "node:path";

export const IGNORED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);

export function isBinaryFile(path: string): boolean {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(8_192);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(descriptor);
  }
}

export function visibleDirectoryEntries(path: string): Dirent[] {
  return readdirSync(path, { withFileTypes: true })
    .filter(
      (entry) =>
        !IGNORED_DIRECTORY_NAMES.has(entry.name) && !entry.isSymbolicLink(),
    )
    .filter((entry) => entry.isDirectory() || !isBinaryFile(join(path, entry.name)))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export interface WalkedFile {
  path: string;
  relativePath: string;
}

export function walkTextFiles(root: string, start: string): WalkedFile[] {
  const startStats = statSync(start);
  if (startStats.isFile()) {
    return isBinaryFile(start)
      ? []
      : [{ path: start, relativePath: relative(root, start) }];
  }

  const files: WalkedFile[] = [];
  const pending = [start];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      break;
    }

    const entries = visibleDirectoryEntries(directory);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else {
        files.push({ path, relativePath: relative(root, path) });
      }
    }
  }

  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en"),
  );
}
