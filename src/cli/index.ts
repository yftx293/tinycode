#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HELP = `Usage: tinycode [--help] [--version]

Options:
  --help     Show this help message
  --version  Show the installed version
`;

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as unknown;

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error("package.json does not contain a valid version");
  }

  return packageJson.version;
}

export function runCli(
  args: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): number {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    io.stdout.write(HELP);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    io.stdout.write(`${readPackageVersion()}\n`);
    return 0;
  }

  io.stderr.write(`Unknown argument: ${String(args[0])}\n`);
  return 1;
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  process.exitCode = runCli(process.argv.slice(2));
}
