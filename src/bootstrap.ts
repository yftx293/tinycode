import { buildSystemPrompt } from "./agent/prompt.js";
import { TinyCodeRuntime } from "./agent/runtime.js";
import {
  ModelRegistry,
  type MockProviderOptions,
  type ModelRef,
} from "./model/registry.js";
import { createBuiltinTools } from "./tools/index.js";
import { ToolRegistry } from "./tools/registry.js";

export interface BootstrapHarnessOptions {
  projectRoot: string;
  model?: ModelRef;
  mock?: MockProviderOptions;
}

export interface TinyCodeHarness {
  runtime: TinyCodeRuntime;
  models: ModelRegistry;
  tools: ToolRegistry;
}

export async function bootstrapHarness(
  options: BootstrapHarnessOptions,
): Promise<TinyCodeHarness> {
  const models = new ModelRegistry({ configured: options.model });
  const model =
    options.mock === undefined
      ? await models.resolve()
      : models.enableMock(options.mock);
  const runtime = new TinyCodeRuntime({
    model,
    streamFn: models.streamFn,
    systemPrompt: buildSystemPrompt(options.projectRoot),
  });
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools(options.projectRoot)) {
    tools.register(tool);
  }
  runtime.agent.state.tools = tools.list();

  return { runtime, models, tools };
}
