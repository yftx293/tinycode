import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { spawn, type IPty } from "node-pty";
import type { UserMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { SessionStorage } from "../src/session/storage.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "tinycode-pty-"));
  temporaryDirectories.push(directory);
  return directory;
}

function stringEnvironment(overrides: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    ...overrides,
  };
}

function waitForOutput(
  processHandle: IPty,
  output: () => string,
  expected: string,
): Promise<void> {
  if (output().includes(expected)) {
    return Promise.resolve();
  }
  return new Promise((resolveOutput, rejectOutput) => {
    const timeout = setTimeout(() => {
      subscription.dispose();
      rejectOutput(new Error(`Timed out waiting for PTY output: ${expected}`));
    }, 10_000);
    const subscription = processHandle.onData(() => {
      if (output().includes(expected)) {
        clearTimeout(timeout);
        subscription.dispose();
        resolveOutput();
      }
    });
  });
}

function waitForExit(processHandle: IPty): Promise<number> {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      processHandle.kill();
      rejectExit(new Error("TinyCode PTY did not exit within 10 seconds"));
    }, 10_000);
    processHandle.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      resolveExit(exitCode);
    });
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("interactive TUI in a pseudo-terminal", () => {
  it("opens the recent-session selector and restores its transcript", async () => {
    const stateDirectory = temporaryDirectory();
    const storage = new SessionStorage(stateDirectory);
    const previous = storage.create(projectRoot);
    const message: UserMessage = {
      role: "user",
      content: "unfinished startup task",
      timestamp: 1,
    };
    storage.appendMessage(previous.header.id, message);
    let output = "";
    const processHandle = spawn(
      process.execPath,
      ["--import", "tsx", cliPath, "--mock"],
      {
        cwd: projectRoot,
        cols: 100,
        rows: 35,
        env: stringEnvironment({ TINYCODE_HOME: stateDirectory }),
      },
    );
    const outputSubscription = processHandle.onData((data) => {
      output += data;
    });
    const exit = waitForExit(processHandle);

    try {
      await waitForOutput(processHandle, () => output, "unfinished startup task");
      processHandle.write("\x12");
      await waitForOutput(processHandle, () => output, "继续最近会话");
      processHandle.write("\r");
      await waitForOutput(processHandle, () => output, "user> unfinished startup task");
      processHandle.write("/exit\r");

      expect(await exit).toBe(0);
    } finally {
      outputSubscription.dispose();
    }
  }, 30_000);

  it("completes first-launch setup and persists a TUI settings change", async () => {
    const stateDirectory = temporaryDirectory();
    const userHome = temporaryDirectory();
    const userConfigPath = join(userHome, ".tinycode", "config.json");
    let output = "";
    const processHandle = spawn(
      process.execPath,
      ["--import", "tsx", cliPath],
      {
        cwd: projectRoot,
        cols: 120,
        rows: 35,
        env: stringEnvironment({
          TINYCODE_HOME: stateDirectory,
          USERPROFILE: userHome,
          HOME: userHome,
          NO_COLOR: "1",
        }),
      },
    );
    const outputSubscription = processHandle.onData((data) => {
      output += data;
    });
    const exit = waitForExit(processHandle);

    try {
      await waitForOutput(processHandle, () => output, "请选择 [1/2]");
      processHandle.write("1\r");
      await waitForOutput(processHandle, () => output, "按 Enter 保存并启动 TinyCode");
      processHandle.write("\r");
      await waitForOutput(processHandle, () => output, "TinyCode v0.1.0");
      await waitForOutput(processHandle, () => output, "model mock/mock");

      processHandle.write("/settings\r");
      await waitForOutput(processHandle, () => output, "权限模式（TINYCODE_PERMISSION_MODE）");
      processHandle.write("\x1b[B");
      await waitForOutput(
        processHandle,
        () => output,
        "> 权限模式（TINYCODE_PERMISSION_MODE）",
      );
      processHandle.write("\r");
      await waitForOutput(processHandle, () => output, "自动（auto）");
      processHandle.write("\x1b");
      await waitForOutput(processHandle, () => output, "设置已保存并应用");
      processHandle.write("/exit\r");

      expect(await exit).toBe(0);
      expect(existsSync(userConfigPath)).toBe(true);
      expect(JSON.parse(readFileSync(userConfigPath, "utf8"))).toMatchObject({
        model: { provider: "mock", model: "mock" },
        permissionMode: "auto",
      });
    } finally {
      outputSubscription.dispose();
    }
  }, 30_000);

  it("renders status, accepts /exit, and shuts down cleanly", async () => {
    const stateDirectory = temporaryDirectory();
    let output = "";
    const processHandle = spawn(
      process.execPath,
      ["--import", "tsx", cliPath, "--mock"],
      {
        cwd: projectRoot,
        cols: 100,
        rows: 30,
        env: stringEnvironment({ TINYCODE_HOME: stateDirectory }),
      },
    );
    const outputSubscription = processHandle.onData((data) => {
      output += data;
    });
    const exit = waitForExit(processHandle);

    try {
      await waitForOutput(processHandle, () => output, "model mock/mock");
      processHandle.write("/exit\r");

      expect(await exit).toBe(0);
      expect(output).toContain("| session");
      expect(
        readdirSync(stateDirectory).filter((name) => name.endsWith(".jsonl")),
      ).toHaveLength(1);
    } finally {
      outputSubscription.dispose();
    }
  }, 30_000);

  it("uses the compact colorless welcome screen in a narrow terminal", async () => {
    const stateDirectory = temporaryDirectory();
    let output = "";
    const processHandle = spawn(
      process.execPath,
      ["--import", "tsx", cliPath, "--mock"],
      {
        cwd: projectRoot,
        cols: 44,
        rows: 20,
        env: stringEnvironment({
          TINYCODE_HOME: stateDirectory,
          NO_COLOR: "1",
          TERM: "dumb",
        }),
      },
    );
    const outputSubscription = processHandle.onData((data) => {
      output += data;
    });
    const exit = waitForExit(processHandle);

    try {
      await waitForOutput(processHandle, () => output, "TinyCode v0.1.0");
      expect(output).not.toContain("_____ _");
      for (const code of [2, 91, 92, 93, 94, 96]) {
        expect(output).not.toContain(`\u001b[${String(code)}m`);
      }
      processHandle.write("/exit\r");

      expect(await exit).toBe(0);
    } finally {
      outputSubscription.dispose();
    }
  }, 30_000);

  it("folds the welcome screen after the first user message", async () => {
    const stateDirectory = temporaryDirectory();
    let output = "";
    const processHandle = spawn(
      process.execPath,
      ["--import", "tsx", cliPath, "--mock"],
      {
        cwd: projectRoot,
        cols: 100,
        rows: 30,
        env: stringEnvironment({ TINYCODE_HOME: stateDirectory }),
      },
    );
    const outputSubscription = processHandle.onData((data) => {
      output += data;
    });
    const exit = waitForExit(processHandle);

    try {
      await waitForOutput(processHandle, () => output, "TinyCode v0.1.0");
      const afterWelcome = output.length;
      processHandle.write("hello\r");
      await waitForOutput(processHandle, () => output, "TinyCode mock response");

      expect(output.slice(afterWelcome)).not.toContain("TinyCode v0.1.0");
      processHandle.write("/exit\r");
      expect(await exit).toBe(0);
    } finally {
      outputSubscription.dispose();
    }
  }, 30_000);
});
