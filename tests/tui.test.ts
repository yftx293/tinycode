import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  type ToolResultMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapHarness } from "../src/bootstrap.js";
import { SlashCommandController } from "../src/cli/commands.js";
import { listSessions } from "../src/cli/sessions.js";
import { SessionStorage } from "../src/session/storage.js";
import { createSessionId } from "../src/session/types.js";
import { InterruptController } from "../src/tui/app.js";
import {
  installPermissionPrompt,
  permissionChoices,
} from "../src/tui/permission-dialog.js";
import { slashCommands } from "../src/tui/slash.js";
import { renderStatusBar } from "../src/tui/status-bar.js";
import { TranscriptModel } from "../src/tui/transcript.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `tinycode-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function event(value: AgentEvent): AgentEvent {
  return value;
}

describe("TUI Agent event mapping", () => {
  it("hydrates a restored transcript without duplicating previous lines", () => {
    const transcript = new TranscriptModel();
    const user: UserMessage = {
      role: "user",
      content: "continue the repair",
      timestamp: 1,
    };
    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "read-1",
      toolName: "read",
      content: [{ type: "text", text: "restored output" }],
      details: {},
      isError: false,
      timestamp: 3,
    };
    const messages: AgentMessage[] = [
      user,
      fauxAssistantMessage("I will inspect it.", { timestamp: 2 }),
      toolResult,
    ];

    transcript.append("stale status");
    transcript.hydrate(messages);
    transcript.hydrate(messages);

    expect(transcript.lines()).toEqual([
      "user> continue the repair",
      "assistant> I will inspect it.",
      "tool> read completed",
      "restored output",
    ]);
  });

  it("maps streaming text, tool lifecycle, diff, exit code, and errors", () => {
    const transcript = new TranscriptModel();
    const assistant = fauxAssistantMessage("");

    transcript.consume(
      event({
        type: "message_update",
        message: assistant,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "hello",
          partial: assistant,
        },
      }),
    );
    transcript.consume(
      event({
        type: "tool_execution_start",
        toolCallId: "edit-1",
        toolName: "edit",
        args: { path: "src/a.ts" },
      }),
    );
    transcript.consume(
      event({
        type: "tool_execution_end",
        toolCallId: "edit-1",
        toolName: "edit",
        result: { details: { diff: "@@ -1 +1 @@\n-old\n+new" } },
        isError: false,
      }),
    );
    transcript.consume(
      event({
        type: "tool_execution_end",
        toolCallId: "bash-1",
        toolName: "bash",
        result: { details: { exitCode: 2, stderr: "failed" } },
        isError: true,
      }),
    );

    expect(transcript.lines()).toEqual([
      "assistant> hello",
      "tool> edit started {\"path\":\"src/a.ts\"}",
      "tool> edit completed",
      "@@ -1 +1 @@\n-old\n+new",
      "tool> bash failed (exit 2)",
      "failed",
    ]);
  });

  it("maps model errors from finalized assistant messages", () => {
    const transcript = new TranscriptModel();
    transcript.consume(
      event({
        type: "message_end",
        message: fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: "provider unavailable",
        }),
      }),
    );

    expect(transcript.lines()).toEqual(["error> provider unavailable"]);
  });
});

describe("permission dialog", () => {
  it("offers once, always, and deny and wires the selected outcome", async () => {
    expect(permissionChoices.map(({ label, outcome }) => [label, outcome])).toEqual([
      ["Allow once", "once"],
      ["Always allow", "always"],
      ["Deny", "deny"],
    ]);

    const harness = await bootstrapHarness({
      projectRoot: temporaryDirectory("permission"),
      mock: { responses: [] },
    });
    const presenter = vi.fn().mockResolvedValue("always");
    installPermissionPrompt(harness.runtime.permissions, presenter);

    const first = await harness.runtime.permissions.check("write", { path: "a.ts" });
    const second = await harness.runtime.permissions.check("write", { path: "b.ts" });

    expect(first.action).toBe("allow");
    expect(second.action).toBe("allow");
    expect(presenter).toHaveBeenCalledTimes(1);
    await harness.shutdown();
  });
});

describe("slash command integration", () => {
  it("builds an identifiable recent-session list for the current workspace", () => {
    const workspace = temporaryDirectory("recent-workspace");
    const otherWorkspace = temporaryDirectory("recent-other");
    const sessionDirectory = temporaryDirectory("recent-sessions");
    const storage = new SessionStorage(sessionDirectory);
    const appendUser = (id: string, content: string): void => {
      const message: UserMessage = { role: "user", content, timestamp: 1 };
      storage.appendMessage(id, message);
    };
    const oldest = storage.create(workspace, createSessionId(1_000));
    const excluded = storage.create(workspace, createSessionId(2_000));
    const middle = storage.create(workspace, createSessionId(3_000));
    const newest = storage.create(workspace, createSessionId(4_000));
    storage.create(workspace, createSessionId(5_000));
    const other = storage.create(otherWorkspace, createSessionId(6_000));
    appendUser(oldest.header.id, "old task");
    appendUser(excluded.header.id, "excluded task");
    appendUser(middle.header.id, "inspect   the\n session history");
    appendUser(newest.header.id, "new task");
    appendUser(other.header.id, "other project");

    const sessions = listSessions(sessionDirectory, workspace, {
      excludeId: excluded.header.id,
      nonEmpty: true,
      limit: 3,
    });

    expect(sessions.map(({ id, preview }) => [id, preview])).toEqual([
      [newest.header.id, "new task"],
      [middle.header.id, "inspect the session history"],
      [oldest.header.id, "old task"],
    ]);
  });

  it("exposes every required command", () => {
    expect(slashCommands.map((command) => command.name)).toEqual([
      "help",
      "new",
      "clear",
      "resume",
      "sessions",
      "model",
      "settings",
      "skills",
      "mcp",
      "agents",
      "compact",
      "status",
      "exit",
    ]);
  });

  it("requests the settings panel from /settings", async () => {
    const workspace = temporaryDirectory("settings-command");
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      mock: { responses: [] },
    });
    const controller = new SlashCommandController({
      harness,
      createHarness: () => Promise.resolve(harness),
      sessionDirectory: temporaryDirectory("settings-command-sessions"),
      projectRoot: workspace,
    });

    await expect(controller.execute("/settings")).resolves.toEqual({
      openSettings: true,
    });
    await harness.shutdown();
  });

  it("keeps /clear in the same session and makes /new create a fresh session", async () => {
    const workspace = temporaryDirectory("commands-workspace");
    const sessionDirectory = temporaryDirectory("commands-sessions");
    const createHarness = (session?: { id?: string; continue?: boolean }) =>
      bootstrapHarness({
        projectRoot: workspace,
        session: { directory: sessionDirectory, ...session },
        mock: { responses: ["answer"] },
        subAgents: {},
      });
    let harness = await createHarness();
    const originalSessionId = harness.session?.id;
    await harness.runtime.prompt("question");
    const sessionPath = harness.session?.path;
    const persistedBeforeClear =
      sessionPath === undefined ? "" : readFileSync(sessionPath, "utf8");
    const controller = new SlashCommandController({
      harness,
      createHarness,
      sessionDirectory,
      projectRoot: workspace,
    });

    await controller.execute("/clear");
    harness = controller.harness;
    expect(harness.session?.id).toBe(originalSessionId);
    expect(harness.runtime.agent.state.messages).toEqual([]);
    expect(sessionPath === undefined ? "" : readFileSync(sessionPath, "utf8")).toBe(
      persistedBeforeClear,
    );

    await controller.execute("/new");
    harness = controller.harness;
    expect(harness.session?.id).not.toBe(originalSessionId);
    expect(harness.runtime.agent.state.messages).toEqual([]);
    await harness.shutdown();
  });
});

describe("status and terminal controls", () => {
  it("renders model, cwd, context estimate, session, and running workers", async () => {
    const workspace = temporaryDirectory("status-workspace");
    const harness = await bootstrapHarness({
      projectRoot: workspace,
      session: { directory: temporaryDirectory("status-sessions") },
      mock: { responses: [] },
      subAgents: {},
    });

    const status = renderStatusBar(harness, workspace, { colorEnabled: false });
    expect(status).toContain("● idle");
    expect(status).toContain("model mock/mock");
    expect(status).toContain(`cwd ${basename(workspace)}`);
    expect(status).toContain("ctx 0/");
    expect(harness.session).toBeDefined();
    expect(status).toContain(
      `session ${(harness.session?.id ?? "missing").slice(0, 8)}`,
    );
    expect(status).toContain("workers 0");
    await harness.shutdown();
  });

  it("aborts while busy and requires a second idle Ctrl+C within two seconds", () => {
    let busy = true;
    let now = 1_000;
    const abort = vi.fn();
    const exit = vi.fn();
    const controls = new InterruptController({
      isBusy: () => busy,
      abort,
      exit,
      now: () => now,
    });

    controls.handle("ctrl-c");
    expect(abort).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    busy = false;
    controls.handle("ctrl-c");
    now += 1_999;
    controls.handle("ctrl-c");
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits on Ctrl+D and aborts on Escape", () => {
    const abort = vi.fn();
    const exit = vi.fn();
    const controls = new InterruptController({
      isBusy: () => true,
      abort,
      exit,
    });

    controls.handle("escape");
    controls.handle("ctrl-d");

    expect(abort).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
