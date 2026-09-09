import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  tinyCodeConfigSchema,
  type TinyCodeConfig,
} from "./schema.js";

export interface ConfigOverrides {
  model?: {
    provider?: string;
    model?: string;
  };
  maxOutputTokens?: number;
  permissionMode?: "ask" | "auto";
  context?: {
    maxTokens?: number;
    compactThreshold?: number;
    toolResultMaxChars?: number;
  };
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

export interface ConfigWarning {
  code: "suspicious-secret";
  path: string;
  message: string;
}

export interface LoadConfigOptions {
  projectRoot: string;
  userConfigPath?: string;
  env?: NodeJS.ProcessEnv;
  cli?: ConfigOverrides;
}

export interface LoadedConfig {
  config: TinyCodeConfig;
  warnings: ConfigWarning[];
  projectConfigPath: string;
  userConfigPath: string | undefined;
}

type UnknownConfig = Record<string, unknown>;

function asObject(value: unknown): UnknownConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownConfig)
    : {};
}

function mergeConfig(...sources: unknown[]): UnknownConfig {
  const merged: UnknownConfig = {};

  for (const source of sources) {
    for (const [key, value] of Object.entries(asObject(source))) {
      if (value === undefined) {
        continue;
      }

      const previous = merged[key];
      const shouldMerge =
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof previous === "object" &&
        previous !== null &&
        !Array.isArray(previous);

      merged[key] = shouldMerge
        ? mergeConfig(previous, value)
        : value;
    }
  }

  return merged;
}

function numberFromEnv(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function configFromEnv(env: NodeJS.ProcessEnv): ConfigOverrides {
  const config: ConfigOverrides = {};
  const model: NonNullable<ConfigOverrides["model"]> = {};
  const context: NonNullable<ConfigOverrides["context"]> = {};

  if (env.TINYCODE_PROVIDER !== undefined) {
    model.provider = env.TINYCODE_PROVIDER;
  }
  if (env.TINYCODE_MODEL !== undefined) {
    model.model = env.TINYCODE_MODEL;
  }
  if (Object.keys(model).length > 0) {
    config.model = model;
  }

  const maxOutputTokens = numberFromEnv(env.TINYCODE_MAX_OUTPUT_TOKENS);
  if (maxOutputTokens !== undefined) {
    config.maxOutputTokens = maxOutputTokens;
  }

  if (env.TINYCODE_PERMISSION_MODE !== undefined) {
    if (
      env.TINYCODE_PERMISSION_MODE !== "ask" &&
      env.TINYCODE_PERMISSION_MODE !== "auto"
    ) {
      throw new Error(
        "TINYCODE_PERMISSION_MODE must be either 'ask' or 'auto'",
      );
    }
    config.permissionMode = env.TINYCODE_PERMISSION_MODE;
  }

  const maxTokens = numberFromEnv(env.TINYCODE_CONTEXT_MAX_TOKENS);
  if (maxTokens !== undefined) {
    context.maxTokens = maxTokens;
  }
  const compactThreshold = numberFromEnv(
    env.TINYCODE_CONTEXT_COMPACT_THRESHOLD,
  );
  if (compactThreshold !== undefined) {
    context.compactThreshold = compactThreshold;
  }
  const toolResultMaxChars = numberFromEnv(
    env.TINYCODE_CONTEXT_TOOL_RESULT_MAX_CHARS,
  );
  if (toolResultMaxChars !== undefined) {
    context.toolResultMaxChars = toolResultMaxChars;
  }
  if (Object.keys(context).length > 0) {
    config.context = context;
  }

  return config;
}

function isSuspiciousSecretField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();

  return (
    normalized === "token" ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("authtoken") ||
    normalized.endsWith("bearertoken") ||
    normalized.endsWith("privatekey")
  );
}

function findSuspiciousSecretFields(
  value: unknown,
  parentPath = "",
): ConfigWarning[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findSuspiciousSecretFields(item, `${parentPath}[${String(index)}]`),
    );
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  const warnings: ConfigWarning[] = [];
  const record = value as UnknownConfig;

  for (const key of Object.keys(record)) {
    const path = parentPath === "" ? key : `${parentPath}.${key}`;

    if (isSuspiciousSecretField(key)) {
      warnings.push({
        code: "suspicious-secret",
        path,
        message: `Suspicious secret field at ${path}; API keys must come from environment variables.`,
      });
      continue;
    }

    warnings.push(...findSuspiciousSecretFields(record[key], path));
  }

  return warnings;
}

export function loadConfig(options: LoadConfigOptions): LoadedConfig {
  const projectConfigPath = join(
    options.projectRoot,
    ".tinycode",
    "config.json",
  );
  const projectConfig = existsSync(projectConfigPath)
    ? (JSON.parse(readFileSync(projectConfigPath, "utf8")) as unknown)
    : {};
  const userConfig =
    options.userConfigPath !== undefined && existsSync(options.userConfigPath)
      ? (JSON.parse(readFileSync(options.userConfigPath, "utf8")) as unknown)
      : {};
  const envConfig = configFromEnv(options.env ?? process.env);
  const merged = mergeConfig(
    userConfig,
    projectConfig,
    envConfig,
    options.cli ?? {},
  );

  return {
    config: tinyCodeConfigSchema.parse(merged),
    warnings: [
      ...findSuspiciousSecretFields(userConfig),
      ...findSuspiciousSecretFields(projectConfig),
    ],
    projectConfigPath,
    userConfigPath: options.userConfigPath,
  };
}

export function saveUserConfig(
  path: string,
  config: TinyCodeConfig,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, undefined, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
