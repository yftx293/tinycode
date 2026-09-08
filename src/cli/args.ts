import type { ModelRef } from "../model/registry.js";

export type PermissionMode = "ask" | "auto";

export type CliArguments =
  | { kind: "help" }
  | { kind: "version" }
  | {
      kind: "run";
      model?: ModelRef;
      mock?: boolean;
      listModels?: boolean;
      prompt?: string;
      continue?: boolean;
      sessionId?: string;
      permissionMode?: PermissionMode;
    };

function optionValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

export function parseModelRef(value: string): ModelRef {
  const separator = value.indexOf("/");
  if (separator === -1) {
    return { model: value };
  }
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (provider.length === 0 || model.length === 0) {
    throw new Error("--model must be a model id or provider/model");
  }
  return { provider, model };
}

export function parseCliArgs(args: readonly string[]): CliArguments {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { kind: "help" };
  }
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    return { kind: "version" };
  }

  const parsed: Extract<CliArguments, { kind: "run" }> = { kind: "run" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--help":
      case "-h":
        throw new Error("--help cannot be combined with other arguments");
      case "--version":
      case "-v":
        throw new Error("--version cannot be combined with other arguments");
      case "--model": {
        const value = optionValue(args, index, "--model");
        parsed.model = parseModelRef(value);
        index += 1;
        break;
      }
      case "--mock":
        parsed.mock = true;
        break;
      case "--list-models":
        parsed.listModels = true;
        break;
      case "-p":
      case "--prompt":
        parsed.prompt = optionValue(args, index, argument);
        index += 1;
        break;
      case "--continue":
        parsed.continue = true;
        break;
      case "--session":
        parsed.sessionId = optionValue(args, index, "--session");
        index += 1;
        break;
      case "--permission-mode": {
        const value = optionValue(args, index, "--permission-mode");
        if (value !== "ask" && value !== "auto") {
          throw new Error("--permission-mode must be ask or auto");
        }
        parsed.permissionMode = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  if (parsed.continue === true && parsed.sessionId !== undefined) {
    throw new Error("Choose either --continue or --session");
  }
  return parsed;
}
