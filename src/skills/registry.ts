import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
  path: string;
}

export interface LoadSkillDetails {
  name: string;
  path: string;
}

const loadSkillParameters = Type.Object(
  { name: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export class SkillRegistry {
  private readonly skills: Map<string, SkillDefinition>;

  constructor(skills: Iterable<SkillDefinition> = []) {
    this.skills = new Map(
      [...skills]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((skill) => [skill.name, skill]),
    );
  }

  names(): string[] {
    return [...this.skills.keys()];
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  promptSection(): string {
    if (this.skills.size === 0) {
      return "";
    }
    const entries = [...this.skills.values()].map(
      (skill) =>
        `- ${skill.name}${skill.description.length > 0 ? `: ${skill.description}` : ""}`,
    );
    return [
      "## Available skills",
      "Load a skill with load_skill(name) only when its instructions are needed.",
      ...entries,
    ].join("\n");
  }

  createLoadTool(): AgentTool<typeof loadSkillParameters, LoadSkillDetails> {
    return {
      name: "load_skill",
      label: "Load skill",
      description: "Load the full instructions for an available skill by name.",
      parameters: loadSkillParameters,
      execute: (_toolCallId, parameters, signal) => {
        signal?.throwIfAborted();
        const skill = this.skills.get(parameters.name);
        if (skill === undefined) {
          throw new Error(`Unknown skill: ${parameters.name}`);
        }
        return Promise.resolve({
          content: [{ type: "text" as const, text: skill.body }],
          details: { name: skill.name, path: skill.path },
        });
      },
    };
  }
}
