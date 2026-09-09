import { describe, expect, it, vi } from "vitest";

import { tinyCodeConfigSchema } from "../src/config/schema.js";
import { collectFirstRunConfig } from "../src/tui/setup-wizard.js";
import {
  applySettingChange,
  createSettingItems,
} from "../src/tui/settings.js";

describe("first-launch setup", () => {
  it("selects the mock model and fills every localized setting with its default", async () => {
    const answers = ["1", ""];
    const ask = vi.fn().mockImplementation(() =>
      Promise.resolve(answers.shift() ?? ""),
    );

    const config = await collectFirstRunConfig(ask);

    expect(config).toEqual({
      model: { provider: "mock", model: "mock" },
      maxOutputTokens: 4_096,
      permissionMode: "ask",
      context: {
        maxTokens: 32_000,
        compactThreshold: 0.8,
        toolResultMaxChars: 12_000,
      },
      mcpServers: {},
    });
    expect(ask.mock.calls.flat().join("\n")).toContain("模拟模型");
    expect(ask.mock.calls.flat().join("\n")).toContain("权限模式");
  });

  it("accepts a provider/model reference for a real model", async () => {
    const answers = ["2", "openai/gpt-5", ""];
    const config = await collectFirstRunConfig(() =>
      Promise.resolve(answers.shift() ?? ""),
    );

    expect(config.model).toEqual({ provider: "openai", model: "gpt-5" });
  });
});

describe("localized settings", () => {
  it("shows Chinese labels, environment names, and schema defaults", () => {
    const config = tinyCodeConfigSchema.parse({
      model: { provider: "mock", model: "mock" },
    });

    expect(
      createSettingItems(config, ["mock/mock", "openai/gpt-5"]).map(
        ({ label, currentValue }) => [label, currentValue],
      ),
    ).toEqual([
      ["运行模型", "mock/mock"],
      ["权限模式（TINYCODE_PERMISSION_MODE）", "询问（ask）"],
      ["最大输出 Token 数（TINYCODE_MAX_OUTPUT_TOKENS）", "4096"],
      ["上下文最大 Token 数（TINYCODE_CONTEXT_MAX_TOKENS）", "32000"],
      ["上下文压缩阈值（TINYCODE_CONTEXT_COMPACT_THRESHOLD）", "0.8"],
      ["工具结果最大字符数（TINYCODE_CONTEXT_TOOL_RESULT_MAX_CHARS）", "12000"],
    ]);
  });

  it("applies model, permission, and numeric changes without dropping MCP config", () => {
    const initial = tinyCodeConfigSchema.parse({
      model: { provider: "mock", model: "mock" },
      mcpServers: {
        local: { command: "node", args: ["server.js"] },
      },
    });

    const withModel = applySettingChange(initial, "model", "openai/gpt-5");
    const withPermission = applySettingChange(
      withModel,
      "permissionMode",
      "自动（auto）",
    );
    const updated = applySettingChange(
      withPermission,
      "context.maxTokens",
      "64000",
    );

    expect(updated).toMatchObject({
      model: { provider: "openai", model: "gpt-5" },
      permissionMode: "auto",
      context: { maxTokens: 64_000 },
      mcpServers: { local: { command: "node", args: ["server.js"] } },
    });
  });
});
