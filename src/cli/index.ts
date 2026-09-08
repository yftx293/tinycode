#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

import {
  bootstrapHarness,
  type BootstrapHarnessOptions,
  type TinyCodeHarness,
} from "../bootstrap.js";
import { loadConfig } from "../config/loader.js";
import type { ModelRef, ScriptedMockResponse } from "../model/registry.js";
import { runTinyCodeTui } from "../tui/app.js";
import { parseCliArgs } from "./args.js";

const HELP = `Usage: tinycode [options]

Options:
  -h, --help                       Show this help message
  -v, --version                    Show the installed version
  --model <model|provider/model>   Select a model
  --mock                           Use the offline mock model
  --list-models                    List known models
  -p, --prompt <text>              Run once and print the final response
  --continue                       Continue the latest session for this cwd
  --session <id>                   Resume an explicit session
  --permission-mode <ask|auto>     Approval mode (default: ask)
`;

export interface CliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}

export interface CliDependencies {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stateDirectory?: string;
  mockResponses?: readonly ScriptedMockResponse[];
  interactive?: boolean;
  bootstrap?: typeof bootstrapHarness;
  runTui?: (
    harness: TinyCodeHarness,
    options: Parameters<typeof runTinyCodeTui>[1],
  ) => Promise<number>;
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as unknown;
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error("package.json does not contain a valid version");
  }
  return packageJson.version;
}

function messageText(message: AgentMessage | undefined): string {
  if (message?.role !== "assistant") {
    return "";
  }
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function isMockModel(model: ModelRef): boolean {
  return model.provider === "mock" || model.model === "mock";
}

function normalizeModelRef(model: {
  provider?: string | undefined;
  model?: string | undefined;
}): ModelRef {
  return {
    ...(model.provider === undefined ? {} : { provider: model.provider }),
    ...(model.model === undefined ? {} : { model: model.model }),
  };
}

function knownModels(): string[] {
  const catalog = builtinModels()
    .getModels()
    .map((model) => `${model.provider}/${model.id}`);
  return [...new Set(["mock/mock", ...catalog])].sort();
}

export async function runCli(
  args: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: CliDependencies = {},
): Promise<number> {
  let harness: TinyCodeHarness | undefined;
  try {
    const parsed = parseCliArgs(args);
    if (parsed.kind === "help") {
      io.stdout.write(HELP);
      return 0;
    }
    if (parsed.kind === "version") {
      io.stdout.write(`${readPackageVersion()}\n`);
      return 0;
    }
    if (parsed.listModels === true) {
      io.stdout.write(`${knownModels().join("\n")}\n`);
      return 0;
    }

    const projectRoot = resolve(dependencies.cwd ?? process.cwd());
    const env = dependencies.env ?? process.env;
    const loaded = loadConfig({
      projectRoot,
      env,
      cli: {
        ...(parsed.model === undefined ? {} : { model: parsed.model }),
        ...(parsed.permissionMode === undefined
          ? {}
          : { permissionMode: parsed.permissionMode }),
      },
    });
    for (const warning of loaded.warnings) {
      io.stderr.write(`Warning: ${warning.message}\n`);
    }
    const stateDirectory = resolve(
      dependencies.stateDirectory ??
        env.TINYCODE_HOME ??
        join(homedir(), ".tinycode", "sessions"),
    );
    const configuredModel = normalizeModelRef(loaded.config.model);
    const useMock = parsed.mock === true || isMockModel(configuredModel);
    const defaultMockResponse =
      parsed.prompt === undefined ? "TinyCode mock response" : `Mock response: ${parsed.prompt}`;
    const mockResponses =
      dependencies.mockResponses !== undefined &&
      dependencies.mockResponses.length > 0
        ? dependencies.mockResponses
        : [defaultMockResponse];

    const baseOptions: BootstrapHarnessOptions = {
      projectRoot,
      model: configuredModel,
      session: {
        directory: stateDirectory,
        ...(parsed.sessionId === undefined ? {} : { id: parsed.sessionId }),
        ...(parsed.continue === undefined ? {} : { continue: parsed.continue }),
      },
      context: loaded.config.context,
      mcpServers: loaded.config.mcpServers,
      subAgents: {
        toolResultMaxChars: loaded.config.context.toolResultMaxChars,
      },
      ...(useMock ? { mock: { responses: mockResponses } } : {}),
    };
    const createHarness = async (
      selection?: { id?: string; continue?: boolean },
    ): Promise<TinyCodeHarness> => {
      const next = await (dependencies.bootstrap ?? bootstrapHarness)({
        ...baseOptions,
        session: {
          directory: stateDirectory,
          ...(selection?.id === undefined ? {} : { id: selection.id }),
          ...(selection?.continue === undefined
            ? {}
            : { continue: selection.continue }),
        },
      });
      next.runtime.permissions.setMode(loaded.config.permissionMode);
      harness = next;
      return next;
    };

    harness = await createHarness({
      ...(parsed.sessionId === undefined ? {} : { id: parsed.sessionId }),
      ...(parsed.continue === undefined ? {} : { continue: parsed.continue }),
    });

    if (parsed.prompt !== undefined) {
      await harness.runtime.prompt(parsed.prompt);
      const finalMessage = harness.runtime.agent.state.messages.findLast(
        (message) => message.role === "assistant",
      );
      const text = messageText(finalMessage);
      if (finalMessage?.role === "assistant" && finalMessage.errorMessage !== undefined) {
        io.stderr.write(`${finalMessage.errorMessage}\n`);
        return 1;
      }
      if (text.length > 0) {
        io.stdout.write(`${text}\n`);
      }
      return 0;
    }

    const interactive =
      dependencies.interactive ??
      (process.stdin.isTTY && process.stdout.isTTY);
    if (!interactive) {
      throw new Error("Interactive mode requires a TTY; use -p for print mode");
    }
    return await (dependencies.runTui ?? runTinyCodeTui)(harness, {
      projectRoot,
      sessionDirectory: stateDirectory,
      createHarness,
    });
  } catch (error) {
    io.stderr.write(
      `${error instanceof Error ? error.message : "Unknown TinyCode error"}\n`,
    );
    return 1;
  } finally {
    await harness?.shutdown();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
