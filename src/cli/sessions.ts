import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { SessionStorage } from "../session/storage.js";

export interface SessionListItem {
  id: string;
  cwd: string;
  createdAt: string;
  messages: number;
  preview: string;
}

export interface ListSessionsOptions {
  excludeId?: string;
  nonEmpty?: boolean;
  limit?: number;
}

function userPreview(messages: readonly unknown[]): string {
  const user = messages.find((message) => {
    const record =
      typeof message === "object" && message !== null
        ? (message as Record<string, unknown>)
        : undefined;
    return record?.role === "user";
  }) as { content?: unknown } | undefined;
  const content = user?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .flatMap((block) => {
              const record =
                typeof block === "object" && block !== null
                  ? (block as Record<string, unknown>)
                  : undefined;
              return record?.type === "text" && typeof record.text === "string"
                ? [record.text]
                : [];
            })
            .join(" ")
        : "";
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  return normalized.length <= 56
    ? normalized
    : `${normalized.slice(0, 53)}...`;
}

export function listSessions(
  directory: string,
  cwd?: string,
  options: ListSessionsOptions = {},
): SessionListItem[] {
  if (!existsSync(directory)) {
    return [];
  }
  const storage = new SessionStorage(directory);
  const expectedCwd = cwd === undefined ? undefined : resolve(cwd);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name.slice(0, -".jsonl".length))
    .flatMap((id) => {
      try {
        const snapshot = storage.load(id);
        if (expectedCwd !== undefined && resolve(snapshot.header.cwd) !== expectedCwd) {
          return [];
        }
        return [{
          id,
          cwd: snapshot.header.cwd,
          createdAt: snapshot.header.createdAt,
          messages: snapshot.messages.length,
          preview: userPreview(snapshot.messages),
        }];
      } catch {
        return [];
      }
    })
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    )
    .filter((session) => session.id !== options.excludeId)
    .filter((session) => options.nonEmpty !== true || session.messages > 0)
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}
