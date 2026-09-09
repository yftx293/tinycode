import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import {
  contentText,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { bootstrapHarness } from "../src/bootstrap.js";
import { SessionStorage } from "../src/session/storage.js";

const fixtureDirectory = fileURLToPath(
  new URL("../fixtures/broken-project", import.meta.url),
);
const temporaryDirectories: string[] = [];

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `tinycode-e2e-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function toolEnds(events: readonly AgentEvent[]) {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: "tool_execution_end" }> =>
      event.type === "tool_execution_end",
  );
}

function toolResultText(events: readonly AgentEvent[], toolName: string): string {
  const event = toolEnds(events).find((candidate) => candidate.toolName === toolName);
  if (event === undefined) {
    return "";
  }
  const result = event.result as { content?: unknown };
  return Array.isArray(result.content)
    ? contentText(result.content as Parameters<typeof contentText>[0])
    : "";
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("complete coding-agent loop", () => {
  it("uses the real Pi loop and tools to repair a copied broken project", async () => {
    const root = temporaryDirectory("repair");
    const workspace = join(root, "project");
    const sessionDirectory = join(root, "sessions");
    cpSync(fixtureDirectory, workspace, { recursive: true });
    const events: AgentEvent[] = [];
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      session: { directory: sessionDirectory },
      mock: {
        responses: [
          fauxAssistantMessage([fauxToolCall("bash", { command: "npm test" })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage([fauxToolCall("read", { path: "add.js" })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage(
            [
              fauxToolCall("edit", {
                path: "add.js",
                oldText: "return left - right;",
                newText: "return left + right;",
              }),
            ],
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage([fauxToolCall("bash", { command: "npm test" })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage("Fixed add() and verified the test suite."),
        ],
      },
    });
    harness.runtime.permissions.setMode("auto");
    const unsubscribe = harness.runtime.subscribe((event) => {
      events.push(event);
    });

    await harness.runtime.prompt("Fix the failing add() test and verify it.");

    const completedTools = toolEnds(events);
    expect(completedTools.map((event) => event.toolName)).toEqual([
      "bash",
      "read",
      "edit",
      "bash",
    ]);
    const bashResults = completedTools.filter((event) => event.toolName === "bash");
    expect(bashResults).toHaveLength(2);
    expect((bashResults[0]?.result as { details: { exitCode: number } }).details.exitCode).toBe(1);
    expect((bashResults[1]?.result as { details: { exitCode: number } }).details.exitCode).toBe(0);
    const editResult = completedTools.find((event) => event.toolName === "edit");
    expect((editResult?.result as { details: { diff: string } }).details.diff).toContain(
      "+  return left + right;",
    );
    expect(readFileSync(join(workspace, "add.js"), "utf8")).toContain(
      "return left + right;",
    );
    expect(readFileSync(join(fixtureDirectory, "add.js"), "utf8")).toContain(
      "return left - right;",
    );

    const roles = harness.runtime.agent.state.messages.map((message) => message.role);
    expect(roles).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    const sessionId = harness.session?.id;
    expect(sessionId).toBeDefined();
    if (sessionId === undefined) {
      throw new Error("E2E Harness did not create a session");
    }
    const persisted = new SessionStorage(sessionDirectory).load(sessionId);
    expect(persisted.messages.map((message) => message.role)).toEqual(roles);
    unsubscribe();
    await harness.shutdown();

    const restored = await bootstrapHarness({
      projectRoot: workspace,
      session: { directory: sessionDirectory, id: sessionId },
      mock: { responses: ["The repaired project still passes."] },
    });
    expect(restored.runtime.agent.state.messages.map((message) => message.role)).toEqual(
      roles,
    );
    await restored.runtime.prompt("Confirm the repaired state.");
    expect(restored.runtime.agent.state.messages.slice(-2).map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    await restored.shutdown();
  }, 20_000);
});

describe("release safety regressions", () => {
  it("keeps hard-denied shell commands blocked in auto mode", async () => {
    const workspace = temporaryDirectory("hard-deny");
    const marker = join(workspace, "must-not-exist.txt");
    const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`;
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)} && mkfs.tinycode-test /dev/not-a-device`;
    const events: AgentEvent[] = [];
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      mock: {
        responses: [
          fauxAssistantMessage([fauxToolCall("bash", { command })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage("The unsafe command was refused."),
        ],
      },
    });
    harness.runtime.permissions.setMode("auto");
    const unsubscribe = harness.runtime.subscribe((event) => {
      events.push(event);
    });

    await harness.runtime.prompt("Run the unsafe command.");

    expect(existsSync(marker)).toBe(false);
    expect(toolResultText(events, "bash")).toContain("Permission denied");
    unsubscribe();
    await harness.shutdown();
  });

  it("rejects a read through a workspace-escaping symlink", async () => {
    const root = temporaryDirectory("symlink");
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    cpSync(fixtureDirectory, workspace, { recursive: true });
    cpSync(fixtureDirectory, outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "outside secret", "utf8");
    symlinkSync(
      outside,
      join(workspace, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const events: AgentEvent[] = [];
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      mock: {
        responses: [
          fauxAssistantMessage(
            [fauxToolCall("read", { path: "escape/secret.txt" })],
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("The escaped path was refused."),
        ],
      },
    });
    const unsubscribe = harness.runtime.subscribe((event) => {
      events.push(event);
    });

    await harness.runtime.prompt("Read the escaped secret.");

    expect(toolResultText(events, "read")).toContain(
      "Path resolves outside workspace",
    );
    unsubscribe();
    await harness.shutdown();
  });

  it("terminates a timed-out command without leaving its delayed write", async () => {
    const workspace = temporaryDirectory("timeout");
    const marker = join(workspace, "late.txt");
    const script = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 300)`;
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
    const events: AgentEvent[] = [];
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      mock: {
        responses: [
          fauxAssistantMessage(
            [fauxToolCall("bash", { command, timeoutMs: 50 })],
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("The command timed out."),
        ],
      },
    });
    harness.runtime.permissions.setMode("auto");
    const unsubscribe = harness.runtime.subscribe((event) => {
      events.push(event);
    });

    await harness.runtime.prompt("Run the slow command.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));

    expect(toolResultText(events, "bash")).toContain("timed out after 50ms");
    expect(existsSync(marker)).toBe(false);
    unsubscribe();
    await harness.shutdown();
  });

  it("keeps built-in tools usable when an MCP server fails to start", async () => {
    const workspace = temporaryDirectory("mcp");
    writeFileSync(join(workspace, "local.txt"), "local content", "utf8");
    const events: AgentEvent[] = [];
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      mcpServers: {
        broken: { command: join(workspace, "missing-mcp-server") },
      },
      mock: {
        responses: [
          fauxAssistantMessage([fauxToolCall("read", { path: "local.txt" })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage("The local file was still readable."),
        ],
      },
    });
    const unsubscribe = harness.runtime.subscribe((event) => {
      events.push(event);
    });

    await harness.runtime.prompt("Read the local file.");

    expect(harness.mcp.status("broken")?.state).toBe("error");
    expect(toolResultText(events, "read")).toContain("local content");
    unsubscribe();
    await harness.shutdown();
  });

  it("still limits concurrent read-only workers to three", async () => {
    const workspace = temporaryDirectory("workers");
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      subAgents: {},
      mock: {
        responses: Array.from({ length: 3 }, () => "slow worker response".repeat(20)),
        tokensPerSecond: 1,
      },
    });
    const manager = harness.agents;
    expect(manager).toBeDefined();

    manager?.spawn("one", "inspect one");
    manager?.spawn("two", "inspect two");
    manager?.spawn("three", "inspect three");

    expect(() => manager?.spawn("four", "inspect four")).toThrow(
      "At most 3 workers may run concurrently",
    );
    await harness.shutdown();
  });
});
