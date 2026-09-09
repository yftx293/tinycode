import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { resolve } from "node:path";
import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Message,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { bootstrapHarness } from "../src/bootstrap.js";
import { ModelRegistry } from "../src/model/registry.js";

function isLlmMessage(message: AgentMessage): message is Message {
  return (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "toolResult"
  );
}

function messageText(message: AgentMessage): string {
  if (!isLlmMessage(message)) {
    throw new Error(`Unexpected agent message role: ${message.role}`);
  }
  return contentText(message.content);
}

describe("TinyCodeRuntime", () => {
  it("forwards the configured maximum output tokens to provider requests", async () => {
    let observedMaxTokens: number | undefined;
    const { runtime } = await bootstrapHarness({
      projectRoot: "C:\\workspace\\output-limit",
      maxOutputTokens: 1_234,
      mock: {
        responses: [
          (_context, options) => {
            observedMaxTokens = options?.maxTokens;
            return fauxAssistantMessage("limited reply");
          },
        ],
      },
    });

    await runtime.prompt("hello");

    expect(observedMaxTokens).toBe(1_234);
  });

  it("uses a scripted mock model for two turns and preserves message order", async () => {
    const { runtime } = await bootstrapHarness({
      projectRoot: "C:\\workspace\\demo",
      mock: {
        responses: ["first reply", "second reply"],
      },
    });

    expect(runtime.agent).toBeInstanceOf(Agent);

    await runtime.prompt("first question");
    await runtime.prompt("second question");

    expect(runtime.agent.state.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(
      runtime.agent.state.messages.map(messageText),
    ).toEqual([
      "first question",
      "first reply",
      "second question",
      "second reply",
    ]);
  });

  it("exposes Pi message and agent lifecycle events", async () => {
    const { runtime } = await bootstrapHarness({
      projectRoot: "C:\\workspace\\events",
      mock: { responses: ["streamed reply"] },
    });
    const eventTypes: string[] = [];
    const unsubscribe = runtime.subscribe((event) => {
      eventTypes.push(event.type);
    });

    await runtime.prompt("hello");
    unsubscribe();

    expect(eventTypes.filter((type) => type === "message_start")).toHaveLength(
      2,
    );
    expect(eventTypes).toContain("message_update");
    expect(eventTypes.filter((type) => type === "message_end")).toHaveLength(2);
    expect(eventTypes.at(-1)).toBe("agent_end");
  });

  it("builds a concise system prompt around the project root and tool policy", async () => {
    const projectRoot = "relative-project";
    const { runtime } = await bootstrapHarness({
      projectRoot,
      mock: { responses: [] },
    });
    const systemPrompt = runtime.agent.state.systemPrompt;

    expect(systemPrompt).toContain(`Project root: ${resolve(projectRoot)}`);
    expect(systemPrompt).toContain("Use only the tools provided by the harness");
    expect(systemPrompt.split("\n")).toHaveLength(5);
    expect(systemPrompt).not.toMatch(/session|MCP|permission/iu);
  });

  it("returns to idle after abort and accepts the next prompt", async () => {
    const { runtime, models } = await bootstrapHarness({
      projectRoot: "C:\\workspace\\abort",
      mock: {
        responses: ["this response is intentionally slow and will be aborted"],
        tokensPerSecond: 10,
      },
    });
    let markAssistantStarted: (() => void) | undefined;
    const assistantStarted = new Promise<void>((resolve) => {
      markAssistantStarted = resolve;
    });
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant") {
        markAssistantStarted?.();
      }
    });

    const abortedPrompt = runtime.prompt("cancel this turn");
    expect(runtime.agent.state.isStreaming).toBe(true);

    await assistantStarted;
    runtime.abort();
    await Promise.all([abortedPrompt, runtime.waitForIdle()]);
    unsubscribe();

    expect(runtime.agent.state.isStreaming).toBe(false);
    expect(runtime.agent.state.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "aborted",
    });

    runtime.agent.state.model = models.enableMock({
      responses: ["recovered reply"],
      tokensPerSecond: 10_000,
    });
    await runtime.prompt("try again");

    const lastMessage = runtime.agent.state.messages.at(-1);
    expect(lastMessage?.role).toBe("assistant");
    expect(lastMessage && messageText(lastMessage)).toBe("recovered reply");
    expect(runtime.agent.state.isStreaming).toBe(false);
  });
});

describe("ModelRegistry", () => {
  it("prefers an explicit model reference over the configured provider", async () => {
    const models = createModels();
    const configured = fauxProvider({
      provider: "configured-provider",
      models: [{ id: "configured-model" }],
    });
    const explicit = fauxProvider({
      provider: "explicit-provider",
      models: [{ id: "explicit-model" }],
    });
    models.setProvider(configured.provider);
    models.setProvider(explicit.provider);
    const registry = new ModelRegistry({
      configured: { provider: "configured-provider" },
      models,
    });

    const explicitModel = await registry.resolve({
      provider: "explicit-provider",
      model: "explicit-model",
    });
    const configuredModel = await registry.resolve();

    expect([explicitModel.provider, explicitModel.id]).toEqual([
      "explicit-provider",
      "explicit-model",
    ]);
    expect([configuredModel.provider, configuredModel.id]).toEqual([
      "configured-provider",
      "configured-model",
    ]);
  });
});
