import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { fauxAssistantMessage, type UserMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { SessionStorage } from "../src/session/storage.js";
import { createSessionId } from "../src/session/types.js";

function withTemporaryDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "tinycode-session-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("session identifiers", () => {
  it("creates a UUIDv7 carrying the requested millisecond timestamp", () => {
    const timestamp = 1_799_000_000_123;
    const id = createSessionId(timestamp);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(
      timestamp,
    );
  });
});

describe("SessionStorage", () => {
  it("creates an append-only JSONL session and skips a damaged final line", () => {
    withTemporaryDirectory((directory) => {
      const storage = new SessionStorage(join(directory, "sessions"));
      const session = storage.create(join(directory, "project"));
      const user: UserMessage = {
        role: "user",
        content: "hello",
        timestamp: 1,
      };
      const assistant = fauxAssistantMessage("world", { timestamp: 2 });

      storage.appendMessage(session.header.id, user);
      storage.appendMessage(session.header.id, assistant);
      appendFileSync(session.path, '{"type":"message"', "utf8");

      const restored = storage.load(session.header.id);
      const lines = readFileSync(session.path, "utf8").split("\n");
      expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
        type: "session",
        version: 1,
        id: session.header.id,
        cwd: resolve(join(directory, "project")),
      });
      expect(restored.messages).toEqual([user, assistant]);
    });
  });

  it("continues only the newest session for the same cwd while explicit ids stay strict", () => {
    withTemporaryDirectory((directory) => {
      const storage = new SessionStorage(join(directory, "sessions"));
      const projectA = join(directory, "project-a");
      const projectB = join(directory, "project-b");
      const firstA = storage.create(projectA, createSessionId(1_000));
      const onlyB = storage.create(projectB, createSessionId(2_000));
      const latestA = storage.create(projectA, createSessionId(3_000));

      expect(storage.findLatestForCwd(projectA)?.header.id).toBe(
        latestA.header.id,
      );
      expect(storage.findLatestForCwd(projectB)?.header.id).toBe(
        onlyB.header.id,
      );
      expect(storage.findLatestForCwd(join(directory, "other"))).toBeUndefined();
      expect(storage.load(firstA.header.id).header.id).toBe(firstA.header.id);
      expect(() => storage.load(createSessionId(9_000))).toThrow(
        "Session not found",
      );
    });
  });
});
