import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

import type { WorkerReport } from "./types.js";
import { Worker } from "./worker.js";

export interface SubAgentManagerOptions {
  projectRoot: string;
  model: Model<Api>;
  streamFn: StreamFn;
  toolResultMaxChars?: number;
}

const SAFE_WORKER_NAME = /^[a-z0-9_-]+$/iu;

export class SubAgentManager {
  private readonly workers = new Map<string, Worker>();
  private readonly names = new Map<string, string>();

  constructor(private readonly options: SubAgentManagerOptions) {}

  spawn(name: string, task: string): WorkerReport {
    if (!SAFE_WORKER_NAME.test(name)) {
      throw new Error(
        "Worker name may contain only letters, numbers, underscores, and hyphens",
      );
    }
    if (this.names.has(name)) {
      throw new Error(`Worker name already exists: ${name}`);
    }
    const running = [...this.workers.values()].filter(
      (worker) => worker.snapshot().status === "running",
    ).length;
    if (running >= 3) {
      throw new Error("At most 3 workers may run concurrently");
    }

    const worker = new Worker({
      name,
      task,
      projectRoot: this.options.projectRoot,
      model: this.options.model,
      streamFn: this.options.streamFn,
      ...(this.options.toolResultMaxChars === undefined
        ? {}
        : { toolResultMaxChars: this.options.toolResultMaxChars }),
    });
    this.workers.set(worker.id, worker);
    this.names.set(name, worker.id);
    worker.start();
    return worker.snapshot();
  }

  async wait(idOrName?: string): Promise<WorkerReport[]> {
    const workers =
      idOrName === undefined
        ? [...this.workers.values()]
        : [this.resolve(idOrName)];
    return Promise.all(workers.map((worker) => worker.wait()));
  }

  close(idOrName: string): WorkerReport {
    return this.resolve(idOrName).close();
  }

  reports(): WorkerReport[] {
    return [...this.workers.values()].map((worker) => worker.snapshot());
  }

  async shutdown(): Promise<void> {
    const workers = [...this.workers.values()];
    for (const worker of workers) {
      worker.close();
    }
    await Promise.all(workers.map((worker) => worker.wait()));
  }

  private resolve(idOrName: string): Worker {
    const id = this.names.get(idOrName) ?? idOrName;
    const worker = this.workers.get(id);
    if (worker === undefined) {
      throw new Error(`Worker not found: ${idOrName}`);
    }
    return worker;
  }
}
