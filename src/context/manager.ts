import type {
  AfterToolCallResult,
  AgentMessage,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";

import type { SessionManager } from "../session/manager.js";
import { compactMessages } from "./compact.js";
import { truncateToolResult } from "./tool-results.js";

export interface ContextManagerOptions {
  maxTokens?: number;
  compactThreshold?: number;
  toolResultMaxChars?: number;
  session?: SessionManager;
}

export class ContextManager {
  readonly maxTokens: number;
  readonly compactThreshold: number;
  readonly toolResultMaxChars: number;
  private readonly session: SessionManager | undefined;

  constructor(options: ContextManagerOptions = {}) {
    this.maxTokens = options.maxTokens ?? 32_000;
    this.compactThreshold = options.compactThreshold ?? 0.8;
    this.toolResultMaxChars = options.toolResultMaxChars ?? 12_000;
    this.session = options.session;
  }

  transform(messages: readonly AgentMessage[]): AgentMessage[] {
    return compactMessages(messages, {
      maxTokens: this.maxTokens * this.compactThreshold,
    });
  }

  compactNow(messages: readonly AgentMessage[]): AgentMessage[] {
    return compactMessages(messages, {
      maxTokens: this.maxTokens * this.compactThreshold,
      force: true,
    });
  }

  processToolResult(
    toolCallId: string,
    result: AgentToolResult<unknown>,
  ): AfterToolCallResult | undefined {
    if (this.session === undefined) {
      return undefined;
    }
    return truncateToolResult(result, {
      maxChars: this.toolResultMaxChars,
      writeArtifact: (content) =>
        this.session?.writeArtifact(toolCallId, content) ?? "",
    });
  }
}
