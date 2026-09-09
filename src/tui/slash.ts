export interface SlashCommandDefinition {
  name: string;
  usage: string;
  description: string;
}

export const slashCommands: readonly SlashCommandDefinition[] = [
  { name: "help", usage: "/help", description: "Show command help" },
  { name: "new", usage: "/new", description: "Start a new session" },
  { name: "clear", usage: "/clear", description: "Clear live context" },
  { name: "resume", usage: "/resume <id>", description: "Resume a session" },
  { name: "sessions", usage: "/sessions", description: "List project sessions" },
  { name: "model", usage: "/model [provider/model]", description: "Show or switch model" },
  { name: "settings", usage: "/settings", description: "打开设置面板" },
  { name: "skills", usage: "/skills", description: "List skills" },
  { name: "mcp", usage: "/mcp", description: "Show MCP server status" },
  { name: "agents", usage: "/agents", description: "Show worker status" },
  { name: "compact", usage: "/compact", description: "Compact live context" },
  { name: "status", usage: "/status", description: "Show runtime status" },
  { name: "exit", usage: "/exit", description: "Exit TinyCode" },
];

export interface ParsedSlashCommand {
  name: string;
  argument: string;
}

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const separator = trimmed.indexOf(" ");
  return separator === -1
    ? { name: trimmed.slice(1), argument: "" }
    : {
        name: trimmed.slice(1, separator),
        argument: trimmed.slice(separator + 1).trim(),
      };
}

export function slashHelp(): string {
  return slashCommands
    .map((command) => `${command.usage.padEnd(28)} ${command.description}`)
    .join("\n");
}
