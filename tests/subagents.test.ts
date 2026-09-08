import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentText, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { bootstrapHarness, type TinyCodeHarness } from "../src/bootstrap.js";

async function withWorkspace(
  run: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "tinycode-subagents-"));
  try {
    await run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function requireAgents(harness: TinyCodeHarness) {
  if (harness.agents === undefined) {
    throw new Error("Expected the sub-agent manager to be enabled");
  }
  return harness.agents;
}

function requireTool(harness: TinyCodeHarness, name: string) {
  const tool = harness.tools.get(name);
  if (tool === undefined) {
    throw new Error(`Expected registered tool: ${name}`);
  }
  return tool;
}

describe("read-only sub-agents", () => {
  it("uses an independent transcript, fixed prompt, and read-only tool set", async () => {
    await withWorkspace(async (workspace) => {
      let workerContext = "";
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        subAgents: {},
        mock: {
          responses: [
            (context) => {
              workerContext = JSON.stringify(context);
              return fauxAssistantMessage("research complete");
            },
          ],
        },
      });
      try {
        const agents = requireAgents(harness);
        const started = agents.spawn("researcher", "inspect the project");

        expect(started).toMatchObject({
          name: "researcher",
          task: "inspect the project",
          status: "running",
          report: "",
        });
        const [finished] = await agents.wait("researcher");
        expect(finished).toMatchObject({
          name: "researcher",
          status: "completed",
          report: "research complete",
        });
        expect(workerContext).toContain("read-only research worker");
        expect(workerContext).toContain("inspect the project");
        expect(JSON.parse(workerContext)).toMatchObject({
          tools: [
            { name: "read" },
            { name: "grep" },
            { name: "find" },
            { name: "ls" },
          ],
        });
        expect(workerContext).not.toMatch(/"name":"(?:write|edit|bash|load_skill|spawn_agent)"/u);
        expect(harness.runtime.agent.state.messages).toEqual([]);
      } finally {
        await harness.shutdown();
      }
    });
  });

  it("keeps every turn while truncating oversized tool results", async () => {
    await withWorkspace(async (workspace) => {
      const longText = `HEAD-${"x".repeat(500)}-TAIL`;
      writeFileSync(join(workspace, "long.txt"), longText, "utf8");
      let secondModelInput = "";
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        subAgents: { toolResultMaxChars: 120 },
        mock: {
          responses: [
            fauxAssistantMessage(
              [fauxToolCall("read", { path: "long.txt" })],
              { stopReason: "toolUse" },
            ),
            (context) => {
              secondModelInput = JSON.stringify(context.messages);
              return fauxAssistantMessage("file inspected");
            },
          ],
        },
      });
      try {
        const agents = requireAgents(harness);
        agents.spawn("reader", "read long.txt");
        const [finished] = await agents.wait("reader");

        expect(finished?.report).toBe("file inspected");
        expect(secondModelInput).toContain("HEAD-");
        expect(secondModelInput).toContain("-TAIL");
        expect(secondModelInput).toContain("omitted");
        expect(secondModelInput).not.toContain(longText);
        expect(JSON.parse(secondModelInput)).toMatchObject([
          { role: "user" },
          { role: "assistant" },
          { role: "toolResult" },
        ]);
        expect(secondModelInput).not.toContain("Compacted conversation summary");
      } finally {
        await harness.shutdown();
      }
    });
  });

  it("enforces safe unique names and at most three running workers", async () => {
    await withWorkspace(async (workspace) => {
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        subAgents: {},
        mock: {
          responses: Array.from({ length: 3 }, () => "slow response ".repeat(20)),
          tokensPerSecond: 10_000,
        },
      });
      try {
        const agents = requireAgents(harness);
        expect(() => agents.spawn("bad name", "invalid")).toThrow(
          "Worker name may contain only",
        );
        agents.spawn("one", "first task");
        expect(() => agents.spawn("one", "duplicate")).toThrow(
          "Worker name already exists",
        );
        agents.spawn("two", "second task");
        agents.spawn("three", "third task");
        expect(() => agents.spawn("four", "fourth task")).toThrow(
          "At most 3 workers",
        );

        expect(agents.close("one")).toMatchObject({ status: "aborted" });
        expect(agents.reports().find((report) => report.name === "two")).toMatchObject({
          status: "running",
        });
        const [aborted] = await agents.wait("one");
        expect(aborted).toMatchObject({ name: "one", status: "aborted" });
      } finally {
        await harness.shutdown();
      }
    });
  });

  it("returns tool-not-found when a worker attempts to write", async () => {
    await withWorkspace(async (workspace) => {
      const target = join(workspace, "forbidden.txt");
      let retryContext = "";
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        subAgents: {},
        mock: {
          responses: [
            fauxAssistantMessage(
              [fauxToolCall("write", { path: "forbidden.txt", content: "bad" })],
              { stopReason: "toolUse" },
            ),
            (context) => {
              retryContext = JSON.stringify(context.messages);
              return fauxAssistantMessage("write unavailable");
            },
          ],
        },
      });
      try {
        const agents = requireAgents(harness);
        agents.spawn("safe", "try to write forbidden.txt");
        const [finished] = await agents.wait("safe");

        expect(finished?.report).toBe("write unavailable");
        expect(retryContext).toContain("Tool write not found");
        expect(existsSync(target)).toBe(false);
      } finally {
        await harness.shutdown();
      }
    });
  });

  it("registers supervision tools that spawn, list, wait, and close workers", async () => {
    await withWorkspace(async (workspace) => {
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        subAgents: {},
        mock: { responses: ["supervised finding"] },
      });
      try {
        expect(harness.tools.names().slice(-4)).toEqual([
          "spawn_agent",
          "list_agents",
          "wait_agent",
          "close_agent",
        ]);
        const spawned = await requireTool(harness, "spawn_agent").execute(
          "spawn-call",
          { name: "delegate", task: "inspect files" },
        );
        expect(spawned.details).toMatchObject({ status: "running" });

        const listed = await requireTool(harness, "list_agents").execute(
          "list-call",
          {},
        );
        expect(listed.details).toMatchObject([{ name: "delegate" }]);
        const waited = await requireTool(harness, "wait_agent").execute(
          "wait-call",
          { idOrName: "delegate" },
        );
        expect(waited.details).toMatchObject([
          { name: "delegate", status: "completed", report: "supervised finding" },
        ]);
        const closed = await requireTool(harness, "close_agent").execute(
          "close-call",
          { idOrName: "delegate" },
        );
        expect(closed.details).toMatchObject({ status: "completed" });
        expect(contentText(closed.content)).toContain("delegate");
      } finally {
        await harness.shutdown();
      }
    });
  });
});
