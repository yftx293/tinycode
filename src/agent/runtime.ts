import {
  Agent,
  type AgentEvent,
  type AfterToolCallResult,
  type BeforeToolCallResult,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

export interface TinyCodeRuntimeOptions {
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt: string;
}

export class TinyCodeRuntime {
  readonly agent: Agent;

  constructor(options: TinyCodeRuntimeOptions) {
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
      beforeToolCall: (): Promise<BeforeToolCallResult | undefined> =>
        Promise.resolve(undefined),
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
