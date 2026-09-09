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
import { loadSkills } from "./skills/loader.js";
import type { SkillRegistry } from "./skills/registry.js";
import { McpManager } from "./mcp/manager.js";
import type { StdioMcpServerConfig } from "./mcp/client.js";
import { SubAgentManager } from "./agents/manager.js";
import { createSubAgentTools } from "./agents/tools.js";

export interface BootstrapSubAgentOptions {
  toolResultMaxChars?: number;
}

export interface BootstrapSessionOptions {
  directory: string;
  id?: string;
  continue?: boolean;
}

export interface BootstrapSkillOptions {
  homeDirectory?: string;
}

export interface BootstrapHarnessOptions {
  projectRoot: string;
  model?: ModelRef;
  mock?: MockProviderOptions;
  session?: BootstrapSessionOptions;
  context?: Omit<ContextManagerOptions, "session">;
  skills?: BootstrapSkillOptions;
  mcpServers?: Record<string, StdioMcpServerConfig>;
  subAgents?: BootstrapSubAgentOptions;
  maxOutputTokens?: number;
}

export interface TinyCodeHarness {
  runtime: TinyCodeRuntime;
  models: ModelRegistry;
  tools: ToolRegistry;
  session: SessionManager | undefined;
  context: ContextManager;
  skills: SkillRegistry;
  mcp: McpManager;
  agents: SubAgentManager | undefined;
  shutdown(): Promise<void>;
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
  const skills = loadSkills({
    projectRoot: options.projectRoot,
    ...(options.skills?.homeDirectory === undefined
      ? {}
      : { homeDirectory: options.skills.homeDirectory }),
  });
  const skillPrompt = skills.promptSection();
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools(options.projectRoot)) {
    tools.register(tool);
  }
  tools.register(skills.createLoadTool());
  const agents =
    options.subAgents === undefined
      ? undefined
      : new SubAgentManager({
          projectRoot: options.projectRoot,
          model,
          streamFn: models.streamFn,
          ...(options.subAgents.toolResultMaxChars === undefined
            ? {}
            : { toolResultMaxChars: options.subAgents.toolResultMaxChars }),
        });
  if (agents !== undefined) {
    for (const tool of createSubAgentTools(agents)) {
      tools.register(tool);
    }
  }
  const mcp = await McpManager.connect({
    cwd: options.projectRoot,
    ...(options.mcpServers === undefined
      ? {}
      : { servers: options.mcpServers }),
  });
  for (const tool of mcp.createTools(tools.names())) {
    tools.register(tool);
  }
  const runtime = new TinyCodeRuntime({
    model,
    streamFn: models.streamFn,
    systemPrompt: [buildSystemPrompt(options.projectRoot), skillPrompt]
      .filter((section) => section.length > 0)
      .join("\n\n"),
    ...(session === undefined ? {} : { sessionManager: session }),
    contextManager: context,
    ...(options.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: options.maxOutputTokens }),
  });
  runtime.agent.state.tools = tools.list();

  return {
    runtime,
    models,
    tools,
    session,
    context,
    skills,
    mcp,
    agents,
    shutdown: async () => {
      await Promise.all([
        mcp.shutdown(),
        agents?.shutdown() ?? Promise.resolve(),
      ]);
    },
  };
}
