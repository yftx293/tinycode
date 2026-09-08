import { basename } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { resolveWorkspacePath } from "./paths.js";
import { walkTextFiles } from "./walk.js";

const findParameters = Type.Object(
  {
    pattern: Type.String({ minLength: 1 }),
    path: Type.Optional(Type.String({ minLength: 1 })),
    maxResults: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 10_000 }),
    ),
  },
  { additionalProperties: false },
);

export interface FindToolDetails {
  path: string;
  pattern: string;
  matches: string[];
  totalMatches: number;
  truncated: boolean;
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll("\\", "/");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character?.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&") ?? "";
    }
  }

  return new RegExp(`${source}$`, "u");
}

export function createFindTool(
  projectRoot: string,
): AgentTool<typeof findParameters, FindToolDetails> {
  return {
    name: "find",
    label: "Find files",
    description: "Find text files in the workspace using a glob pattern.",
    parameters: findParameters,
    execute: (_toolCallId, params, signal) =>
      Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const path = resolveWorkspacePath(projectRoot, params.path);
        const expression = globToRegExp(params.pattern);
        const hasDirectoryPattern = /[/\\]/u.test(params.pattern);
        const allMatches = walkTextFiles(projectRoot, path)
          .map((file) => file.relativePath.replaceAll("\\", "/"))
          .filter((relativePath) =>
            expression.test(
              hasDirectoryPattern ? relativePath : basename(relativePath),
            ),
          );
        const maxResults = params.maxResults ?? 200;
        const matches = allMatches.slice(0, maxResults);

        signal?.throwIfAborted();
        return {
          content: [{ type: "text" as const, text: matches.join("\n") }],
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
