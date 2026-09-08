import type { TinyCodeHarness } from "../bootstrap.js";
import { parseModelRef } from "./args.js";
import { listSessions } from "./sessions.js";
import {
  parseSlashCommand,
  slashCommands,
  slashHelp,
} from "../tui/slash.js";
import { renderStatusBar } from "../tui/status-bar.js";

export interface SessionSelection {
  id?: string;
  continue?: boolean;
}

export interface SlashCommandControllerOptions {
  harness: TinyCodeHarness;
  createHarness(session?: SessionSelection): Promise<TinyCodeHarness>;
  sessionDirectory: string;
  projectRoot: string;
}

export interface SlashCommandResult {
  output?: string;
  exit?: boolean;
}

function requireArgument(name: string, argument: string): string {
  if (argument.length === 0) {
    throw new Error(`/${name} requires an argument`);
  }
  return argument;
}

export class SlashCommandController {
  harness: TinyCodeHarness;

  constructor(private readonly options: SlashCommandControllerOptions) {
    this.harness = options.harness;
  }

  async execute(input: string): Promise<SlashCommandResult> {
    const command = parseSlashCommand(input);
    if (command === undefined) {
      throw new Error("Not a slash command");
    }
    if (!slashCommands.some((entry) => entry.name === command.name)) {
      throw new Error(`Unknown command: /${command.name}`);
    }
    if (this.harness.runtime.agent.state.isStreaming) {
      throw new Error("Wait for the current prompt to finish or abort it");
    }

    switch (command.name) {
      case "help":
        return { output: slashHelp() };
      case "new":
        await this.replaceHarness();
        return { output: `Started session ${this.harness.session?.id ?? "none"}` };
      case "clear":
        this.harness.runtime.agent.reset();
        return { output: "Cleared live context; the session log was preserved" };
      case "resume":
        await this.replaceHarness({ id: requireArgument("resume", command.argument) });
        return { output: `Resumed session ${this.harness.session?.id ?? "none"}` };
      case "sessions": {
        const sessions = listSessions(
          this.options.sessionDirectory,
          this.options.projectRoot,
        );
        return {
          output:
            sessions.length === 0
              ? "No sessions for this project"
              : sessions
                  .map(
                    (session) =>
                      `${session.id}  ${session.createdAt}  ${String(session.messages)} messages`,
                  )
                  .join("\n"),
        };
      }
      case "model": {
        if (command.argument.length === 0) {
          const model = this.harness.runtime.agent.state.model;
          return { output: `${model.provider}/${model.id}` };
        }
        const model = await this.harness.models.resolve(
          parseModelRef(command.argument),
        );
        this.harness.runtime.agent.state.model = model;
        return { output: `Model set to ${model.provider}/${model.id}` };
      }
      case "skills": {
        const names = this.harness.skills.names();
        return { output: names.length === 0 ? "No skills" : names.join("\n") };
      }
      case "mcp": {
        const statuses = this.harness.mcp.statuses();
        return {
          output:
            statuses.length === 0
              ? "No MCP servers"
              : statuses
                  .map(
                    (status) =>
                      `${status.name}: ${status.state}${status.error === undefined ? "" : ` - ${status.error}`}`,
                  )
                  .join("\n"),
        };
      }
      case "agents": {
        const reports = this.harness.agents?.reports() ?? [];
        return {
          output:
            reports.length === 0
              ? "No workers"
              : reports
                  .map((report) => `${report.name}: ${report.status}`)
                  .join("\n"),
        };
      }
      case "compact":
        this.harness.runtime.compactNow();
        return { output: "Compacted live context" };
      case "status":
        return { output: renderStatusBar(this.harness, this.options.projectRoot) };
      case "exit":
        return { exit: true };
      default:
        throw new Error(`Unknown command: /${command.name}`);
    }
  }

  private async replaceHarness(session?: SessionSelection): Promise<void> {
    const previous = this.harness;
    await previous.shutdown();
    this.harness = await this.options.createHarness(session);
  }
}
