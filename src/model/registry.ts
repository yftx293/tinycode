import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type FauxProviderHandle,
  type FauxResponseStep,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

export interface ModelRef {
  provider?: string;
  model?: string;
}

export type ScriptedMockResponse = string | FauxResponseStep;

export interface MockProviderOptions {
  responses?: readonly ScriptedMockResponse[];
  tokensPerSecond?: number;
}

export interface ModelRegistryOptions {
  configured?: ModelRef | undefined;
  models?: MutableModels | undefined;
}

function toFauxResponse(response: ScriptedMockResponse): FauxResponseStep {
  return typeof response === "string"
    ? fauxAssistantMessage(response)
    : response;
}

export class ModelRegistry {
  readonly streamFn: StreamFn;

  private readonly models: MutableModels;
  private configured: ModelRef | undefined;
  private mock?: FauxProviderHandle;

  constructor(options: ModelRegistryOptions = {}) {
    this.models = options.models ?? builtinModels();
    this.configured = options.configured;
    this.streamFn = (model, context, streamOptions) =>
      this.models.streamSimple(model, context, streamOptions);
  }

  enableMock(options: MockProviderOptions = {}): Model<string> {
    if (this.mock !== undefined) {
      this.models.deleteProvider(this.mock.provider.id);
    }

    const providerOptions: Parameters<typeof fauxProvider>[0] = {
      provider: "mock",
      models: [{ id: "mock", name: "TinyCode Mock" }],
    };
    if (options.tokensPerSecond !== undefined) {
      providerOptions.tokensPerSecond = options.tokensPerSecond;
    }

    this.mock = fauxProvider(providerOptions);
    this.mock.setResponses((options.responses ?? []).map(toFauxResponse));
    this.models.setProvider(this.mock.provider);
    this.configured = { provider: "mock", model: "mock" };

    return this.mock.getModel();
  }

  setMockResponses(responses: readonly ScriptedMockResponse[]): void {
    if (this.mock === undefined) {
      throw new Error("Mock provider is not enabled");
    }
    this.mock.setResponses(responses.map(toFauxResponse));
  }

  async resolve(ref?: ModelRef): Promise<Model<Api>> {
    if (ref !== undefined && (ref.provider !== undefined || ref.model !== undefined)) {
      return this.resolveRef(ref, "explicit");
    }

    if (this.configured !== undefined) {
      return this.resolveRef(this.configured, "configured");
    }

    const available = await this.models.getAvailable();
    const first = available[0];
    if (first !== undefined) {
      return first;
    }

    throw new Error(
      "No model is configured; provide a model reference or enable the mock provider",
    );
  }

  private resolveRef(ref: ModelRef, source: "explicit" | "configured"): Model<Api> {
    let model: Model<Api> | undefined;

    if (ref.provider !== undefined && ref.model !== undefined) {
      model = this.models.getModel(ref.provider, ref.model);
    } else if (ref.provider !== undefined) {
      model = this.models.getModels(ref.provider)[0];
    } else if (ref.model !== undefined) {
      model = this.models
        .getModels()
        .find((candidate) => candidate.id === ref.model);
    }

    if (model === undefined) {
      const label = [ref.provider, ref.model].filter(Boolean).join("/");
      throw new Error(`Unknown ${source} model reference: ${label}`);
    }

    return model;
  }
}
