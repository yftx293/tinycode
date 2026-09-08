import { readFileSync, writeFileSync } from "node:fs";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { calculateLineChanges, createUnifiedDiff } from "./diff.js";
import { resolveWorkspacePath } from "./paths.js";

const editParameters = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    oldText: Type.String({ minLength: 1 }),
    newText: Type.String(),
    replaceAll: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export interface EditToolDetails {
  path: string;
  replacements: number;
  additions: number;
  deletions: number;
  diff: string;
}

function countExactMatches(text: string, search: string): number {
  let count = 0;
  let offset = 0;

  while (offset <= text.length - search.length) {
    const match = text.indexOf(search, offset);
    if (match === -1) {
      break;
    }
    count += 1;
    offset = match + search.length;
  }

  return count;
}

export function createEditTool(
  projectRoot: string,
): AgentTool<typeof editParameters, EditToolDetails> {
  return {
    name: "edit",
    label: "Edit file",
    description: "Replace exact text in a UTF-8 workspace file.",
    parameters: editParameters,
    execute: (_toolCallId, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const path = resolveWorkspacePath(projectRoot, params.path);
        const previous = readFileSync(path, "utf8");
        const matches = countExactMatches(previous, params.oldText);
        if (matches === 0) {
          throw new Error(`No exact match found in ${params.path}`);
        }
        if (matches > 1 && params.replaceAll !== true) {
          throw new Error(
            `Exact text matched ${String(matches)} times; set replaceAll to replace every match`,
          );
        }
        const next =
          params.replaceAll === true
            ? previous.replaceAll(params.oldText, params.newText)
            : previous.replace(params.oldText, params.newText);
        const changes = calculateLineChanges(previous, next);
        const diff = createUnifiedDiff(params.path, previous, next);

        writeFileSync(path, next, "utf8");
        signal?.throwIfAborted();

        return {
          content: [{ type: "text" as const, text: diff }],
          details: {
            path,
            replacements: params.replaceAll === true ? matches : 1,
            ...changes,
            diff,
          },
        };
      }),
  };
}
