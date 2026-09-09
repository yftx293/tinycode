import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { spawn, type IPty } from "node-pty";
import { afterEach, describe, expect, it } from "vitest";

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
  });
});
