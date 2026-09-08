import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentText, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { bootstrapHarness } from "../src/bootstrap.js";
import { loadSkills } from "../src/skills/loader.js";

async function withWorkspace(
  run: (projectRoot: string, homeDirectory: string) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "tinycode-skills-"));
  const projectRoot = join(root, "project");
  const homeDirectory = join(root, "home");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(homeDirectory, { recursive: true });
  try {
    await run(projectRoot, homeDirectory);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeSkill(root: string, directoryName: string, source: string): void {
  const directory = join(root, directoryName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), source, "utf8");
}

describe("skill discovery", () => {
  it("loads direct global and project skills with project precedence", async () => {
    await withWorkspace((projectRoot, homeDirectory) => {
      const globalRoot = join(homeDirectory, ".tinycode", "skills");
      const projectSkills = join(projectRoot, ".tinycode", "skills");
      writeSkill(
        globalRoot,
        "shared",
        "---\nname: shared\ndescription: global description\n---\nGLOBAL BODY",
      );
      writeSkill(
        projectSkills,
        "shared",
        "---\ndescription: project description\n---\nPROJECT BODY",
      );
      writeSkill(
        projectSkills,
        "fallback-name",
        "---\ndescription: uses directory name\n---\nFALLBACK BODY",
      );
      writeSkill(projectSkills, "empty", "---\nname: empty\n---\n   \n");
      writeSkill(
        join(projectSkills, "container"),
        "nested",
        "---\nname: nested\n---\nNESTED BODY",
      );

      const skills = loadSkills({ projectRoot, homeDirectory });

      expect(skills.names()).toEqual(["fallback-name", "shared"]);
      expect(skills.get("shared")).toMatchObject({
        name: "shared",
        description: "project description",
        body: "PROJECT BODY",
      });
      expect(skills.get("fallback-name")?.name).toBe("fallback-name");
      expect(skills.get("empty")).toBeUndefined();
      expect(skills.get("nested")).toBeUndefined();
    });
  });

  it("exposes only metadata until load_skill is called", async () => {
    await withWorkspace(async (projectRoot, homeDirectory) => {
      const secretBody = "PRIVATE SKILL INSTRUCTIONS";
      writeSkill(
        join(projectRoot, ".tinycode", "skills"),
        "review",
        `---\nname: review\ndescription: Review source changes\n---\n${secretBody}`,
      );
      let initialInput = "";
      const harness = await bootstrapHarness({
        projectRoot,
        skills: { homeDirectory },
        mock: {
          responses: [
            (context) => {
              initialInput = JSON.stringify(context);
              return fauxAssistantMessage(
                [fauxToolCall("load_skill", { name: "review" })],
                { stopReason: "toolUse" },
              );
            },
            fauxAssistantMessage("loaded"),
          ],
        },
      });
      harness.runtime.permissions.setMode("auto");

      await harness.runtime.prompt("Use the review skill");

      expect(initialInput).toContain("review");
      expect(initialInput).toContain("Review source changes");
      expect(initialInput).not.toContain(secretBody);
      const result = harness.runtime.agent.state.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(result?.role).toBe("toolResult");
      if (result?.role !== "toolResult") {
        throw new Error("Expected load_skill tool result");
      }
      expect(contentText(result.content)).toBe(secretBody);
    });
  });
});
