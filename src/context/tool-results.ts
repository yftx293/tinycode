import type {
  AfterToolCallResult,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";

export interface TruncateToolResultOptions {
  maxChars: number;
  writeArtifact: (content: string) => string;
}

export function truncateToolResult(
  result: AgentToolResult<unknown>,
  options: TruncateToolResultOptions,
): AfterToolCallResult | undefined {
  const fullText = result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  if (fullText.length <= options.maxChars) {
    return undefined;
  }

  const artifactPath = options.writeArtifact(fullText);
  const markerTemplate = `\n... omitted characters ...\nFull output: ${artifactPath}\n`;
  const keptCharacters = Math.max(64, options.maxChars - markerTemplate.length);
  const headLength = Math.floor(keptCharacters / 2);
  const tailLength = keptCharacters - headLength;
  const omitted = fullText.length - headLength - tailLength;
  const text = `${fullText.slice(0, headLength)}\n... omitted ${String(omitted)} characters ...\nFull output: ${artifactPath}\n${fullText.slice(-tailLength)}`;

  return { content: [{ type: "text", text }] };
}
