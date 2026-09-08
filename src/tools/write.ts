import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { calculateLineChanges } from "./diff.js";
import { resolveWorkspacePath } from "./paths.js";

const writeParameters = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    content: Type.String(),
  },
  { additionalProperties: false },
);

export interface WriteToolDetails {
  path: string;
  created: boolean;
  additions: number;
  deletions: number;
}

export function createWriteTool(
  projectRoot: string,
): AgentTool<typeof writeParameters, WriteToolDetails> {
  return {
    name: "write",
    label: "Write file",
    description: "Create or replace a UTF-8 text file inside the workspace.",
    parameters: writeParameters,
    execute: (_toolCallId, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const path = resolveWorkspacePath(projectRoot, params.path);
        const created = !existsSync(path);
        const previous = created ? "" : readFileSync(path, "utf8");
        const changes = calculateLineChanges(previous, params.content);

        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, params.content, "utf8");
        signal?.throwIfAborted();

        return {
          content: [
            {
              type: "text" as const,
              text: `Wrote ${params.path} (+${String(changes.additions)} -${String(changes.deletions)})`,
            },
          ],
          details: { path, created, ...changes },
        };
      }),
  };
}
