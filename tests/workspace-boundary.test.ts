import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWorkspacePath } from "../src/tools/paths.js";

function withWorkspace(run: (workspace: string, outside: string) => void): void {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "tinycode-boundary-"));
  const workspace = join(fixtureRoot, "workspace");
  const outside = join(fixtureRoot, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);

  try {
    run(workspace, outside);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe("resolveWorkspacePath", () => {
  it("defaults to the root and rejects lexical traversal", () => {
    withWorkspace((workspace) => {
      expect(resolveWorkspacePath(workspace)).toBe(resolve(workspace));
      expect(() => resolveWorkspacePath(workspace, "../outside.txt")).toThrow(
        "Path escapes workspace",
      );
    });
  });

  it("rejects an existing file reached through an escaping directory symlink", () => {
    withWorkspace((workspace, outside) => {
      writeFileSync(join(outside, "secret.txt"), "outside");
      symlinkSync(
        outside,
        join(workspace, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(() =>
        resolveWorkspacePath(workspace, "escape/secret.txt"),
      ).toThrow("Path resolves outside workspace");
    });
  });

  it("rejects a new file whose nearest existing ancestor escapes", () => {
    withWorkspace((workspace, outside) => {
      symlinkSync(
        outside,
        join(workspace, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(() => resolveWorkspacePath(workspace, "escape/new.txt")).toThrow(
        "Path resolves outside workspace",
      );
    });
  });

  it("rejects a path containing a broken symbolic link", () => {
    withWorkspace((workspace, outside) => {
      symlinkSync(
        join(outside, "missing"),
        join(workspace, "broken"),
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(() => resolveWorkspacePath(workspace, "broken/new.txt")).toThrow(
        "Broken symbolic link",
      );
    });
  });
});
