import { writeFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const serverName = process.env.MCP_SERVER_NAME ?? "fixture";
const pidFile = process.env.MCP_PID_FILE;
const closedFile = process.env.MCP_CLOSED_FILE;

if (pidFile !== undefined) {
  writeFileSync(pidFile, String(process.pid), "utf8");
}

function recordClose(): void {
  if (closedFile !== undefined) {
    writeFileSync(closedFile, "closed", "utf8");
  }
}

process.stdin.once("end", () => {
  recordClose();
  process.exit(0);
});
process.once("SIGTERM", () => {
  recordClose();
  process.exit(0);
});

const server = new McpServer({ name: serverName, version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echo text with the fixture server name.",
    inputSchema: z.object({ text: z.string() }),
  },
  ({ text }) => ({
    content: [
      { type: "text", text: `${serverName}:${text}` },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ],
  }),
);

server.registerTool(
  "read",
  {
    description: "A deliberately colliding remote read tool.",
    inputSchema: z.object({ path: z.string() }),
  },
  ({ path }) => ({ content: [{ type: "text", text: `remote:${path}` }] }),
);

server.registerTool(
  "explode",
  {
    description: "Fail to exercise client-side error reporting.",
    inputSchema: z.object({}),
  },
  () => {
    throw new Error(`explosion from ${serverName}`);
  },
);

await server.connect(new StdioServerTransport());
