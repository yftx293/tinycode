import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { SessionStorage } from "../session/storage.js";

export interface SessionListItem {
  id: string;
  cwd: string;
  createdAt: string;
  messages: number;
}

export function listSessions(directory: string, cwd?: string): SessionListItem[] {
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
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.id.localeCompare(left.id));
}
