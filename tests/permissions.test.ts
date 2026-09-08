import { describe, expect, it } from "vitest";

import { classifyShellCommand } from "../src/permissions/classifier.js";
import { PermissionManager } from "../src/permissions/manager.js";

describe("classifyShellCommand", () => {
  it.each([
    ["pwd", "safe"],
    ["git status && npm test", "safe"],
    ["touch notes.txt", "write"],
    ["echo hello > notes.txt", "write"],
    ["git status && npm install", "write"],
    ["pwd & touch background.txt", "write"],
    ["echo ready && rm -rf /", "destructive"],
  ] as const)("classifies %s as %s", (command, expected) => {
    expect(classifyShellCommand(command).risk).toBe(expected);
  });
});

describe("PermissionManager", () => {
  it("allows read-only tools and safely denies headless approval requests", async () => {
    const permissions = new PermissionManager();

    await expect(permissions.check("read", { path: "notes.txt" })).resolves.toEqual({
      action: "allow",
      reason: "read is a read-only workspace tool",
    });
    const writeDecision = await permissions.check("write", {
      path: "notes.txt",
      content: "changed",
    });
    expect(writeDecision.action).toBe("deny");
    expect(writeDecision.reason).toContain("no approval prompt");
    const unknownDecision = await permissions.check("custom_tool", {});
    expect(unknownDecision.action).toBe("deny");
    expect(unknownDecision.reason).toContain("no approval prompt");
  });

  it("applies a once approval only to the current check", async () => {
    const permissions = new PermissionManager();
    let promptCount = 0;
    permissions.setPrompt(() => {
      promptCount += 1;
      return "once";
    });

    await expect(permissions.check("write", { path: "one.txt" })).resolves.toMatchObject({
      action: "allow",
    });
    await expect(permissions.check("write", { path: "two.txt" })).resolves.toMatchObject({
      action: "allow",
    });
    expect(promptCount).toBe(2);
  });

  it("remembers always approval by command family for this manager only", async () => {
    const permissions = new PermissionManager();
    const outcomes = ["always", "deny"] as const;
    let promptCount = 0;
    permissions.setPrompt(() => outcomes[promptCount++] ?? "deny");

    await expect(
      permissions.check("bash", { command: "npm install first-package" }),
    ).resolves.toMatchObject({ action: "allow" });
    await expect(
      permissions.check("bash", { command: "npm install second-package" }),
    ).resolves.toMatchObject({ action: "allow" });
    await expect(
      permissions.check("bash", { command: "git add notes.txt" }),
    ).resolves.toMatchObject({ action: "deny" });
    expect(promptCount).toBe(2);

    const separateManager = new PermissionManager();
    await expect(
      separateManager.check("bash", { command: "npm install third-package" }),
    ).resolves.toMatchObject({ action: "deny" });
  });

  it("auto-approves ordinary writes without overriding hard denial", async () => {
    const permissions = new PermissionManager();
    permissions.setMode("auto");

    await expect(
      permissions.check("write", { path: "generated.txt", content: "ok" }),
    ).resolves.toMatchObject({ action: "allow" });
    await expect(
      permissions.check("bash", { command: "npm install package-name" }),
    ).resolves.toMatchObject({ action: "allow" });
    const hardDenial = await permissions.check("bash", {
      command: "echo ready && rm -rf /",
    });
    expect(hardDenial.action).toBe("deny");
    expect(hardDenial.reason).toContain("unrecoverable");
  });
});
