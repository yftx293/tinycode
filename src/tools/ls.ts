import { statSync } from "node:fs";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { resolveWorkspacePath } from "./paths.js";
import { visibleDirectoryEntries } from "./walk.js";

const lsParameters = Type.Object(
  {
    path: Type.Optional(Type.String({ minLength: 1 })),
    maxResults: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 10_000 }),
    ),
  },
  { additionalProperties: false },
);

export interface LsToolDetails {
  path: string;
  entries: string[];
  totalEntries: number;
  truncated: boolean;
}

export function createLsTool(
  projectRoot: string,
): AgentTool<typeof lsParameters, LsToolDetails> {
  return {
    name: "ls",
    label: "List directory",
    description: "List non-binary entries in a workspace directory.",
    parameters: lsParameters,
    execute: (_toolCallId, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const path = resolveWorkspacePath(projectRoot, params.path);
        if (!statSync(path).isDirectory()) {
          throw new Error(`Cannot list a non-directory: ${params.path ?? "."}`);
        }
        const allEntries = visibleDirectoryEntries(path).map((entry) =>
          entry.isDirectory() ? `${entry.name}/` : entry.name,
        );
        const maxResults = params.maxResults ?? 500;
        const entries = allEntries.slice(0, maxResults);

        signal?.throwIfAborted();
        return {
          content: [{ type: "text" as const, text: entries.join("\n") }],
          details: {
            path,
            entries,
            totalEntries: allEntries.length,
            truncated: entries.length < allEntries.length,
          },
        };
      }),
  };
}
