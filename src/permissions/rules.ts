import { classifyShellCommand } from "./classifier.js";

export type PermissionAction = "allow" | "ask" | "deny";

export interface PermissionAssessment {
  action: PermissionAction;
  reason: string;
  family: string;
}

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

function shellFamily(command: string): string {
  const segments = command
    .split(/&&|\|\||[;&|\n]/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const families = segments.map((segment) => {
    const tokens = segment.match(/[^\s"']+|"[^"]*"|'[^']*'/gu) ?? [];
    const commandName = (tokens[0] ?? "unknown")
      .replace(/^.*[\\/]/u, "")
      .toLowerCase();
    const operation = tokens[1]?.replaceAll(/["']/gu, "").toLowerCase();
    return ["git", "npm", "npx"].includes(commandName) && operation !== undefined
      ? `${commandName} ${operation}`
      : commandName;
  });
  return `bash:${[...new Set(families)].join("+")}`;
}

export function assessPermission(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): PermissionAssessment {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return {
      action: "allow",
      reason: `${toolName} is a read-only workspace tool`,
      family: toolName,
    };
  }
  if (WRITE_TOOLS.has(toolName)) {
    return {
      action: "ask",
      reason: `${toolName} modifies workspace files`,
      family: toolName,
    };
  }
  if (toolName === "bash" && typeof input.command === "string") {
    const classification = classifyShellCommand(input.command);
    return {
      action:
        classification.risk === "safe"
          ? "allow"
          : classification.risk === "destructive"
            ? "deny"
            : "ask",
      reason: classification.reason,
      family: shellFamily(input.command),
    };
  }

  return {
    action: "ask",
    reason: `${toolName} has no automatic allow rule`,
    family: toolName,
  };
}
