import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contentText,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { bootstrapHarness } from "../src/bootstrap.js";
import { PermissionManager } from "../src/permissions/manager.js";

async function withWorkspace<T>(
  run: (workspace: string) => Promise<T>,
): Promise<T> {
  const workspace = mkdtempSync(join(tmpdir(), "tinycode-permissions-"));
  try {
    return await run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("hard permission denials", () => {
  it.each([
    "rm -rf /",
    "rm --recursive --force /",
    'rm -rf "$HOME"',
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda",
    "dd if=/dev/zero of=/dev/nvme0n1p1",
    "format C:",
    'echo "$(rm -rf /)"',
    "sh -c 'mkfs.ext4 /dev/sda1'",
  ])("cannot be overridden for %s", async (command) => {
    const permissions = new PermissionManager();
    let promptCount = 0;
    permissions.setPrompt(() => {
      promptCount += 1;
      return "always";
    });
    permissions.setMode("auto");

    const decision = await permissions.check("bash", { command });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain("unrecoverable");
    expect(promptCount).toBe(0);
  });

  it("overrides an earlier always approval for the same command family", async () => {
    const permissions = new PermissionManager();
    let promptCount = 0;
    permissions.setPrompt(() => {
      promptCount += 1;
      return "always";
    });

    await expect(
      permissions.check("bash", { command: "rm -rf build-output" }),
    ).resolves.toMatchObject({ action: "allow" });
    const hardDenial = await permissions.check("bash", {
      command: "rm -rf /",
    });

    expect(hardDenial.action).toBe("deny");
    expect(promptCount).toBe(1);
  });
});

describe("runtime permission gate", () => {
  it("returns a readable tool error without executing a denied write", async () => {
    await withWorkspace(async (workspace) => {
      const target = join(workspace, "blocked.txt");
      const { runtime } = await bootstrapHarness({
        projectRoot: workspace,
        mock: {
          responses: [
            fauxAssistantMessage(
              [
                fauxToolCall("write", {
                  path: "blocked.txt",
                  content: "must not exist",
                }),
              ],
              { stopReason: "toolUse" },
            ),
            fauxAssistantMessage("write was blocked"),
          ],
        },
      });

      await runtime.prompt("Write blocked.txt");

      expect(existsSync(target)).toBe(false);
      const result = runtime.agent.state.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(result?.role).toBe("toolResult");
      if (result?.role === "toolResult") {
        expect(result.isError).toBe(true);
        expect(contentText(result.content)).toContain("Permission denied");
        expect(contentText(result.content)).toContain("no approval prompt");
      }
    });
  });

  it("blocks one tool without preventing a safe tool in the same batch", async () => {
    await withWorkspace(async (workspace) => {
      const protectedFile = join(workspace, "protected.txt");
      writeFileSync(protectedFile, "original\n");
      writeFileSync(join(workspace, "readable.txt"), "safe content\n");
      const { runtime } = await bootstrapHarness({
        projectRoot: workspace,
        mock: {
          responses: [
            fauxAssistantMessage(
              [
                fauxToolCall("write", {
                  path: "protected.txt",
                  content: "overwritten\n",
                }),
                fauxToolCall("read", { path: "readable.txt" }),
              ],
              { stopReason: "toolUse" },
            ),
            fauxAssistantMessage("batch complete"),
          ],
        },
      });

      await runtime.prompt("Attempt both operations");

      expect(readFileSync(protectedFile, "utf8")).toBe("original\n");
      const results = runtime.agent.state.messages.filter(
        (message) => message.role === "toolResult",
      );
      expect(results.map((result) => result.toolName)).toEqual([
        "write",
        "read",
      ]);
      expect(results.map((result) => result.isError)).toEqual([true, false]);
      expect(contentText(results[1]?.content ?? [])).toContain("safe content");
    });
  });

  it("executes an ordinary write in auto mode", async () => {
    await withWorkspace(async (workspace) => {
      const { runtime } = await bootstrapHarness({
        projectRoot: workspace,
        mock: {
          responses: [
            fauxAssistantMessage(
              [
                fauxToolCall("write", {
                  path: "allowed.txt",
                  content: "auto approved\n",
                }),
              ],
              { stopReason: "toolUse" },
            ),
            fauxAssistantMessage("write complete"),
          ],
        },
      });
      runtime.permissions.setMode("auto");

      await runtime.prompt("Write allowed.txt");

      expect(readFileSync(join(workspace, "allowed.txt"), "utf8")).toBe(
        "auto approved\n",
      );
    });
  });

  it("prevents every side effect from a destructive command in auto mode", async () => {
    await withWorkspace(async (workspace) => {
      const marker = join(workspace, "must-not-exist.txt");
      const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "leaked")`;
      const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)} && mkfs.tinycode-test /dev/not-a-device`;
      const { runtime } = await bootstrapHarness({
        projectRoot: workspace,
        mock: {
          responses: [
            fauxAssistantMessage(
              [fauxToolCall("bash", { command })],
              { stopReason: "toolUse" },
            ),
            fauxAssistantMessage("command blocked"),
          ],
        },
      });
      runtime.permissions.setMode("auto");

      await runtime.prompt("Run the command");

      expect(existsSync(marker)).toBe(false);
      const result = runtime.agent.state.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(result?.role).toBe("toolResult");
      if (result?.role === "toolResult") {
        expect(result.isError).toBe(true);
        expect(contentText(result.content)).toContain("Permission denied");
      }
    });
  });
});
