import { statSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { resolveWorkspacePath } from "./paths.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_OUTPUT_CHARS = 20_000;

const bashParameters = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    cwd: Type.Optional(Type.String({ minLength: 1 })),
    timeoutMs: Type.Optional(
      Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS }),
    ),
    maxOutputChars: Type.Optional(
      Type.Integer({ minimum: 100, maximum: 100_000 }),
    ),
  },
  { additionalProperties: false },
);

export interface BashToolDetails {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

class BoundedOutput {
  readonly #headLimit: number;
  readonly #tailLimit: number;
  #head = "";
  #tail = "";
  #totalLength = 0;

  constructor(readonly maxLength: number) {
    this.#headLimit = Math.floor(maxLength / 2);
    this.#tailLimit = maxLength - this.#headLimit;
  }

  append(chunk: Buffer | string): void {
    let text = chunk.toString();
    this.#totalLength += text.length;

    if (this.#head.length < this.#headLimit) {
      const headCharacters = Math.min(
        this.#headLimit - this.#head.length,
        text.length,
      );
      this.#head += text.slice(0, headCharacters);
      text = text.slice(headCharacters);
    }

    if (text.length > 0) {
      this.#tail = `${this.#tail}${text}`.slice(-this.#tailLimit);
    }
  }

  render(): { text: string; truncated: boolean } {
    if (this.#totalLength <= this.maxLength) {
      return { text: `${this.#head}${this.#tail}`, truncated: false };
    }

    const omitted = this.#totalLength - this.#head.length - this.#tail.length;
    return {
      text: `${this.#head}\n... omitted ${String(omitted)} characters ...\n${this.#tail}`,
      truncated: true,
    };
  }
}

function abortError(): Error {
  const error = new Error("Command aborted");
  error.name = "AbortError";
  return error;
}

interface DirectCommand {
  file: string;
  args: string[];
}

function parseDirectCommand(command: string): DirectCommand | undefined {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) {
      continue;
    }

    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else if (
        character === "\\" &&
        quote === '"' &&
        (command[index + 1] === '"' || command[index + 1] === "\\")
      ) {
        index += 1;
        const escaped = command[index];
        if (escaped !== undefined) {
          token += escaped;
        }
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/u.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
    } else if (/[|&;<>()]/u.test(character)) {
      return undefined;
    } else {
      token += character;
      tokenStarted = true;
    }
  }

  if (quote !== undefined) {
    return undefined;
  }
  if (tokenStarted) {
    tokens.push(token);
  }

  const file = tokens[0];
  if (file === undefined || !isAbsolute(file)) {
    return undefined;
  }
  return { file, args: tokens.slice(1) };
}

function terminateProcessTree(
  child: ChildProcess,
  directlySpawned: boolean,
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolveTermination) => {
      let childClosed = child.exitCode !== null || child.signalCode !== null;
      let killerFinished = false;
      let finished = false;
      const fallback = setTimeout(() => {
        if (!finished) {
          child.kill("SIGKILL");
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
          finished = true;
          resolveTermination();
        }
      }, 500);
      fallback.unref();
      const finishWhenClosed = (): void => {
        if (!finished && childClosed && killerFinished) {
          finished = true;
          clearTimeout(fallback);
          resolveTermination();
        }
      };
      child.once("close", () => {
        childClosed = true;
        finishWhenClosed();
      });
      if (directlySpawned) {
        child.kill("SIGTERM");
        killerFinished = true;
        finishWhenClosed();
        return;
      }

      const killer = spawn(
        "taskkill",
        ["/pid", String(pid), "/t", "/f"],
        { stdio: "ignore", windowsHide: true },
      );
      const finishKiller = (): void => {
        if (killerFinished) {
          return;
        }
        killerFinished = true;
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        finishWhenClosed();
      };
      killer.once("error", finishKiller);
      killer.once("close", finishKiller);
    });
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  return new Promise((resolveTermination) => {
    const forceKill = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      resolveTermination();
    }, 500);
    forceKill.unref();
    child.once("close", () => {
      clearTimeout(forceKill);
      resolveTermination();
    });
  });
}

export function createBashTool(
  projectRoot: string,
): AgentTool<typeof bashParameters, BashToolDetails> {
  return {
    name: "bash",
    label: "Run command",
    description: "Run a shell command inside the workspace.",
    parameters: bashParameters,
    execute: (_toolCallId, params, signal) => {
      signal?.throwIfAborted();
      const cwd = resolveWorkspacePath(projectRoot, params.cwd);
      if (!statSync(cwd).isDirectory()) {
        return Promise.reject(
          new Error(`Command cwd is not a directory: ${params.cwd ?? "."}`),
        );
      }

      const timeoutMs = Math.min(
        params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      );
      const maxOutputChars = params.maxOutputChars ?? DEFAULT_OUTPUT_CHARS;
      const stdout = new BoundedOutput(maxOutputChars);
      const stderr = new BoundedOutput(maxOutputChars);
      const startedAt = Date.now();

      return new Promise((resolveExecution, rejectExecution) => {
        const directCommand = parseDirectCommand(params.command);
        const spawnOptions = {
          cwd,
          detached: true,
          env: process.env,
          windowsHide: true,
        };
        const child =
          directCommand === undefined
            ? spawn(params.command, { ...spawnOptions, shell: true })
            : spawn(directCommand.file, directCommand.args, spawnOptions);
        let timedOut = false;
        let aborted = false;
        let termination: Promise<void> | undefined;
        let settled = false;

        child.stdout.on("data", (chunk: Buffer) => {
          stdout.append(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr.append(chunk);
        });

        const terminate = (): Promise<void> => {
          termination ??= terminateProcessTree(
            child,
            directCommand !== undefined,
          );
          return termination;
        };
        const rejectAfterTermination = (error: Error): void => {
          void terminate().then(() => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              signal?.removeEventListener("abort", onAbort);
              rejectExecution(error);
            }
          });
        };
        const onAbort = (): void => {
          aborted = true;
          rejectAfterTermination(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const timeout = setTimeout(() => {
          timedOut = true;
          rejectAfterTermination(
            new Error(`Command timed out after ${String(timeoutMs)}ms`),
          );
        }, timeoutMs);
        timeout.unref();

        child.once("error", (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          rejectExecution(new Error(`Unable to start command: ${error.message}`));
        });

        child.once("close", (exitCode, exitSignal) => {
          if (settled || aborted || timedOut) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          const stdoutResult = stdout.render();
          const stderrResult = stderr.render();
          const summary = [
            `Exit code: ${String(exitCode)}`,
            stdoutResult.text.length > 0
              ? `stdout:\n${stdoutResult.text}`
              : "stdout: (empty)",
            stderrResult.text.length > 0
              ? `stderr:\n${stderrResult.text}`
              : "stderr: (empty)",
          ].join("\n");

          resolveExecution({
            content: [{ type: "text" as const, text: summary }],
            details: {
              command: params.command,
              cwd,
              exitCode,
              signal: exitSignal,
              timedOut: false,
              durationMs: Date.now() - startedAt,
              stdout: stdoutResult.text,
              stderr: stderrResult.text,
              stdoutTruncated: stdoutResult.truncated,
              stderrTruncated: stderrResult.truncated,
            },
          });
        });
      });
    },
  };
}
