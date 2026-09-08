import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { SessionStorage } from "./storage.js";
import type { SessionSnapshot } from "./types.js";

export interface OpenSessionOptions {
  storage: SessionStorage;
  cwd: string;
  id?: string;
  continue?: boolean;
}

export class SessionManager {
  readonly id: string;
  readonly path: string;
  readonly cwd: string;
  readonly artifactDirectory: string;
  private artifactSequence = 0;

  private constructor(
    private readonly storage: SessionStorage,
    snapshot: SessionSnapshot,
  ) {
    this.id = snapshot.header.id;
    this.path = snapshot.path;
    this.cwd = snapshot.header.cwd;
    this.artifactDirectory = storage.artifactDirectory(snapshot.header.id);
    this.messages = snapshot.messages.slice();
  }

  readonly messages: AgentMessage[];

  static open(options: OpenSessionOptions): SessionManager {
    if (options.id !== undefined && options.continue === true) {
      throw new Error("Choose either an explicit session id or continue mode");
    }
    const snapshot =
      options.id !== undefined
        ? options.storage.load(options.id)
        : options.continue === true
          ? (options.storage.findLatestForCwd(options.cwd) ??
            options.storage.create(options.cwd))
          : options.storage.create(options.cwd);
    return new SessionManager(options.storage, snapshot);
  }

  appendMessage(message: AgentMessage): void {
    this.storage.appendMessage(this.id, message);
    this.messages.push(message);
  }

  writeArtifact(label: string, content: string): string {
    this.artifactSequence += 1;
    const safeLabel = label.replaceAll(/[^a-z0-9._-]/giu, "-").slice(0, 80);
    const fileName = `${String(this.artifactSequence).padStart(4, "0")}-${safeLabel || "tool-result"}.txt`;
    return this.storage.writeArtifact(this.id, fileName, content);
  }
}
