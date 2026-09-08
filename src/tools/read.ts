import { readFileSync, statSync } from "node:fs";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { resolveWorkspacePath } from "./paths.js";

const readParameters = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    offset: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export interface ReadToolDetails {
  path: string;
  offset: number;
  limit: number;
  totalLines: number;
  truncated: boolean;
}

function splitLines(text: string): string[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

export function createReadTool(
  projectRoot: string,
): AgentTool<typeof readParameters, ReadToolDetails> {
  return {
    name: "read",
    label: "Read file",
    description: "Read a UTF-8 text file from the workspace with line numbers.",
    parameters: readParameters,
    execute: (_toolCallId, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const path = resolveWorkspacePath(projectRoot, params.path);
        let stats;
        try {
          stats = statSync(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`File not found: ${params.path}`, { cause: error });
          }
          throw error;
        }
        if (stats.isDirectory()) {
          throw new Error(`Cannot read a directory: ${params.path}`);
        }

        const buffer = readFileSync(path);
        if (buffer.subarray(0, 8_192).includes(0)) {
          throw new Error(`Cannot read binary file: ${params.path}`);
        }
        const lines = splitLines(buffer.toString("utf8"));
        const offset = params.offset ?? 1;
        const limit = params.limit ?? 2_000;
        const selected = lines.slice(offset - 1, offset - 1 + limit);
        const text = selected
          .map((line, index) => `${String(offset + index)}: ${line}`)
          .join("\n");

        signal?.throwIfAborted();
        return {
          content: [{ type: "text" as const, text }],
          details: {
            path,
            offset,
            limit,
            totalLines: lines.length,
            truncated: offset > 1 || offset - 1 + selected.length < lines.length,
          },
        };
      }),
  };
}
