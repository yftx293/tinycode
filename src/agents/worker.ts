import { randomUUID } from "node:crypto";

import {
  Agent,
  type AfterToolCallResult,
  type AgentMessage,
  type AgentToolResult,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import { contentText, type Api, type Model } from "@earendil-works/pi-ai";

import { createFindTool } from "../tools/find.js";
import { createGrepTool } from "../tools/grep.js";
import { createLsTool } from "../tools/ls.js";
import { createReadTool } from "../tools/read.js";
import type { WorkerReport, WorkerStatus } from "./types.js";

const WORKER_SYSTEM_PROMPT = [
  "You are a read-only research worker.",
  "Investigate the assigned task using only read, grep, find, and ls.",
  "Do not modify files, run shell commands, load skills, or create workers.",
  "Return concise findings to the supervising agent.",
].join("\n");

export interface WorkerOptions {
  name: string;
  task: string;
  projectRoot: string;
  model: Model<Api>;
  streamFn: StreamFn;
  toolResultMaxChars?: number;
}

function truncateResult(
  result: AgentToolResult<unknown>,
  maxChars: number,
): AfterToolCallResult | undefined {
  const fullText = result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  if (fullText.length <= maxChars) {
    return undefined;
  }
  const marker = "\n... omitted worker tool output ...\n";
  const kept = Math.max(32, maxChars - marker.length);
  const head = Math.floor(kept / 2);
  const tail = kept - head;
  const omitted = fullText.length - head - tail;
  return {
    content: [
      {
        type: "text",
        text: `${fullText.slice(0, head)}\n... omitted ${String(omitted)} characters ...\n${fullText.slice(-tail)}`,
      },
    ],
  };
}

function finalAssistantText(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return contentText(message.content);
    }
  }
  return "";
}

export class Worker {
  readonly id = randomUUID();
  readonly name: string;
  readonly task: string;
  readonly agent: Agent;
  private status: WorkerStatus = "running";
  private reportText = "";
  private readonly startedAt = Date.now();
  private completion: Promise<void> | undefined;

  constructor(options: WorkerOptions) {
    this.name = options.name;
    this.task = options.task;
    this.agent = new Agent({
      initialState: {
        systemPrompt: WORKER_SYSTEM_PROMPT,
        model: options.model,
        thinkingLevel: "off",
        messages: [],
        tools: [
          createReadTool(options.projectRoot),
          createGrepTool(options.projectRoot),
          createFindTool(options.projectRoot),
          createLsTool(options.projectRoot),
        ],
      },
      streamFn: options.streamFn,
      transformContext: (messages) => Promise.resolve(messages),
      afterToolCall: ({ result }) =>
        Promise.resolve(
          truncateResult(result, options.toolResultMaxChars ?? 12_000),
        ),
    });
  }

  start(): void {
    if (this.completion !== undefined) {
      throw new Error(`Worker already started: ${this.name}`);
    }
    this.completion = this.agent
      .prompt(this.task)
      .then(() => {
        this.reportText = finalAssistantText(this.agent.state.messages);
        const finalMessage = this.agent.state.messages.at(-1);
        if (this.status === "aborted" || finalMessage?.role !== "assistant") {
          return;
        }
        if (finalMessage.stopReason === "aborted") {
          this.status = "aborted";
        } else if (finalMessage.stopReason === "error") {
          this.status = "error";
        } else {
          this.status = "completed";
        }
      })
      .catch((error: unknown) => {
        if (this.status !== "aborted") {
          this.status = "error";
          this.reportText =
            error instanceof Error ? error.message : "Worker failed";
        }
      });
  }

  snapshot(): WorkerReport {
    return {
      id: this.id,
      name: this.name,
      task: this.task,
      status: this.status,
      report: this.reportText,
      durationMs: Date.now() - this.startedAt,
    };
  }

  async wait(): Promise<WorkerReport> {
    await this.completion;
    return this.snapshot();
  }

  close(): WorkerReport {
    if (this.status === "running") {
      this.status = "aborted";
      this.agent.abort();
    }
    return this.snapshot();
  }
}
