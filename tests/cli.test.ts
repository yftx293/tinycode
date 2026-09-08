import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN)$/iu.test(name),
  ),
);

function runCli(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", cliPath, ...args],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: cleanEnvironment,
    },
  );
}

describe("tinycode CLI", () => {
  it("prints help without an API key", () => {
    const result = runCli("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: tinycode [--help] [--version]");
    expect(result.stderr).toBe("");
  });

  it("prints the package version without an API key", () => {
    const result = runCli("--version");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.1.0\n");
    expect(result.stderr).toBe("");
  });

  it("rejects unknown arguments with a non-zero exit code", () => {
    const result = runCli("--unknown");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Unknown argument: --unknown\n");
  });
});
