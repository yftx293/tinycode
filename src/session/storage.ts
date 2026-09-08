import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
  createSessionId,
  SESSION_FORMAT_VERSION,
  type SessionHeader,
  type SessionMessageRecord,
  type SessionSnapshot,
} from "./types.js";

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseHeader(value: unknown, expectedId: string): SessionHeader {
  const record = asRecord(value);
  if (
    record?.type !== "session" ||
    record.version !== SESSION_FORMAT_VERSION ||
    record.id !== expectedId ||
    typeof record.cwd !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    throw new Error(`Invalid session header: ${expectedId}`);
  }
  return {
    type: "session",
    version: SESSION_FORMAT_VERSION,
    id: expectedId,
    cwd: record.cwd,
    createdAt: record.createdAt,
  };
}

function parseMessage(value: unknown, sessionId: string): AgentMessage {
  const record = asRecord(value);
  const message = asRecord(record?.message);
  if (
    record?.type !== "message" ||
    message === undefined ||
    !["user", "assistant", "toolResult"].includes(String(message.role))
  ) {
    throw new Error(`Invalid message record in session: ${sessionId}`);
  }
  return message as unknown as AgentMessage;
}

export class SessionStorage {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  sessionPath(id: string): string {
    if (!SESSION_ID_PATTERN.test(id)) {
      throw new Error(`Invalid session id: ${id}`);
    }
    return join(this.directory, `${id}.jsonl`);
  }

  artifactDirectory(id: string): string {
    this.sessionPath(id);
    return join(this.directory, `${id}.artifacts`);
  }

  writeArtifact(id: string, fileName: string, content: string): string {
    const directory = this.artifactDirectory(id);
    const path = join(directory, fileName);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    return path;
  }

  create(cwd: string, id = createSessionId()): SessionSnapshot {
    const path = this.sessionPath(id);
    const header: SessionHeader = {
      type: "session",
      version: SESSION_FORMAT_VERSION,
      id,
      cwd: resolve(cwd),
      createdAt: new Date().toISOString(),
    };
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(path, `${JSON.stringify(header)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return { header, messages: [], path };
  }

  appendMessage(id: string, message: AgentMessage): void {
    const record: SessionMessageRecord = { type: "message", message };
    appendFileSync(this.sessionPath(id), `${JSON.stringify(record)}\n`, "utf8");
  }

  load(id: string): SessionSnapshot {
    const path = this.sessionPath(id);
    if (!existsSync(path)) {
      throw new Error(`Session not found: ${id}`);
    }
    const lines = readFileSync(path, "utf8").split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    const headerLine = lines[0];
    if (headerLine === undefined) {
      throw new Error(`Session is empty: ${id}`);
    }

    let headerValue: unknown;
    try {
      headerValue = JSON.parse(headerLine) as unknown;
    } catch (error) {
      throw new Error(`Invalid session header: ${id}`, { cause: error });
    }
    const header = parseHeader(headerValue, id);
    const messages: AgentMessage[] = [];
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined || line.trim().length === 0) {
        continue;
      }
      try {
        messages.push(parseMessage(JSON.parse(line) as unknown, id));
      } catch (error) {
        if (index === lines.length - 1 && error instanceof SyntaxError) {
          break;
        }
        throw error;
      }
    }
    return { header, messages, path };
  }

  findLatestForCwd(cwd: string): SessionSnapshot | undefined {
    if (!existsSync(this.directory)) {
      return undefined;
    }
    const expectedCwd = resolve(cwd);
    const ids = readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name.slice(0, -".jsonl".length))
      .filter((id) => SESSION_ID_PATTERN.test(id))
      .sort((left, right) => right.localeCompare(left));

    for (const id of ids) {
      const session = this.load(id);
      if (resolve(session.header.cwd) === expectedCwd) {
        return session;
      }
    }
    return undefined;
  }
}
