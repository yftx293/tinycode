import type { TinyCodeHarness } from "../bootstrap.js";
import { basename } from "node:path";

import { createTuiPalette } from "./theme.js";

export function estimateContextTokens(messages: readonly unknown[]): number {
  return Math.ceil(
    messages.reduce<number>(
      (tokens, message) => tokens + JSON.stringify(message).length / 4,
      0,
    ),
  );
}

export function renderStatusBar(
  harness: TinyCodeHarness,
  projectRoot: string,
  options: { colorEnabled?: boolean } = {},
): string {
  const palette = createTuiPalette(options.colorEnabled);
  const model = harness.runtime.agent.state.model;
  const contextTokens = estimateContextTokens(
    harness.runtime.agent.state.messages,
  );
  const runningWorkers =
    harness.agents?.reports().filter((report) => report.status === "running")
      .length ?? 0;
  return [
    harness.runtime.agent.state.isStreaming
      ? palette.warning("◌ running")
      : palette.success("● idle"),
    `model ${model.provider}/${model.id}`,
    `cwd ${basename(projectRoot) || projectRoot}`,
    `ctx ${String(contextTokens)}/${String(harness.context.maxTokens)}`,
    `session ${(harness.session?.id ?? "none").slice(0, 8)}`,
    `workers ${String(runningWorkers)}`,
  ].join(" | ");
}
