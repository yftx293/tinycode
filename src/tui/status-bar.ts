import type { TinyCodeHarness } from "../bootstrap.js";

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
): string {
  const model = harness.runtime.agent.state.model;
  const contextTokens = estimateContextTokens(
    harness.runtime.agent.state.messages,
  );
  const runningWorkers =
    harness.agents?.reports().filter((report) => report.status === "running")
      .length ?? 0;
  return [
    `model ${model.provider}/${model.id}`,
    `cwd ${projectRoot}`,
    `context ${String(contextTokens)}/${String(harness.context.maxTokens)}`,
    `session ${harness.session?.id ?? "none"}`,
    `workers ${String(runningWorkers)}`,
  ].join(" | ");
}
