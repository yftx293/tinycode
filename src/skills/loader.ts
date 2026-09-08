import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { SkillRegistry, type SkillDefinition } from "./registry.js";

export interface LoadSkillsOptions {
  projectRoot: string;
  homeDirectory?: string;
}

interface ParsedSkill {
  name?: string;
  description?: string;
  body: string;
}

function parseSkillSource(source: string): ParsedSkill {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized.trim() };
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) {
    return { body: normalized.trim() };
  }

  const metadata = new Map<string, string>();
  for (const line of normalized.slice(4, closing).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    metadata.set(
      line.slice(0, separator).trim().toLowerCase(),
      line.slice(separator + 1).trim(),
    );
  }
  const name = metadata.get("name");
  const description = metadata.get("description");
  return {
    ...(name === undefined || name.length === 0 ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    body: normalized.slice(closing + "\n---\n".length).trim(),
  };
}

function scanRoot(root: string): SkillDefinition[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(root, entry.name, "SKILL.md");
      if (!existsSync(path) || !statSync(path).isFile()) {
        return [];
      }
      const parsed = parseSkillSource(readFileSync(path, "utf8"));
      if (parsed.body.length === 0) {
        return [];
      }
      return [
        {
          name: parsed.name ?? entry.name,
          description: parsed.description ?? "",
          body: parsed.body,
          path,
        },
      ];
    });
}

export function loadSkills(options: LoadSkillsOptions): SkillRegistry {
  const homeDirectory = options.homeDirectory ?? homedir();
  const merged = new Map<string, SkillDefinition>();
  for (const skill of scanRoot(join(homeDirectory, ".tinycode", "skills"))) {
    merged.set(skill.name, skill);
  }
  for (const skill of scanRoot(
    join(options.projectRoot, ".tinycode", "skills"),
  )) {
    merged.set(skill.name, skill);
  }
  return new SkillRegistry(merged.values());
}
