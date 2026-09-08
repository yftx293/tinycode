import { randomBytes } from "node:crypto";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const SESSION_FORMAT_VERSION = 1;

export interface SessionHeader {
  type: "session";
  version: typeof SESSION_FORMAT_VERSION;
  id: string;
  cwd: string;
  createdAt: string;
}

export interface SessionMessageRecord {
  type: "message";
  message: AgentMessage;
}

export interface SessionSnapshot {
  header: SessionHeader;
  messages: AgentMessage[];
  path: string;
}

export function createSessionId(timestamp = Date.now()): string {
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > 0xffff_ffff_ffff
  ) {
    throw new Error("UUIDv7 timestamp must be a non-negative 48-bit integer");
  }

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(timestamp, 0, 6);
  randomBytes(10).copy(bytes, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
