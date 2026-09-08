import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import type { SubAgentManager } from "./manager.js";
import type { WorkerReport } from "./types.js";

const spawnParameters = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    task: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const noParameters = Type.Object({}, { additionalProperties: false });
const optionalTargetParameters = Type.Object(
  { idOrName: Type.Optional(Type.String({ minLength: 1 })) },
  { additionalProperties: false },
);
const targetParameters = Type.Object(
  { idOrName: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

function text(report: WorkerReport | WorkerReport[]): string {
  return JSON.stringify(report, null, 2);
}

export function createSubAgentTools(manager: SubAgentManager): AgentTool[] {
  const spawn: AgentTool<typeof spawnParameters, WorkerReport> = {
    name: "spawn_agent",
    label: "Spawn read-only worker",
    description: "Start a read-only research worker and return immediately.",
    parameters: spawnParameters,
    execute: (_toolCallId, parameters, signal) => {
      signal?.throwIfAborted();
      const report = manager.spawn(parameters.name, parameters.task);
      return Promise.resolve({
        content: [{ type: "text", text: text(report) }],
        details: report,
      });
    },
  };
  const list: AgentTool<typeof noParameters, WorkerReport[]> = {
    name: "list_agents",
    label: "List workers",
    description: "List all read-only workers and their current status.",
    parameters: noParameters,
    execute: (_toolCallId, _parameters, signal) => {
      signal?.throwIfAborted();
      const reports = manager.reports();
      return Promise.resolve({
        content: [{ type: "text", text: text(reports) }],
        details: reports,
      });
    },
  };
  const wait: AgentTool<typeof optionalTargetParameters, WorkerReport[]> = {
    name: "wait_agent",
    label: "Wait for workers",
    description: "Wait for one worker by id/name, or for all workers.",
    parameters: optionalTargetParameters,
    execute: async (_toolCallId, parameters, signal) => {
      signal?.throwIfAborted();
      const reports = await manager.wait(parameters.idOrName);
      signal?.throwIfAborted();
      return {
        content: [{ type: "text", text: text(reports) }],
        details: reports,
      };
    },
  };
  const close: AgentTool<typeof targetParameters, WorkerReport> = {
    name: "close_agent",
    label: "Close worker",
    description: "Abort a running worker by id or name.",
    parameters: targetParameters,
    execute: (_toolCallId, parameters, signal) => {
      signal?.throwIfAborted();
      const report = manager.close(parameters.idOrName);
      return Promise.resolve({
        content: [{ type: "text", text: text(report) }],
        details: report,
      });
    },
  };
  return [spawn, list, wait, close];
}
