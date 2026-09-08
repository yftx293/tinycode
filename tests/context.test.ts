import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type Message,
  type ToolResultMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/agent/prompt.js";
import { bootstrapHarness } from "../src/bootstrap.js";
import {
  compactMessages,
  estimateMessageTokens,
} from "../src/context/compact.js";

function withWorkspace(run: (workspace: string) => void): void {
  const workspace = mkdtempSync(join(tmpdir(), "tinycode-context-"));
  try {
    run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function withAsyncWorkspace<T>(
  run: (workspace: string) => Promise<T>,
): Promise<T> {
  const workspace = mkdtempSync(join(tmpdir(), "tinycode-context-"));
  try {
    return await run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("project memory", () => {
  it("appends TINY.md and compatible instruction files in stable order", () => {
    withWorkspace((workspace) => {
      writeFileSync(join(workspace, "TINY.md"), "Primary project memory\n");
      writeFileSync(join(workspace, "AGENTS.md"), "Agent compatibility\n");
      writeFileSync(join(workspace, "CLAUDE.md"), "Claude compatibility\n");

      const prompt = buildSystemPrompt(workspace);

      expect(prompt).toContain("## Project memory: TINY.md\nPrimary project memory");
      expect(prompt).toContain("## Project memory: AGENTS.md\nAgent compatibility");
      expect(prompt).toContain("## Project memory: CLAUDE.md\nClaude compatibility");
      expect(prompt.indexOf("TINY.md")).toBeLessThan(prompt.indexOf("AGENTS.md"));
      expect(prompt.indexOf("AGENTS.md")).toBeLessThan(
        prompt.indexOf("CLAUDE.md"),
      );
    });
  });
});

describe("context token estimation", () => {
  it("uses deterministic JSON length divided by four", () => {
    const message = {
      role: "user" as const,
      content: "deterministic estimate",
      timestamp: 123,
    };

    expect(estimateMessageTokens(message)).toBe(
      JSON.stringify(message).length / 4,
    );
  });
});

describe("context compaction", () => {
  it("summarizes old turns at a user boundary and preserves the recent tool turn", () => {
    const oldUser: UserMessage = {
      role: "user",
      content: "old question ".repeat(40),
      timestamp: 1,
    };
    const middleUser: UserMessage = {
      role: "user",
      content: "middle question ".repeat(40),
      timestamp: 3,
    };
    const recentUser: UserMessage = {
      role: "user",
      content: "recent question",
      timestamp: 5,
    };
    const toolCall = fauxAssistantMessage(
      [fauxToolCall("read", { path: "recent.txt" }, { id: "recent-call" })],
      { stopReason: "toolUse", timestamp: 6 },
    );
    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "recent-call",
      toolName: "read",
      content: [{ type: "text", text: "recent tool output" }],
      isError: false,
      timestamp: 7,
    };
    const recent = [
      recentUser,
      toolCall,
      toolResult,
      fauxAssistantMessage("recent answer", { timestamp: 8 }),
    ];
    const messages: AgentMessage[] = [
      oldUser,
      fauxAssistantMessage("old answer ".repeat(40), { timestamp: 2 }),
      middleUser,
      fauxAssistantMessage("middle answer ".repeat(40), { timestamp: 4 }),
      ...recent,
    ];

    const compacted = compactMessages(messages, { maxTokens: 180 });

    expect(compacted.length).toBeLessThan(messages.length);
    expect(compacted[0]?.role).toBe("user");
    expect(JSON.stringify(compacted[0])).toContain(
      "Compacted conversation summary",
    );
    expect(compacted.slice(1)).toEqual(recent);
    expect(compacted.slice(1)).toEqual(messages.slice(-recent.length));
  });

  it("reduces only the model input view while preserving live and persisted history", async () => {
    await withAsyncWorkspace(async (workspace) => {
      let lastModelMessages: Message[] = [];
      const sessions = join(workspace, "sessions");
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        session: { directory: sessions },
        context: { maxTokens: 140, compactThreshold: 1 },
        mock: {
          responses: [
            fauxAssistantMessage("old answer ".repeat(40)),
            fauxAssistantMessage("middle answer ".repeat(40)),
            (context) => {
              lastModelMessages = context.messages.slice();
              return fauxAssistantMessage("recent answer");
            },
          ],
        },
      });

      await harness.runtime.prompt("old question ".repeat(40));
      await harness.runtime.prompt("middle question ".repeat(40));
      await harness.runtime.prompt("recent question");

      expect(lastModelMessages.length).toBeLessThan(5);
      expect(lastModelMessages[0]?.role).toBe("user");
      expect(JSON.stringify(lastModelMessages[0])).toContain(
        "Compacted conversation summary",
      );
      expect(harness.runtime.agent.state.messages).toHaveLength(6);
      if (harness.session === undefined) {
        throw new Error("Expected an active session");
      }
      const records = readFileSync(harness.session.path, "utf8")
        .trim()
        .split("\n");
      expect(records).toHaveLength(7);
      expect(readFileSync(harness.session.path, "utf8")).toContain(
        "old question",
      );
    });
  });

  it("compactNow replaces live history without rewriting the existing session", async () => {
    await withAsyncWorkspace(async (workspace) => {
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        session: { directory: join(workspace, "sessions") },
        mock: { responses: ["first answer", "second answer"] },
      });
      await harness.runtime.prompt("first question");
      await harness.runtime.prompt("second question");
      if (harness.session === undefined) {
        throw new Error("Expected an active session");
      }
      const persistedBefore = readFileSync(harness.session.path, "utf8");

      harness.runtime.compactNow();

      expect(harness.runtime.agent.state.messages).toHaveLength(3);
      expect(harness.runtime.agent.state.messages[0]?.role).toBe("user");
      expect(JSON.stringify(harness.runtime.agent.state.messages[0])).toContain(
        "Compacted conversation summary",
      );
      expect(readFileSync(harness.session.path, "utf8")).toBe(persistedBefore);
    });
  });
});
