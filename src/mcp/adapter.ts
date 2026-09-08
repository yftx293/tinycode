import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import type { McpClient } from "./client.js";

export interface McpToolDetails {
  server: string;
  tool: string;
  omittedContentTypes: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "unknown error";
}

export function createMcpTool(
  registeredName: string,
  definition: Tool,
  client: McpClient,
  onError: (message: string) => void,
): AgentTool {
  const parameters = Type.Unsafe<Record<string, unknown>>(
    definition.inputSchema,
  );
  return {
    name: registeredName,
    label: definition.title ?? `${client.serverName}: ${definition.name}`,
    description:
      definition.description ??
      `Call ${definition.name} on MCP server ${client.serverName}.`,
    parameters,
    execute: async (_toolCallId, input, signal) => {
      signal?.throwIfAborted();
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new Error(
          `MCP ${client.serverName}/${definition.name} requires object arguments`,
        );
      }
      try {
        const result = await client.callTool(
          definition.name,
          input as Record<string, unknown>,
          signal,
        );
        if (!("content" in result) || !Array.isArray(result.content)) {
          throw new Error("unsupported task-based MCP result");
        }
        const textContent: Array<{ type: "text"; text: string }> = [];
        const omittedContentTypes: string[] = [];
        for (const value of result.content as unknown[]) {
          const block =
            typeof value === "object" && value !== null
              ? (value as Record<string, unknown>)
              : {};
          const type = typeof block.type === "string" ? block.type : "unknown";
          if (type === "text" && typeof block.text === "string") {
            textContent.push({ type: "text", text: block.text });
          } else {
            omittedContentTypes.push(type);
            textContent.push({
              type: "text",
              text: `[Omitted non-text MCP content: ${type}]`,
            });
          }
        }
        if (result.isError === true) {
          const remoteMessage = textContent
            .map((block) => block.text)
            .join("\n")
            .trim();
          throw new Error(remoteMessage || "remote tool reported an error");
        }
        return {
          content: textContent,
          details: {
            server: client.serverName,
            tool: definition.name,
            omittedContentTypes,
          },
        };
      } catch (error) {
        const message = `MCP ${client.serverName}/${definition.name} failed: ${errorMessage(error)}`;
        onError(message);
        throw new Error(message, { cause: error });
      }
    },
  };
}
