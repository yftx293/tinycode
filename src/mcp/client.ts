import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface StdioMcpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class McpClient {
  private constructor(
    readonly serverName: string,
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
    readonly tools: Tool[],
  ) {}

  static async connect(
    serverName: string,
    config: StdioMcpServerConfig,
    cwd: string,
  ): Promise<McpClient> {
    const client = new Client({ name: `tinycode-${serverName}`, version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
      cwd,
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      return new McpClient(serverName, client, transport, listed.tools);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async callTool(
    name: string,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return this.client.callTool(
      { name, arguments: parameters },
      undefined,
      signal === undefined ? undefined : { signal },
    );
  }

  get pid(): number | null {
    return this.transport.pid;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
