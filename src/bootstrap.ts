import { buildSystemPrompt } from "./agent/prompt.js";
import { TinyCodeRuntime } from "./agent/runtime.js";
import {
  ModelRegistry,
  type MockProviderOptions,
  type ModelRef,
} from "./model/registry.js";
import { createBuiltinTools } from "./tools/index.js";
import { ToolRegistry } from "./tools/registry.js";
import { SessionManager } from "./session/manager.js";
import { SessionStorage } from "./session/storage.js";
import { ContextManager, type ContextManagerOptions } from "./context/manager.js";

export interface BootstrapSessionOptions {
  directory: string;
  id?: string;
  continue?: boolean;
}

export interface BootstrapHarnessOptions {
  projectRoot: string;
  model?: ModelRef;
  mock?: MockProviderOptions;
  session?: BootstrapSessionOptions;
  context?: Omit<ContextManagerOptions, "session">;
}

export interface TinyCodeHarness {
  runtime: TinyCodeRuntime;
  models: ModelRegistry;
  tools: ToolRegistry;
  session: SessionManager | undefined;
  context: ContextManager;
}

export async function bootstrapHarness(
  options: BootstrapHarnessOptions,
): Promise<TinyCodeHarness> {
  const models = new ModelRegistry({ configured: options.model });
  const model =
    options.mock === undefined
      ? await models.resolve()
      : models.enableMock(options.mock);
  const session =
    options.session === undefined
      ? undefined
      : SessionManager.open({
          storage: new SessionStorage(options.session.directory),
          cwd: options.projectRoot,
          ...(options.session.id === undefined ? {} : { id: options.session.id }),
          ...(options.session.continue === undefined
            ? {}
            : { continue: options.session.continue }),
        });
  const context = new ContextManager({
    ...options.context,
    ...(session === undefined ? {} : { session }),
  });
  const runtime = new TinyCodeRuntime({
    model,
    streamFn: models.streamFn,
    systemPrompt: buildSystemPrompt(options.projectRoot),
    ...(session === undefined ? {} : { sessionManager: session }),
    contextManager: context,
  });
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools(options.projectRoot)) {
    tools.register(tool);
  }
  runtime.agent.state.tools = tools.list();

  return { runtime, models, tools, session, context };
}
