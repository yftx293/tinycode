import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AgentTool } from "@earendil-works/pi-agent-core";
import {
  contentText,
  fauxAssistantMessage,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { bootstrapHarness } from "../src/bootstrap.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createBashTool } from "../src/tools/bash.js";
import { createEditTool } from "../src/tools/edit.js";
import { createFindTool } from "../src/tools/find.js";
import { createGrepTool } from "../src/tools/grep.js";
import { createLsTool } from "../src/tools/ls.js";
import { createReadTool } from "../src/tools/read.js";
import { createWriteTool } from "../src/tools/write.js";

async function withWorkspace<T>(
  run: (workspace: string) => Promise<T> | T,
): Promise<T> {
  const workspace = mkdtempSync(join(tmpdir(), "tinycode-tools-"));
  try {
    return await run(workspace);
  } finally {
    rmSync(workspace, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

function stubTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `${name} test tool`,
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ content: [], details: {} }),
  };
}

describe("ToolRegistry", () => {
  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register(stubTool("read"));

    expect(() => {
      registry.register(stubTool("read"));
    }).toThrow("Tool already registered: read");
  });

  it("keeps registration order and returns a list copy", () => {
    const registry = new ToolRegistry();
    registry.register(stubTool("read"));
    registry.register(stubTool("write"));

    const listed = registry.list();
    listed.reverse();

    expect(registry.names()).toEqual(["read", "write"]);
    expect(registry.list().map((tool) => tool.name)).toEqual(["read", "write"]);
  });

  it("reports unknown tools without changing the registry", () => {
    const registry = new ToolRegistry();
    const read = stubTool("read");
    registry.register(read);

    expect(registry.get("read")).toBe(read);
    expect(registry.has("read")).toBe(true);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.has("missing")).toBe(false);
    expect(registry.names()).toEqual(["read"]);
  });
});

describe("built-in tool registration", () => {
  it("registers seven tools and lets the mock model execute read", async () => {
    await withWorkspace(async (workspace) => {
      writeFileSync(join(workspace, "message.txt"), "hello from a tool\n");
      const harness = await bootstrapHarness({
        projectRoot: workspace,
        mock: {
          responses: [
            fauxAssistantMessage(
              [fauxToolCall("read", { path: "message.txt" })],
              { stopReason: "toolUse" },
            ),
            fauxAssistantMessage("read complete"),
          ],
        },
      });

      expect(harness.tools.names().slice(0, 7)).toEqual([
        "read",
        "write",
        "edit",
        "bash",
        "grep",
        "find",
        "ls",
      ]);
      expect(harness.runtime.agent.state.tools.map((tool) => tool.name)).toEqual(
        harness.tools.names(),
      );

      await harness.runtime.prompt("Read message.txt");

      const toolResult = harness.runtime.agent.state.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(toolResult?.role).toBe("toolResult");
      if (toolResult?.role === "toolResult") {
        expect(toolResult.toolName).toBe("read");
        expect(contentText(toolResult.content)).toContain("1: hello from a tool");
      }
    });
  });
});

describe("read tool", () => {
  it("returns numbered lines selected by one-based offset and limit", async () => {
    await withWorkspace(async (workspace) => {
      writeFileSync(join(workspace, "notes.txt"), "one\ntwo\nthree\nfour\n");
      const read = createReadTool(workspace);

      const result = await read.execute(
        "read-1",
        { path: "notes.txt", offset: 2, limit: 2 },
        new AbortController().signal,
      );

      expect(result.content).toEqual([
        { type: "text", text: "2: two\n3: three" },
      ]);
      expect(result.details).toMatchObject({
        path: join(workspace, "notes.txt"),
        offset: 2,
        limit: 2,
        totalLines: 4,
        truncated: true,
      });
    });
  });

  it("reports friendly errors for missing, directory, and binary targets", async () => {
    await withWorkspace(async (workspace) => {
      mkdirSync(join(workspace, "folder"));
      writeFileSync(
        join(workspace, "binary.dat"),
        Buffer.from([0x74, 0x65, 0x78, 0x74, 0x00, 0xff]),
      );
      const read = createReadTool(workspace);

      await expect(read.execute("missing", { path: "missing.txt" })).rejects.toThrow(
        "File not found: missing.txt",
      );
      await expect(read.execute("directory", { path: "folder" })).rejects.toThrow(
        "Cannot read a directory: folder",
      );
      await expect(read.execute("binary", { path: "binary.dat" })).rejects.toThrow(
        "Cannot read binary file: binary.dat",
      );
    });
  });
});

describe("write tool", () => {
  it("creates parent directories and reports line changes", async () => {
    await withWorkspace(async (workspace) => {
      const write = createWriteTool(workspace);

      const created = await write.execute("write-1", {
        path: "nested/file.txt",
        content: "one\ntwo\n",
      });
      const overwritten = await write.execute("write-2", {
        path: "nested/file.txt",
        content: "one\nthree\nfour\n",
      });

      expect(created.details).toMatchObject({
        created: true,
        additions: 2,
        deletions: 0,
      });
      expect(overwritten.details).toMatchObject({
        created: false,
        additions: 2,
        deletions: 1,
      });
      const summary = overwritten.content[0];
      expect(summary?.type).toBe("text");
      if (summary?.type === "text") {
        expect(summary.text).toContain("Wrote nested/file.txt (+2 -1)");
      }
    });
  });
});

describe("edit tool", () => {
  it("replaces one exact match and returns a unified diff", async () => {
    await withWorkspace(async (workspace) => {
      writeFileSync(join(workspace, "code.ts"), "const value = 1;\n");
      const edit = createEditTool(workspace);

      const result = await edit.execute("edit-1", {
        path: "code.ts",
        oldText: "value = 1",
        newText: "value = 2",
      });

      expect(result.details).toMatchObject({
        replacements: 1,
        additions: 1,
        deletions: 1,
      });
      expect(result.details.diff).toContain("--- a/code.ts");
      expect(result.details.diff).toContain("+++ b/code.ts");
      expect(result.details.diff).toContain("-const value = 1;");
      expect(result.details.diff).toContain("+const value = 2;");
      expect(result.content).toEqual([
        { type: "text", text: result.details.diff },
      ]);
    });
  });

  it("rejects zero or ambiguous matches unless replaceAll is explicit", async () => {
    await withWorkspace(async (workspace) => {
      const file = join(workspace, "repeated.txt");
      writeFileSync(file, "same\nsame\n");
      const edit = createEditTool(workspace);

      await expect(
        edit.execute("zero", {
          path: "repeated.txt",
          oldText: "missing",
          newText: "new",
        }),
      ).rejects.toThrow("No exact match found");
      await expect(
        edit.execute("many", {
          path: "repeated.txt",
          oldText: "same",
          newText: "changed",
        }),
      ).rejects.toThrow("Exact text matched 2 times; set replaceAll to replace every match");
      expect(readFileSync(file, "utf8")).toBe("same\nsame\n");

      const result = await edit.execute("all", {
        path: "repeated.txt",
        oldText: "same",
        newText: "changed",
        replaceAll: true,
      });

      expect(result.details.replacements).toBe(2);
      expect(readFileSync(file, "utf8")).toBe("changed\nchanged\n");
    });
  });
});

describe("ls tool", () => {
  it("lists sorted workspace entries with ignores and a result limit", async () => {
    await withWorkspace(async (workspace) => {
      writeFileSync(join(workspace, "b.txt"), "b");
      writeFileSync(join(workspace, "a.txt"), "a");
      writeFileSync(join(workspace, "binary.dat"), Buffer.from([0x00, 0xff]));
      mkdirSync(join(workspace, "folder"));
      mkdirSync(join(workspace, ".git"));
      mkdirSync(join(workspace, "node_modules"));
      const ls = createLsTool(workspace);

      const complete = await ls.execute("ls-all", { path: "." });
      const limited = await ls.execute("ls-limited", {
        path: ".",
        maxResults: 2,
      });

      expect(complete.content).toEqual([
        { type: "text", text: "a.txt\nb.txt\nfolder/" },
      ]);
      expect(complete.details).toMatchObject({ totalEntries: 3, truncated: false });
      expect(limited.content).toEqual([
        { type: "text", text: "a.txt\nb.txt" },
      ]);
      expect(limited.details).toMatchObject({ totalEntries: 3, truncated: true });
    });
  });
});

describe("find tool", () => {
  it("finds globbed text files recursively with ignores and a limit", async () => {
    await withWorkspace(async (workspace) => {
      mkdirSync(join(workspace, "src"));
      mkdirSync(join(workspace, ".git"));
      mkdirSync(join(workspace, "node_modules"));
      writeFileSync(join(workspace, "root.ts"), "root");
      writeFileSync(join(workspace, "src", "app.ts"), "app");
      writeFileSync(join(workspace, "src", "app.js"), "js");
      writeFileSync(join(workspace, "src", "binary.ts"), Buffer.from([0x00]));
      writeFileSync(join(workspace, ".git", "hidden.ts"), "hidden");
      writeFileSync(join(workspace, "node_modules", "dep.ts"), "dep");
      const find = createFindTool(workspace);

      const complete = await find.execute("find-all", { pattern: "**/*.ts" });
      const limited = await find.execute("find-one", {
        pattern: "**/*.ts",
        maxResults: 1,
      });

      expect(complete.details.matches).toEqual(["root.ts", "src/app.ts"]);
      expect(complete.details.truncated).toBe(false);
      expect(limited.details.matches).toEqual(["root.ts"]);
      expect(limited.details.truncated).toBe(true);
    });
  });
});

describe("grep tool", () => {
  it("returns bounded path and line matches from text files only", async () => {
    await withWorkspace(async (workspace) => {
      mkdirSync(join(workspace, "src"));
      mkdirSync(join(workspace, ".git"));
      writeFileSync(join(workspace, "a.txt"), "first\nneedle one\n");
      writeFileSync(join(workspace, "src", "b.txt"), "needle two\nlast\n");
      writeFileSync(join(workspace, ".git", "hidden.txt"), "needle hidden\n");
      writeFileSync(
        join(workspace, "binary.dat"),
        Buffer.from("needle\u0000hidden"),
      );
      const grep = createGrepTool(workspace);

      const complete = await grep.execute("grep-all", { pattern: "needle" });
      const limited = await grep.execute("grep-one", {
        pattern: "needle",
        maxResults: 1,
      });

      expect(complete.content).toEqual([
        {
          type: "text",
          text: "a.txt:2:needle one\nsrc/b.txt:1:needle two",
        },
      ]);
      expect(complete.details.matches).toHaveLength(2);
      expect(complete.details.truncated).toBe(false);
      expect(limited.details.matches).toHaveLength(1);
      expect(limited.details.truncated).toBe(true);
    });
  });
});

describe("bash tool", () => {
  it("runs inside a workspace-relative cwd and captures both output streams", async () => {
    await withWorkspace(async (workspace) => {
      const subdirectory = join(workspace, "subdirectory");
      mkdirSync(subdirectory);
      const bash = createBashTool(workspace);
      const command = `"${process.execPath}" -e "console.log(process.cwd()); console.error('warning')"`;

      const result = await bash.execute("bash-1", {
        command,
        cwd: "subdirectory",
      });

      expect(result.details).toMatchObject({
        cwd: subdirectory,
        exitCode: 0,
        timedOut: false,
      });
      expect(result.details.stdout.trim()).toBe(subdirectory);
      expect(result.details.stderr.trim()).toBe("warning");
      const summary = result.content[0];
      expect(summary?.type).toBe("text");
      if (summary?.type === "text") {
        expect(summary.text).toContain("Exit code: 0");
      }
    });
  });

  it("limits large output while preserving its head and tail", async () => {
    await withWorkspace(async (workspace) => {
      writeFileSync(
        join(workspace, "large-output.cjs"),
        "process.stdout.write('HEAD' + 'x'.repeat(300) + 'TAIL');\n",
      );
      const bash = createBashTool(workspace);

      const result = await bash.execute("bash-output", {
        command: `"${process.execPath}" large-output.cjs`,
        maxOutputChars: 100,
      });

      expect(result.details.stdoutTruncated).toBe(true);
      expect(result.details.stdout).toMatch(/^HEAD/);
      expect(result.details.stdout).toContain("omitted");
      expect(result.details.stdout).toMatch(/TAIL$/);
    });
  });

  it("cleans up child processes after timeout and abort", async () => {
    await withWorkspace(async (workspace) => {
      const bash = createBashTool(process.cwd());
      const timeoutMarker = join(workspace, "timeout-marker.txt");
      const abortMarker = join(workspace, "abort-marker.txt");
      const delayedWriteCommand = (marker: string): string => {
        const script = [
          "const { writeFileSync } = require('node:fs');",
          `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'leaked'), 600);`,
          "setInterval(() => {}, 1_000);",
        ].join("\n");
        const encoded = Buffer.from(script).toString("base64");
        return `"${process.execPath}" -e "eval(Buffer.from('${encoded}', 'base64').toString())"`;
      };

      await expect(
        bash.execute("bash-timeout", {
          command: delayedWriteCommand(timeoutMarker),
          timeoutMs: 100,
        }),
      ).rejects.toThrow("Command timed out after 100ms");

      const controller = new AbortController();
      const aborted = bash.execute(
        "bash-abort",
        {
          command: delayedWriteCommand(abortMarker),
        },
        controller.signal,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(existsSync(timeoutMarker)).toBe(false);
      expect(existsSync(abortMarker)).toBe(false);
    });
  });
});
