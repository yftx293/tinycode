import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface CompactMessagesOptions {
  maxTokens: number;
  force?: boolean;
}

export function estimateMessageTokens(message: AgentMessage): number {
  return JSON.stringify(message).length / 4;
}

export function estimateContextTokens(
  messages: readonly AgentMessage[],
): number {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
}

function messageText(message: AgentMessage): string {
  if (!("content" in message)) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .flatMap((block) => {
      if (block.type === "text") {
        return [block.text];
      }
      if (block.type === "toolCall") {
        return [`called ${block.name}`];
      }
      return [];
    })
    .join(" ");
}

function createSummary(
  messages: readonly AgentMessage[],
  maxCharacters: number,
): AgentMessage {
  const details = messages
    .map((message) => {
      const text = messageText(message).replaceAll(/\s+/gu, " ").trim();
      const excerpt = text.length > 100 ? `${text.slice(0, 100)}…` : text;
      return `${message.role}: ${excerpt || "(no text)"}`;
    })
    .join("\n");
  const heading = "[Compacted conversation summary]\n";
  const available = Math.max(0, maxCharacters - heading.length);
  const content = `${heading}${details.slice(0, available)}`;
  const finalMessage = messages.at(-1);
  return {
    role: "user",
    content,
    timestamp:
      finalMessage !== undefined && "timestamp" in finalMessage
        ? finalMessage.timestamp
        : Date.now(),
  };
}

export function compactMessages(
  messages: readonly AgentMessage[],
  options: CompactMessagesOptions,
): AgentMessage[] {
  if (
    messages.length < 2 ||
    (options.force !== true &&
      estimateContextTokens(messages) <= options.maxTokens)
  ) {
    return messages.slice();
  }

  const userBoundaries = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  if (userBoundaries.length < 2) {
    return messages.slice();
  }

  const summaryCharacters = Math.max(
    120,
    Math.floor(options.maxTokens * 4 * 0.3),
  );
  let selectedBoundary = userBoundaries.at(-1) ?? 0;
  for (const boundary of userBoundaries.slice(1)) {
    const summary = createSummary(
      messages.slice(0, boundary),
      summaryCharacters,
    );
    const candidate = [summary, ...messages.slice(boundary)];
    if (estimateContextTokens(candidate) <= options.maxTokens) {
      selectedBoundary = boundary;
      break;
    }
  }

  return [
    createSummary(messages.slice(0, selectedBoundary), summaryCharacters),
    ...messages.slice(selectedBoundary),
  ];
}
