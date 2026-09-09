import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/loader.js";
import { tinyCodeConfigSchema } from "../src/config/schema.js";

describe("tinyCodeConfigSchema", () => {
  it("parses the complete phase 0 configuration shape", () => {
    const parsed = tinyCodeConfigSchema.parse({
      model: {
        provider: "openai",
        model: "gpt-5",
      },
      maxOutputTokens: 8_192,
      permissionMode: "auto",
      context: {
        maxTokens: 64_000,
        compactThreshold: 0.8,
        toolResultMaxChars: 16_000,
      },
      mcpServers: {
        filesystem: {
          command: "node",
          args: ["server.js"],
          env: { LOG_LEVEL: "error" },
        },
      },
    });

    expect(parsed.model).toEqual({ provider: "openai", model: "gpt-5" });
    expect(parsed.maxOutputTokens).toBe(8_192);
    expect(parsed.permissionMode).toBe("auto");
    expect(parsed.context.compactThreshold).toBe(0.8);
    expect(parsed.mcpServers.filesystem?.command).toBe("node");
  });
});

describe("loadConfig", () => {
  it("loads remembered user settings before project, environment, and CLI overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "tinycode-user-config-"));
    const projectRoot = join(root, "project");
    const userConfigPath = join(root, "home", ".tinycode", "config.json");

    try {
      mkdirSync(projectRoot, { recursive: true });
      mkdirSync(join(projectRoot, ".tinycode"));
      mkdirSync(join(root, "home", ".tinycode"), { recursive: true });
      writeFileSync(
        userConfigPath,
        JSON.stringify({
          model: { provider: "mock", model: "mock" },
          permissionMode: "auto",
          maxOutputTokens: 4_096,
          context: {
            maxTokens: 32_000,
            compactThreshold: 0.8,
            toolResultMaxChars: 12_000,
          },
        }),
      );
      writeFileSync(
        join(projectRoot, ".tinycode", "config.json"),
        JSON.stringify({ permissionMode: "ask" }),
      );

      const loaded = loadConfig({
        projectRoot,
        userConfigPath,
        env: { TINYCODE_MAX_OUTPUT_TOKENS: "8192" },
      });

      expect(loaded.config).toMatchObject({
        model: { provider: "mock", model: "mock" },
        permissionMode: "ask",
        maxOutputTokens: 8_192,
        context: {
          maxTokens: 32_000,
          compactThreshold: 0.8,
          toolResultMaxChars: 12_000,
        },
      });
      expect(loaded.userConfigPath).toBe(userConfigPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies CLI overrides after environment and project configuration", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tinycode-config-"));

    try {
      mkdirSync(join(projectRoot, ".tinycode"));
      writeFileSync(
        join(projectRoot, ".tinycode", "config.json"),
        JSON.stringify({
          model: { provider: "project-provider", model: "project-model" },
          maxOutputTokens: 1_000,
          permissionMode: "ask",
          context: {
            maxTokens: 10_000,
            compactThreshold: 0.6,
            toolResultMaxChars: 1_000,
          },
        }),
      );

      const loaded = loadConfig({
        projectRoot,
        env: {
          TINYCODE_PROVIDER: "env-provider",
          TINYCODE_MODEL: "env-model",
          TINYCODE_MAX_OUTPUT_TOKENS: "2000",
          TINYCODE_PERMISSION_MODE: "auto",
          TINYCODE_CONTEXT_MAX_TOKENS: "20000",
        },
        cli: {
          model: { model: "cli-model" },
          maxOutputTokens: 3_000,
        },
      });

      expect(loaded.config).toMatchObject({
        model: { provider: "env-provider", model: "cli-model" },
        maxOutputTokens: 3_000,
        permissionMode: "auto",
        context: {
          maxTokens: 20_000,
          compactThreshold: 0.6,
          toolResultMaxChars: 1_000,
        },
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("warns about suspicious API key fields without exposing their values", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tinycode-secret-"));
    const sentinel = "test-secret-sentinel-do-not-expose";

    try {
      mkdirSync(join(projectRoot, ".tinycode"));
      writeFileSync(
        join(projectRoot, ".tinycode", "config.json"),
        JSON.stringify({
          model: { provider: "openai" },
          credentials: { apiKey: sentinel },
        }),
      );

      const loaded = loadConfig({ projectRoot, env: {} });
      const serializedWarnings = JSON.stringify(loaded.warnings);

      expect(loaded.warnings).toEqual([
        {
          code: "suspicious-secret",
          path: "credentials.apiKey",
          message:
            "Suspicious secret field at credentials.apiKey; API keys must come from environment variables.",
        },
      ]);
      expect(serializedWarnings).not.toContain(sentinel);
      expect(loaded.config).not.toHaveProperty("credentials");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
