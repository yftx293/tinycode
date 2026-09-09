import { createInterface } from "node:readline/promises";

import type { ModelRef } from "../model/registry.js";
import {
  tinyCodeConfigSchema,
  type TinyCodeConfig,
} from "../config/schema.js";

export type SetupQuestion = (question: string) => Promise<string>;

function parseConfiguredModel(value: string): ModelRef | undefined {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return undefined;
  }
  return {
    provider: value.slice(0, separator).trim(),
    model: value.slice(separator + 1).trim(),
  };
}

export async function collectFirstRunConfig(
  ask: SetupQuestion,
): Promise<TinyCodeConfig> {
  let model: ModelRef | undefined;
  while (model === undefined) {
    const mode = (
      await ask(
        "TinyCode 首次启动配置\n" +
          "  1. 使用模拟模型（离线，无需 API Key）\n" +
          "  2. 配置真实模型\n" +
          "请选择 [1/2]：",
      )
    ).trim();
    if (mode === "1" || mode.toLowerCase() === "mock") {
      model = { provider: "mock", model: "mock" };
      break;
    }
    if (mode === "2") {
      while (model === undefined) {
        const reference = (
          await ask(
            "请输入 provider/model（例如 openai/gpt-5；API Key 仍须通过环境变量配置）：",
          )
        ).trim();
        model = parseConfiguredModel(reference);
      }
    }
  }

  const config = tinyCodeConfigSchema.parse({ model });
  await ask(
    "将保存以下默认设置：\n" +
      `  权限模式（TINYCODE_PERMISSION_MODE）：${config.permissionMode}\n` +
      `  最大输出 Token 数（TINYCODE_MAX_OUTPUT_TOKENS）：${String(config.maxOutputTokens)}\n` +
      `  上下文最大 Token 数（TINYCODE_CONTEXT_MAX_TOKENS）：${String(config.context.maxTokens)}\n` +
      `  上下文压缩阈值（TINYCODE_CONTEXT_COMPACT_THRESHOLD）：${String(config.context.compactThreshold)}\n` +
      `  工具结果最大字符数（TINYCODE_CONTEXT_TOOL_RESULT_MAX_CHARS）：${String(config.context.toolResultMaxChars)}\n` +
      "按 Enter 保存并启动 TinyCode：",
  );
  return config;
}

export async function runFirstLaunchSetup(): Promise<TinyCodeConfig> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await collectFirstRunConfig((question) => terminal.question(question));
  } finally {
    terminal.close();
  }
}
