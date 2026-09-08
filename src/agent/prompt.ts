import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export function buildSystemPrompt(projectRoot: string): string {
  const prompt = [
    "You are TinyCode, a focused coding agent.",
    `Project root: ${resolve(projectRoot)}`,
    "Understand the request and inspect relevant project context before acting.",
    "Use only the tools provided by the harness, and report tool failures clearly.",
    "Make the smallest coherent change that completes the task.",
  ];

  for (const fileName of ["TINY.md", "AGENTS.md", "CLAUDE.md"]) {
    const path = join(projectRoot, fileName);
    if (!existsSync(path) || !statSync(path).isFile()) {
      continue;
    }
    const content = readFileSync(path, "utf8").trim();
    if (content.length > 0) {
      prompt.push("", `## Project memory: ${fileName}`, content);
    }
  }

  return prompt.join("\n");
}
