export type ShellRisk = "safe" | "write" | "destructive";

export interface ShellClassification {
  risk: ShellRisk;
  segments: string[];
  reason: string;
}

const SAFE_COMMANDS = new Set([
  "cat",
  "dir",
  "echo",
  "find",
  "get-childitem",
  "get-content",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "select-string",
  "tail",
  "type",
  "wc",
]);

const WRITE_COMMANDS = new Set([
  "copy",
  "cp",
  "del",
  "mkdir",
  "move",
  "mv",
  "new-item",
  "remove-item",
  "ren",
  "rename-item",
  "rm",
  "rmdir",
  "set-content",
  "touch",
]);

function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) {
      continue;
    }
    if (quote !== undefined) {
      current += character;
      if (character === quote && command[index - 1] !== "\\") {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }

    const pair = command.slice(index, index + 2);
    if (pair === "&&" || pair === "||") {
      if (current.trim().length > 0) {
        segments.push(current.trim());
      }
      current = "";
      index += 1;
    } else if (
      character === ";" ||
      character === "|" ||
      character === "&" ||
      character === "\n"
    ) {
      if (current.trim().length > 0) {
        segments.push(current.trim());
      }
      current = "";
    } else {
      current += character;
    }
  }

  if (current.trim().length > 0) {
    segments.push(current.trim());
  }
  return segments;
}

function words(segment: string): string[] {
  return segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu) ?? [];
}

function normalizedCommandName(tokens: readonly string[]): string {
  let index = 0;
  while (
    tokens[index]?.includes("=") === true ||
    ["command", "env", "sudo"].includes(tokens[index]?.toLowerCase() ?? "")
  ) {
    index += 1;
  }
  const token = tokens[index] ?? "";
  return token.replace(/^.*[\\/]/u, "").toLowerCase();
}

function isHardDestructive(segment: string): boolean {
  const lower = segment.toLowerCase();
  const inspectionTokens = lower
    .replaceAll(/["'`();]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
  if (inspectionTokens.length === 0) {
    return false;
  }

  for (let index = 0; index < inspectionTokens.length; index += 1) {
    const token = inspectionTokens[index] ?? "";
    const command = token.replace(/^.*[\\/]/u, "");
    const remaining = inspectionTokens.slice(index + 1);

    if (/^mkfs(?:\.|$)/u.test(command)) {
      return true;
    }
    if (
      command === "dd" &&
      remaining.some((argument) =>
        /^of=\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|disk\d+|rdisk\d+)$/u.test(
          argument,
        ),
      )
    ) {
      return true;
    }
    if (
      command === "format" &&
      remaining.some((argument) => /^[a-z]:[\\/]?$/iu.test(argument))
    ) {
      return true;
    }
    if (command !== "rm") {
      continue;
    }

    const hasRecursive = remaining.some(
      (argument) =>
        argument === "--recursive" || /^-[a-z]*r[a-z]*$/u.test(argument),
    );
    const hasForce = remaining.some(
      (argument) =>
        argument === "--force" || /^-[a-z]*f[a-z]*$/u.test(argument),
    );
    const targetsBroadLocation = remaining.some((argument) =>
      /^(?:\/{1,2}|\/\*|~\/?(?:\*)?|\$home\/?(?:\*)?|\$\{home\}\/?(?:\*)?|%userprofile%[\\/]?(?:\*)?|[a-z]:[\\/]?(?:\*)?)$/iu.test(
        argument,
      ),
    );
    if (hasRecursive && hasForce && targetsBroadLocation) {
      return true;
    }
  }

  return false;
}

function segmentRisk(segment: string): ShellRisk {
  const tokens = words(segment);
  if (isHardDestructive(segment)) {
    return "destructive";
  }
  if (/(^|[^>])>(?!>)/u.test(segment) || />>/u.test(segment)) {
    return "write";
  }

  const command = normalizedCommandName(tokens);
  if (SAFE_COMMANDS.has(command)) {
    return "safe";
  }
  if (WRITE_COMMANDS.has(command)) {
    return "write";
  }
  if (command === "git") {
    const operation = tokens[1]?.toLowerCase();
    return ["diff", "log", "show", "status"].includes(operation ?? "")
      ? "safe"
      : "write";
  }
  if (command === "npm") {
    const operation = tokens[1]?.toLowerCase();
    if (operation === "test") {
      return "safe";
    }
    if (operation === "run" && tokens[2]?.toLowerCase() === "test") {
      return "safe";
    }
    return "write";
  }

  return "write";
}

export function classifyShellCommand(command: string): ShellClassification {
  const segments = splitSegments(command);
  let risk: ShellRisk = "safe";
  for (const segment of segments) {
    const candidate = segmentRisk(segment);
    if (candidate === "destructive") {
      risk = "destructive";
      break;
    }
    if (candidate === "write") {
      risk = "write";
    }
  }

  return {
    risk,
    segments,
    reason:
      risk === "safe"
        ? "Shell command is read-only"
        : risk === "write"
          ? "Shell command may modify state"
          : "Shell command can cause unrecoverable system-wide damage",
  };
}
