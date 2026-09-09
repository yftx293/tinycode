import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs } from "../src/cli/args.js";
import { bootstrapHarness } from "../src/bootstrap.js";
import { runCli, type CliDependencies, type CliIo } from "../src/cli/index.js";
import type { ScriptedMockResponse } from "../src/model/registry.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
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

function captureIo(): CliIo & { stdoutText: string; stderrText: string } {
  const io = {
    stdoutText: "",
    stderrText: "",
    stdout: {
      write(text: string) {
        io.stdoutText += text;
      },
    },
    stderr: {
      write(text: string) {
        io.stderrText += text;
      },
    },
  };
  return io;
}

function dependencies(
  workspace: string,
  stateDirectory: string,
  mockResponses: readonly ScriptedMockResponse[] = [],
): CliDependencies {
  return {
    cwd: workspace,
    env: {},
    stateDirectory,
    mockResponses,
  };
}

describe("CLI argument parsing", () => {
  it("parses the complete stage 7 option surface", () => {
    expect(
      parseCliArgs([
        "--model",
        "openai/gpt-5",
        "--mock",
        "--list-models",
        "-p",
        "describe this project",
        "--continue",
        "--permission-mode",
        "auto",
      ]),
    ).toEqual({
      kind: "run",
      model: { provider: "openai", model: "gpt-5" },
      mock: true,
      listModels: true,
      prompt: "describe this project",
      continue: true,
      permissionMode: "auto",
    });
  });

  it("supports explicit session selection", () => {
    expect(parseCliArgs(["--session", "session-id"])).toEqual({
      kind: "run",
      sessionId: "session-id",
    });
  });

  it.each([
    [["--model"], "Missing value for --model"],
    [["--permission-mode", "unsafe"], "--permission-mode must be ask or auto"],
    [["--continue", "--session", "id"], "Choose either --continue or --session"],
    [["--unknown"], "Unknown argument: --unknown"],
  ])("rejects invalid arguments: %j", (args, message) => {
    expect(() => parseCliArgs(args)).toThrow(message);
  });
});

describe("tinycode CLI", () => {
  it("runs when Node enters through a linked package path", () => {
    const linkedRoot = join(temporaryDirectory("linked-entry"), "package");
    symlinkSync(
      projectRoot,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", join(linkedRoot, "src", "cli", "index.ts"), "--version"],
      { cwd: linkedRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.1.0\n");
    expect(result.stderr).toBe("");
  }, 15_000);

  it("runs first-launch setup once and remembers the selected defaults", async () => {
    const root = temporaryDirectory("first-launch");
    const workspace = join(root, "workspace");
    const stateDirectory = join(root, "sessions");
    const userConfigPath = join(root, "user", ".tinycode", "config.json");
    const setupPresenter = vi.fn().mockResolvedValue({
      model: { provider: "mock", model: "mock" },
      permissionMode: "ask",
      maxOutputTokens: 4_096,
      context: {
        maxTokens: 32_000,
        compactThreshold: 0.8,
        toolResultMaxChars: 12_000,
      },
    });
    const runTui = vi.fn().mockResolvedValue(0);
    const firstIo = captureIo();

    const firstCode = await runCli([], firstIo, {
      ...dependencies(workspace, stateDirectory),
      interactive: true,
      userConfigPath,
      setupPresenter,
      runTui,
    });

    expect(firstCode).toBe(0);
    expect(setupPresenter).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(userConfigPath, "utf8"))).toMatchObject({
      model: { provider: "mock", model: "mock" },
      permissionMode: "ask",
      maxOutputTokens: 4_096,
    });

    const secondCode = await runCli([], captureIo(), {
      ...dependencies(workspace, stateDirectory),
      interactive: true,
      userConfigPath,
      setupPresenter,
      runTui,
    });

    expect(secondCode).toBe(0);
    expect(setupPresenter).toHaveBeenCalledTimes(1);
  });

  it("persists settings changed from the TUI", async () => {
    const root = temporaryDirectory("tui-settings");
    const workspace = join(root, "workspace");
    const userConfigPath = join(root, "user", ".tinycode", "config.json");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(root, "user", ".tinycode"), { recursive: true });
    writeFileSync(
      userConfigPath,
      JSON.stringify({ model: { provider: "mock", model: "mock" } }),
    );

    const code = await runCli([], captureIo(), {
      ...dependencies(workspace, join(root, "sessions")),
      interactive: true,
      userConfigPath,
      runTui: async (_harness, options) => {
        expect(options.settings().permissionMode).toBe("ask");
        await options.saveSettings({
          ...options.settings(),
          permissionMode: "auto",
          context: {
            ...options.settings().context,
            maxTokens: 64_000,
          },
        });
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(userConfigPath, "utf8"))).toMatchObject({
      permissionMode: "auto",
      context: { maxTokens: 64_000 },
    });
  });

  it("prints help without an API key", async () => {
    const io = captureIo();
    const code = await runCli(["--help"], io, dependencies(projectRoot, temporaryDirectory("state")));

    expect(code).toBe(0);
    expect(io.stdoutText).toContain("Usage: tinycode [options]");
    expect(io.stdoutText).toContain("--permission-mode <ask|auto>");
    expect(io.stderrText).toBe("");
  });

  it("prints the package version without an API key", async () => {
    const io = captureIo();
    const code = await runCli(["--version"], io, dependencies(projectRoot, temporaryDirectory("state")));

    expect(code).toBe(0);
    expect(io.stdoutText).toBe("0.1.0\n");
    expect(io.stderrText).toBe("");
  });

  it("rejects unknown arguments with a non-zero exit code", async () => {
    const io = captureIo();
    const code = await runCli(["--unknown"], io, dependencies(projectRoot, temporaryDirectory("state")));

    expect(code).toBe(1);
    expect(io.stdoutText).toBe("");
    expect(io.stderrText).toBe("Unknown argument: --unknown\n");
  });

  it("prints a finalized mock response in headless mode", async () => {
    const io = captureIo();
    const code = await runCli(
      ["--mock", "-p", "describe this project"],
      io,
      dependencies(projectRoot, temporaryDirectory("state"), ["mock description"]),
    );

    expect(code).toBe(0);
    expect(io.stdoutText).toBe("mock description\n");
    expect(io.stderrText).toBe("");
  });

  it.each([
    { mode: "ask", created: false },
    { mode: "auto", created: true },
  ] as const)("applies $mode permission semantics in headless mode", async ({ mode, created }) => {
    const workspace = temporaryDirectory(`headless-${mode}`);
    const io = captureIo();
    const responses = [
      fauxAssistantMessage(
        [fauxToolCall("write", { path: "result.txt", content: "approved\n" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ];

    const code = await runCli(
      ["--mock", "--permission-mode", mode, "-p", "write a result"],
      io,
      dependencies(workspace, temporaryDirectory("state"), responses),
    );

    expect(code).toBe(0);
    expect(existsSync(join(workspace, "result.txt"))).toBe(created);
  });

  it("lists the offline mock model", async () => {
    const io = captureIo();
    const code = await runCli(["--list-models"], io, dependencies(projectRoot, temporaryDirectory("state")));

    expect(code).toBe(0);
    expect(io.stdoutText).toContain("mock/mock");
  });

  it("shuts down the active harness when interactive mode exits", async () => {
    const io = captureIo();
    let shutdownCalled = false;
    const code = await runCli(["--mock"], io, {
      ...dependencies(
        temporaryDirectory("interactive-workspace"),
        temporaryDirectory("interactive-state"),
      ),
      interactive: true,
      bootstrap: async (options) => {
        const harness = await bootstrapHarness(options);
        const shutdown = harness.shutdown.bind(harness);
        harness.shutdown = async () => {
          shutdownCalled = true;
          await shutdown();
        };
        return harness;
      },
      runTui: () => Promise.resolve(0),
    });

    expect(code).toBe(0);
    expect(shutdownCalled).toBe(true);
  });
});
