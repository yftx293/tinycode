import {
  Agent,
  type AgentEvent,
  type AfterToolCallResult,
  type BeforeToolCallResult,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

import { PermissionManager } from "../permissions/manager.js";
import { SessionManager } from "../session/manager.js";
import { ContextManager } from "../context/manager.js";

export interface TinyCodeRuntimeOptions {
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt: string;
  permissionManager?: PermissionManager;
  sessionManager?: SessionManager;
  contextManager?: ContextManager;
}

export class TinyCodeRuntime {
  readonly agent: Agent;
  readonly permissions: PermissionManager;
  readonly context: ContextManager;

  constructor(options: TinyCodeRuntimeOptions) {
    this.permissions = options.permissionManager ?? new PermissionManager();
    this.context = options.contextManager ?? new ContextManager();
    this.agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: options.model,
        thinkingLevel: "off",
        tools: [],
        messages: options.sessionManager?.messages ?? [],
      },
      streamFn: options.streamFn,
      transformContext: (messages) => Promise.resolve(this.context.transform(messages)),
      beforeToolCall: async ({ toolCall, args }): Promise<
        BeforeToolCallResult | undefined
      > => {
        const input =
          typeof args === "object" && args !== null && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {};
        const decision = await this.permissions.check(toolCall.name, input);
        return decision.action === "deny"
          ? { block: true, reason: `Permission denied: ${decision.reason}` }
          : undefined;
      },
      afterToolCall: ({ toolCall, result }): Promise<
        AfterToolCallResult | undefined
      > => Promise.resolve(this.context.processToolResult(toolCall.id, result)),
    });
    if (options.sessionManager !== undefined) {
      this.agent.subscribe((event) => {
        if (event.type === "message_end") {
          options.sessionManager?.appendMessage(event.message);
        }
      });
    }
  }

  prompt(text: string): Promise<void> {
    return this.agent.prompt(text);
  }

  compactNow(): void {
    if (this.agent.state.isStreaming) {
      throw new Error("Cannot compact while the agent is running");
    }

    this.agent.state.messages = this.context.compactNow(
      this.agent.state.messages,
    );
  }

  abort(): void {
    this.agent.abort();
  }

  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void {
    return this.agent.subscribe(listener);
  }
}
