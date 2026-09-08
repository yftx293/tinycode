import {
  Editor,
  Key,
  ProcessTerminal,
  Text,
  TuiMainScreen,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";

import type { TinyCodeHarness } from "../bootstrap.js";
import {
  SlashCommandController,
  type SessionSelection,
} from "../cli/commands.js";
import {
  createPermissionPresenter,
  installPermissionPrompt,
} from "./permission-dialog.js";
import { renderStatusBar } from "./status-bar.js";
import { TranscriptModel } from "./transcript.js";
import { editorTheme } from "./theme.js";

export type InterruptInput = "ctrl-c" | "ctrl-d" | "escape";

export interface InterruptControllerOptions {
  isBusy(): boolean;
  abort(): void;
  exit(): void;
  now?: () => number;
  notice?: (message: string) => void;
}

export class InterruptController {
  private lastIdleInterrupt: number | undefined;
  private readonly now: () => number;

  constructor(private readonly options: InterruptControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  handle(input: InterruptInput): void {
    if (input === "ctrl-d") {
      this.options.exit();
      return;
    }
    if (input === "escape") {
      if (this.options.isBusy()) {
        this.options.abort();
      }
      return;
    }
    if (this.options.isBusy()) {
      this.lastIdleInterrupt = undefined;
      this.options.abort();
      return;
    }

    const current = this.now();
    if (
      this.lastIdleInterrupt !== undefined &&
      current - this.lastIdleInterrupt <= 2_000
    ) {
      this.options.exit();
      return;
    }
    this.lastIdleInterrupt = current;
    this.options.notice?.("Press Ctrl+C again within 2 seconds to exit");
  }
}

export interface TinyCodeTuiOptions {
  projectRoot: string;
  sessionDirectory: string;
  createHarness(session?: SessionSelection): Promise<TinyCodeHarness>;
}

export async function runTinyCodeTui(
  initialHarness: TinyCodeHarness,
  options: TinyCodeTuiOptions,
): Promise<number> {
  const terminal = new ProcessTerminal();
  const tui: TUI = new TuiMainScreen(terminal);
  const transcript = new TranscriptModel();
  const transcriptView = new Text();
  const statusView = new Text();
  const editor = new Editor(tui, editorTheme, { paddingX: 1 });
  const commands = new SlashCommandController({
    harness: initialHarness,
    createHarness: (session) => options.createHarness(session),
    sessionDirectory: options.sessionDirectory,
    projectRoot: options.projectRoot,
  });
  let unsubscribe = (): void => undefined;
  let finished = false;
  let resolveExit: (() => void) | undefined;
  const exitRequested = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const refresh = (): void => {
    transcriptView.setText(transcript.text());
    statusView.setText(renderStatusBar(commands.harness, options.projectRoot));
    tui.requestRender();
  };
  const bindHarness = (): void => {
    unsubscribe();
    installPermissionPrompt(
      commands.harness.runtime.permissions,
      createPermissionPresenter(tui),
    );
    unsubscribe = commands.harness.runtime.subscribe((agentEvent) => {
      transcript.consume(agentEvent);
      editor.disableSubmit = commands.harness.runtime.agent.state.isStreaming;
      refresh();
    });
    refresh();
  };
  const requestExit = (): void => {
    if (!finished) {
      finished = true;
      resolveExit?.();
    }
  };
  const controls = new InterruptController({
    isBusy: () => commands.harness.runtime.agent.state.isStreaming,
    abort: () => {
      commands.harness.runtime.abort();
    },
    exit: requestExit,
    notice: (message) => {
      transcript.append(`status> ${message}`);
      refresh();
    },
  });
  const removeInputListener = tui.addInputListener((data) => {
    if (matchesKey(data, Key.ctrl("c"))) {
      controls.handle("ctrl-c");
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl("d"))) {
      controls.handle("ctrl-d");
      return { consume: true };
    }
    if (matchesKey(data, Key.escape)) {
      controls.handle("escape");
      if (commands.harness.runtime.agent.state.isStreaming) {
        return { consume: true };
      }
    }
    return undefined;
  });
  const handleSigint = (): void => {
    controls.handle("ctrl-c");
  };

  editor.onSubmit = (rawInput) => {
    const input = rawInput.trim();
    if (input.length === 0) {
      return;
    }
    void (async () => {
      if (commands.harness.runtime.agent.state.isStreaming) {
        transcript.append("error> A prompt is already running");
        refresh();
        return;
      }
      const previousHarness = commands.harness;
      try {
        if (input.startsWith("/")) {
          const result = await commands.execute(input);
          if (commands.harness !== previousHarness) {
            bindHarness();
          }
          if (result.output !== undefined) {
            transcript.append(`status> ${result.output}`);
          }
          if (result.exit === true) {
            requestExit();
          }
        } else {
          transcript.append(`user> ${input}`);
          editor.disableSubmit = true;
          refresh();
          await commands.harness.runtime.prompt(input);
        }
      } catch (error) {
        transcript.append(
          `error> ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        editor.disableSubmit = commands.harness.runtime.agent.state.isStreaming;
        refresh();
      }
    })();
  };

  tui.addChild(transcriptView);
  tui.addChild(statusView);
  tui.addChild(editor);
  tui.setFocus(editor);
  bindHarness();
  process.on("SIGINT", handleSigint);
  tui.start();

  try {
    await exitRequested;
  } finally {
    process.off("SIGINT", handleSigint);
    removeInputListener();
    unsubscribe();
    tui.stop();
  }
  return 0;
}
