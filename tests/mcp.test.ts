import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { bootstrapHarness, type TinyCodeHarness } from "../src/bootstrap.js";

const fixturePath = resolve("tests", "fixtures", "mcp-server.ts");
const tsxPath = resolve("node_modules", "tsx", "dist", "cli.mjs");

async function withWorkspace(
  run: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "tinycode-mcp-"));
  try {
    await run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function serverConfig(
  name: string,
  workspace: string,
): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: process.execPath,
    args: [tsxPath, fixturePath],
    env: {
      MCP_SERVER_NAME: name,
      MCP_PID_FILE: join(workspace, `${name}.pid`),
      MCP_CLOSED_FILE: join(workspace, `${name}.closed`),
    },
  };
}

function requireTool(harness: TinyCodeHarness, name: string) {
  const tool = harness.tools.get(name);
  if (tool === undefined) {
    throw new Error(`Expected registered tool: ${name}`);
  }
  return tool;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("MCP stdio integration", () => {
  it("adapts schemas and prefixes both sides of tool name collisions", async () => {
    await withWorkspace(async (workspace) => {
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        mock: { responses: [] },
        mcpServers: {
          alpha: serverConfig("alpha", workspace),
          beta: serverConfig("beta", workspace),
        },
      });
      try {
        expect(harness.tools.names()).toEqual([
          "read",
          "write",
          "edit",
          "bash",
          "grep",
          "find",
          "ls",
          "load_skill",
          "alpha_echo",
          "alpha_explode",
          "alpha_read",
          "beta_echo",
          "beta_explode",
          "beta_read",
        ]);

        const echo = requireTool(harness, "alpha_echo");
        expect(echo.parameters).toMatchObject({
          type: "object",
          required: ["text"],
          properties: { text: { type: "string" } },
        });
        const result = await echo.execute("call-1", { text: "hello" });
        expect(result.content).toEqual([
          { type: "text", text: "alpha:hello" },
          { type: "text", text: "[Omitted non-text MCP content: image]" },
        ]);
      } finally {
        await harness.shutdown();
      }
    });
  });

  it("isolates connection failures and exposes tool invocation errors", async () => {
    await withWorkspace(async (workspace) => {
      writeFileSync(join(workspace, "local.txt"), "local", "utf8");
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        mock: { responses: [] },
        mcpServers: {
          broken: { command: join(workspace, "missing-mcp-command") },
          healthy: serverConfig("healthy", workspace),
        },
      });
      try {
        expect(harness.tools.has("read")).toBe(true);
        expect(harness.tools.has("healthy_read")).toBe(true);
        expect(harness.mcp.status("broken")).toMatchObject({ state: "error" });
        expect(harness.mcp.status("healthy")).toMatchObject({
          state: "connected",
        });
        const localRead = await requireTool(harness, "read").execute(
          "local-read",
          { path: "local.txt" },
        );
        expect(localRead.content).toEqual([{ type: "text", text: "1: local" }]);

        const explode = requireTool(harness, "explode");
        await expect(explode.execute("call-2", {})).rejects.toThrow(
          "MCP healthy/explode failed: explosion from healthy",
        );
        expect(harness.mcp.status("healthy")).toMatchObject({
          state: "error",
          error: "MCP healthy/explode failed: explosion from healthy",
        });
      } finally {
        await harness.shutdown();
      }
    });
  });

  it("closes the stdio transport and leaves no child process", async () => {
    await withWorkspace(async (workspace) => {
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        mock: { responses: [] },
        mcpServers: { closing: serverConfig("closing", workspace) },
      });
      const pid = Number(readFileSync(join(workspace, "closing.pid"), "utf8"));
      expect(isProcessAlive(pid)).toBe(true);

      await harness.shutdown();

      expect(existsSync(join(workspace, "closing.closed"))).toBe(true);
      expect(isProcessAlive(pid)).toBe(false);
      expect(harness.mcp.status("closing")).toMatchObject({ state: "closed" });
    });
  });
});
