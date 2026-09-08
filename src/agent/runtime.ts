import {
  Agent,
  type AgentEvent,
  type AfterToolCallResult,
  type BeforeToolCallResult,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

import { PermissionManager } from "../permissions/manager.js";

export interface TinyCodeRuntimeOptions {
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt: string;
  permissionManager?: PermissionManager;
}

export class TinyCodeRuntime {
  readonly agent: Agent;
  readonly permissions: PermissionManager;

  constructor(options: TinyCodeRuntimeOptions) {
    this.permissions = options.permissionManager ?? new PermissionManager();
    this.agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: options.model,
        thinkingLevel: "off",
        tools: [],
        messages: [],
      },
      streamFn: options.streamFn,
      transformContext: (messages) => Promise.resolve(messages),
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
      afterToolCall: (): Promise<AfterToolCallResult | undefined> =>
        Promise.resolve(undefined),
    });
  }

  prompt(text: string): Promise<void> {
    return this.agent.prompt(text);
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
