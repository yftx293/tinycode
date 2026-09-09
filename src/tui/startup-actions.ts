import {
  SelectList,
  Text,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";

import type { SessionListItem } from "../cli/sessions.js";
import { selectListTheme } from "./theme.js";

export type StartupAction = "resume" | "new";

export interface StartupActionControllerOptions {
  isBusy(): boolean;
  recentSessions(): readonly SessionListItem[];
  selectSession(sessions: readonly SessionListItem[]): Promise<string | undefined>;
  resume(id: string): Promise<void>;
  startNew(): Promise<void>;
  notice(message: string): void;
}

export class StartupActionController {
  constructor(private readonly options: StartupActionControllerOptions) {}

  async handle(action: StartupAction): Promise<boolean> {
    if (this.options.isBusy()) {
      this.options.notice("当前任务仍在运行，请先等待或按 Ctrl+C 中止。");
      return false;
    }
    if (action === "new") {
      await this.options.startNew();
      return true;
    }
    const sessions = this.options.recentSessions();
    if (sessions.length === 0) {
      this.options.notice("当前项目暂无可恢复的历史会话。");
      return false;
    }
    const selected = await this.options.selectSession(sessions);
    if (selected === undefined) {
      return false;
    }
    await this.options.resume(selected);
    return true;
  }
}

class SessionDialog implements Component {
  private readonly title = new Text("继续最近会话\nEnter 恢复 · Esc 取消", 1, 1);
  private readonly list: SelectList;

  constructor(
    sessions: readonly SessionListItem[],
    onSelect: (id: string | undefined) => void,
  ) {
    const items: SelectItem[] = sessions.map((session) => ({
      value: session.id,
      label: session.preview || "未命名任务",
      description: `${session.createdAt.slice(0, 16).replace("T", " ")} · ${String(session.messages)} 条消息 · ${session.id.slice(0, 8)}`,
    }));
    this.list = new SelectList(items, Math.min(items.length, 10), selectListTheme);
    this.list.onSelect = (item) => {
      onSelect(item.value);
    };
    this.list.onCancel = () => {
      onSelect(undefined);
    };
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.title.invalidate();
    this.list.invalidate();
  }

  render(width: number): string[] {
    return [...this.title.render(width), ...this.list.render(width)];
  }
}

export type SessionPresenter = (
  sessions: readonly SessionListItem[],
) => Promise<string | undefined>;

export function createSessionPresenter(tui: TUI): SessionPresenter {
  return (sessions) =>
    new Promise<string | undefined>((resolveSession) => {
      let settled = false;
      const finish = (id: string | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        handle.hide();
        resolveSession(id);
      };
      const dialog = new SessionDialog(sessions, finish);
      const handle = tui.showOverlay(dialog, {
        width: "80%",
        minWidth: 48,
        maxHeight: "70%",
      });
    });
}
