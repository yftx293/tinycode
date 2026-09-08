function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .flatMap((block) => {
      const item = record(block);
      return item?.type === "text" && typeof item.text === "string"
        ? [item.text]
        : [];
    })
    .join("\n");
}

export interface ToolRenderResult {
  summary: string;
  detail?: string;
}

export function renderToolEnd(
  toolName: string,
  result: unknown,
  isError: boolean,
): ToolRenderResult {
  const resultRecord = record(result);
  const details = record(resultRecord?.details);
  const exitCode = details?.exitCode;
  const summary = [
    `tool> ${toolName} ${isError ? "failed" : "completed"}`,
    typeof exitCode === "number" || exitCode === null
      ? ` (exit ${String(exitCode)})`
      : "",
  ].join("");

  const diff = details?.diff;
  if (typeof diff === "string" && diff.length > 0) {
    return { summary, detail: diff };
  }
  const stderr = details?.stderr;
  if (isError && typeof stderr === "string" && stderr.length > 0) {
    return { summary, detail: stderr };
  }
  const content = textContent(resultRecord?.content);
  return content.length > 0 ? { summary, detail: content } : { summary };
}
