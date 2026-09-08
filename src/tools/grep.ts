import { readFileSync } from "node:fs";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { resolveWorkspacePath } from "./paths.js";
import { walkTextFiles } from "./walk.js";

const grepParameters = Type.Object(
  {
    pattern: Type.String({ minLength: 1 }),
    path: Type.Optional(Type.String({ minLength: 1 })),
    caseSensitive: Type.Optional(Type.Boolean()),
    maxResults: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 10_000 }),
    ),
  },
  { additionalProperties: false },
);

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepToolDetails {
  path: string;
  pattern: string;
  matches: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
}

export function createGrepTool(
  projectRoot: string,
): AgentTool<typeof grepParameters, GrepToolDetails> {
  return {
    name: "grep",
    label: "Search text",
    description: "Search UTF-8 workspace files with a regular expression.",
    parameters: grepParameters,
    execute: (_toolCallId, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const path = resolveWorkspacePath(projectRoot, params.path);
        let expression: RegExp;
        try {
          expression = new RegExp(
            params.pattern,
            params.caseSensitive === false ? "iu" : "u",
          );
        } catch {
          throw new Error(`Invalid search pattern: ${params.pattern}`);
        }

        const allMatches: GrepMatch[] = [];
        for (const file of walkTextFiles(projectRoot, path)) {
          signal?.throwIfAborted();
          const relativePath = file.relativePath.replaceAll("\\", "/");
          const lines = readFileSync(file.path, "utf8")
            .replaceAll("\r\n", "\n")
            .split("\n");
          for (const [index, text] of lines.entries()) {
            if (expression.test(text)) {
              allMatches.push({ path: relativePath, line: index + 1, text });
            }
          }
        }

        const maxResults = params.maxResults ?? 200;
        const matches = allMatches.slice(0, maxResults);
        const text = matches
          .map((match) => `${match.path}:${String(match.line)}:${match.text}`)
          .join("\n");

        return {
          content: [{ type: "text" as const, text }],
          details: {
            path,
            pattern: params.pattern,
            matches,
            totalMatches: allMatches.length,
            truncated: matches.length < allMatches.length,
          },
        };
      }),
  };
}
