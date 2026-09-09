import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import type { SessionListItem } from "../src/cli/sessions.js";
import { StartupActionController } from "../src/tui/startup-actions.js";
import { WelcomeView } from "../src/tui/welcome.js";

const sessions: SessionListItem[] = [
  {
    id: "nummer00-0000-7000-8000-000000000001",
    cwd: "C:\\work\\tinycode",
    createdAt: "2026-09-09T10:20:00.000Z",
    messages: 12,
    preview: "continue the startup page",
  },
];

function createWelcome(colorEnabled: boolean): WelcomeView {
  return new WelcomeView({
    version: "0.1.0",
    projectRoot: "C:\\work\\tinycode",
    model: "mock/mock",
    permissionMode: "ask",
    sessionId: "current0-0000-7000-8000-000000000000",
    recentSessions: sessions,
    colorEnabled,
  });
}

describe("WelcomeView", () => {
  it("renders the wide brand, project state, recent sessions, and shortcuts", () => {
    const lines = createWelcome(false).render(100);
    const text = lines.join("\n");

    expect(text).toContain("_____ _");
    expect(text).toContain("TinyCode v0.1.0");
    expect(text).toContain("模型  mock/mock");
    expect(text).toContain("权限  ask");
    expect(text).toContain("continue the startup page");
    expect(text).toContain("Ctrl+R 继续会话");
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  it("uses a compact single-line brand on narrow terminals", () => {
    const lines = createWelcome(false).render(44);
    const text = lines.join("\n");

    expect(text).toContain("TinyCode v0.1.0");
    expect(text).not.toContain("_____ _");
    expect(lines.every((line) => visibleWidth(line) <= 44)).toBe(true);
  });

  it("honors no-color rendering and occupies no rows after collapse", () => {
    const plain = createWelcome(false);
    expect(plain.render(80).join("\n")).not.toContain("\u001b[");

    const colored = createWelcome(true);
    expect(colored.render(80).join("\n")).toContain("\u001b[");
    colored.collapse();
    expect(colored.render(80)).toEqual([]);
  });
});

describe("StartupActionController", () => {
  it("blocks startup shortcuts while the agent is busy", async () => {
    const resume = vi.fn();
    const startNew = vi.fn();
    const notice = vi.fn();
    const controller = new StartupActionController({
      isBusy: () => true,
      recentSessions: () => sessions,
      selectSession: vi.fn(),
      resume,
      startNew,
      notice,
    });

    await controller.handle("resume");
    await controller.handle("new");

    expect(resume).not.toHaveBeenCalled();
    expect(startNew).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(2);
  });

  it("resumes a selected session and treats cancellation as a no-op", async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const selectSession = vi
      .fn()
      .mockResolvedValueOnce(sessions[0]?.id)
      .mockResolvedValueOnce(undefined);
    const controller = new StartupActionController({
      isBusy: () => false,
      recentSessions: () => sessions,
      selectSession,
      resume,
      startNew: vi.fn(),
      notice: vi.fn(),
    });

    await expect(controller.handle("resume")).resolves.toBe(true);
    await expect(controller.handle("resume")).resolves.toBe(false);
    expect(resume).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith(sessions[0]?.id);
  });

  it("starts a new session from the idle shortcut", async () => {
    const startNew = vi.fn().mockResolvedValue(undefined);
    const controller = new StartupActionController({
      isBusy: () => false,
      recentSessions: () => sessions,
      selectSession: vi.fn(),
      resume: vi.fn(),
      startNew,
      notice: vi.fn(),
    });

    await expect(controller.handle("new")).resolves.toBe(true);
    expect(startNew).toHaveBeenCalledOnce();
  });
});
