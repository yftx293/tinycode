import { buildSystemPrompt } from "./agent/prompt.js";
import { TinyCodeRuntime } from "./agent/runtime.js";
import {
  ModelRegistry,
  type MockProviderOptions,
  type ModelRef,
} from "./model/registry.js";

export interface BootstrapHarnessOptions {
  projectRoot: string;
  model?: ModelRef;
  mock?: MockProviderOptions;
}

export interface TinyCodeHarness {
  runtime: TinyCodeRuntime;
  models: ModelRegistry;
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
  return { runtime, models };
}
