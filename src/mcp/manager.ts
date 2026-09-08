import type { AgentTool } from "@earendil-works/pi-agent-core";

import { createMcpTool } from "./adapter.js";
import { McpClient, type StdioMcpServerConfig } from "./client.js";

export type McpServerState = "connecting" | "connected" | "error" | "closed";

export interface McpServerStatus {
  name: string;
  state: McpServerState;
  error?: string;
}

export interface ConnectMcpOptions {
  servers?: Record<string, StdioMcpServerConfig>;
  cwd: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "unknown error";
}

export class McpManager {
  private readonly clients = new Map<string, McpClient>();
  private readonly serverStatuses = new Map<string, McpServerStatus>();

  static async connect(options: ConnectMcpOptions): Promise<McpManager> {
    const manager = new McpManager();
    const entries = Object.entries(options.servers ?? {});
    for (const [name] of entries) {
      manager.serverStatuses.set(name, { name, state: "connecting" });
    }

    const results = await Promise.all(
      entries.map(async ([name, config]) => {
        try {
          const client = await McpClient.connect(name, config, options.cwd);
          return { name, client } as const;
        } catch (error) {
          return { name, error } as const;
        }
      }),
    );
    for (const result of results) {
      if ("client" in result) {
        manager.clients.set(result.name, result.client);
        manager.serverStatuses.set(result.name, {
          name: result.name,
          state: "connected",
        });
      } else {
        manager.serverStatuses.set(result.name, {
          name: result.name,
          state: "error",
          error: `MCP ${result.name} connection failed: ${errorMessage(result.error)}`,
        });
      }
    }
    return manager;
  }

  status(name: string): McpServerStatus | undefined {
    const status = this.serverStatuses.get(name);
    return status === undefined ? undefined : { ...status };
  }

  statuses(): McpServerStatus[] {
    return [...this.serverStatuses.values()].map((status) => ({ ...status }));
  }

  createTools(existingNames: readonly string[]): AgentTool[] {
    const existing = new Set(existingNames);
    const definitions = [...this.clients.entries()].flatMap(([server, client]) =>
      client.tools
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((tool) => ({ server, client, tool })),
    );
    const counts = new Map<string, number>();
    for (const { tool } of definitions) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    }

    return definitions.map(({ server, client, tool }) => {
      const registeredName =
        existing.has(tool.name) || (counts.get(tool.name) ?? 0) > 1
          ? `${server}_${tool.name}`
          : tool.name;
      return createMcpTool(registeredName, tool, client, (message) => {
        this.serverStatuses.set(server, {
          name: server,
          state: "error",
          error: message,
        });
      });
    });
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.clients.entries()].map(async ([name, client]) => {
        try {
          await client.close();
          this.serverStatuses.set(name, { name, state: "closed" });
        } catch (error) {
          this.serverStatuses.set(name, {
            name,
            state: "error",
            error: `MCP ${name} close failed: ${errorMessage(error)}`,
          });
        }
      }),
    );
    this.clients.clear();
  }
}
