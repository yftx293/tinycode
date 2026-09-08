import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  contentText,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { bootstrapHarness } from "../src/bootstrap.js";

async function withWorkspace<T>(
  run: (workspace: string, sessions: string) => Promise<T>,
): Promise<T> {
  const workspace = mkdtempSync(join(tmpdir(), "tinycode-lifecycle-"));
  try {
    return await run(workspace, join(workspace, "sessions"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("session lifecycle", () => {
  it("persists every finalized message and restores an explicit session", async () => {
    await withWorkspace(async (workspace, directory) => {
      const first = await bootstrapHarness({
        projectRoot: workspace,
        session: { directory },
        mock: { responses: ["first answer"] },
      });

      await first.runtime.prompt("first question");

      expect(first.session).toBeDefined();
      const firstSession = first.session;
      if (firstSession === undefined) {
        throw new Error("Expected an active session");
      }
      const id = firstSession.id;
      const persisted = readFileSync(firstSession.path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; message?: { role: string } });
      expect(persisted.map((record) => record.type)).toEqual([
        "session",
        "message",
        "message",
      ]);
      expect(persisted.slice(1).map((record) => record.message?.role)).toEqual([
        "user",
        "assistant",
      ]);

      const restored = await bootstrapHarness({
        projectRoot: workspace,
        session: { directory, id },
        mock: { responses: ["continued answer"] },
      });
      expect(restored.runtime.agent.state.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);

      await restored.runtime.prompt("continued question");
      expect(restored.runtime.agent.state.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
    });
  });

  it("truncates a long tool result while retaining its full artifact", async () => {
    await withWorkspace(async (workspace, directory) => {
      const longText = `HEAD-${"x".repeat(500)}-TAIL`;
      writeFileSync(join(workspace, "long.txt"), `${longText}\n`);
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        session: { directory },
        context: { toolResultMaxChars: 120 },
        mock: {
          responses: [
            fauxAssistantMessage(
              [fauxToolCall("read", { path: "long.txt" })],
              { stopReason: "toolUse" },
            ),
            fauxAssistantMessage("read complete"),
          ],
        },
      });

      const { runtime, session } = harness;
      await runtime.prompt("Read long.txt");

      if (session === undefined) {
        throw new Error("Expected an active session");
      }
      const toolResult = runtime.agent.state.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(toolResult?.role).toBe("toolResult");
      if (toolResult?.role !== "toolResult") {
        throw new Error("Expected a tool result");
      }
      const truncated = contentText(toolResult.content);
      expect(truncated).toContain("HEAD-");
      expect(truncated).toContain("-TAIL");
      expect(truncated).toContain("omitted");
      expect(truncated).not.toContain(longText);

      const artifacts = readdirSync(session.artifactDirectory);
      expect(artifacts).toHaveLength(1);
      const artifact = readFileSync(
        join(session.artifactDirectory, artifacts[0] ?? "missing"),
        "utf8",
      );
      expect(artifact).toContain(longText);
      expect(readFileSync(session.path, "utf8")).toContain("omitted");
    });
  });
});
