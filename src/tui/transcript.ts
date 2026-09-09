import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";

import { renderToolEnd } from "./tool-view.js";

function assistantText(message: AgentMessage): string {
  if (message.role !== "assistant") {
    return "";
  }
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function userText(message: AgentMessage): string {
  if (message.role !== "user") {
    return "";
  }
  return typeof message.content === "string"
    ? message.content
    : message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
}

export class TranscriptModel {
  private readonly renderedLines: string[] = [];
  private streamingLine: number | undefined;

  append(line: string): void {
    this.renderedLines.push(line);
  }

  hydrate(messages: readonly AgentMessage[]): void {
    this.renderedLines.length = 0;
    this.streamingLine = undefined;

    for (const message of messages) {
      if (message.role === "user") {
        const text = userText(message);
        if (text.length > 0) {
          this.renderedLines.push(`user> ${text}`);
        }
        continue;
      }
      if (message.role === "assistant") {
        if (message.errorMessage !== undefined) {
          this.renderedLines.push(`error> ${message.errorMessage}`);
          continue;
        }
        const text = assistantText(message);
        if (text.length > 0) {
          this.renderedLines.push(`assistant> ${text}`);
        }
        continue;
      }
      if (message.role === "toolResult") {
        const rendered = renderToolEnd(
          message.toolName,
          { content: message.content, details: message.details as unknown },
          message.isError,
        );
        this.renderedLines.push(rendered.summary);
        if (rendered.detail !== undefined) {
          this.renderedLines.push(rendered.detail);
        }
      }
    }
  }

  consume(event: AgentEvent): void {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      if (this.streamingLine === undefined) {
        this.streamingLine = this.renderedLines.length;
        this.renderedLines.push("assistant> ");
      }
      const previous = this.renderedLines[this.streamingLine] ?? "assistant> ";
      this.renderedLines[this.streamingLine] =
        previous + event.assistantMessageEvent.delta;
      return;
    }

    if (event.type === "message_end") {
      if (event.message.role === "assistant") {
        if (event.message.errorMessage !== undefined) {
          this.renderedLines.push(`error> ${event.message.errorMessage}`);
        } else if (this.streamingLine === undefined) {
          const text = assistantText(event.message);
          if (text.length > 0) {
            this.renderedLines.push(`assistant> ${text}`);
          }
        }
        this.streamingLine = undefined;
      }
      return;
    }

    if (event.type === "tool_execution_start") {
      this.renderedLines.push(
        `tool> ${event.toolName} started ${JSON.stringify(event.args)}`,
      );
      return;
    }

    if (event.type === "tool_execution_end") {
      const rendered = renderToolEnd(event.toolName, event.result, event.isError);
      this.renderedLines.push(rendered.summary);
      if (rendered.detail !== undefined) {
        this.renderedLines.push(rendered.detail);
      }
    }
  }

  lines(): string[] {
    return this.renderedLines.slice();
  }

  text(): string {
    return this.renderedLines.join("\n");
  }
}
