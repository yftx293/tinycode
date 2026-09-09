import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

import type { SessionListItem } from "../cli/sessions.js";
import { createTuiPalette, type TuiPalette } from "./theme.js";

const WIDE_LOGO = [
  " _____ ___ _  ___   __   ___ ___  ___ ",
  "|_   _|_ _| \\| \\ \\ / /  / __/ _ \\|   \\| __|",
  "  | |  | || .` |\\ V /  | (_| (_) | |) | _| ",
  "  |_| |___|_|\\_| |_|    \\___\\___/|___/|___|",
];

export interface WelcomeViewOptions {
  version: string;
  projectRoot: string;
  model: string;
  permissionMode: "ask" | "auto";
  sessionId: string;
  recentSessions: readonly SessionListItem[];
  colorEnabled?: boolean;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function sessionTime(createdAt: string): string {
  return createdAt.slice(5, 16).replace("T", " ");
}

export class WelcomeView implements Component {
  private readonly palette: TuiPalette;
  private collapsed = false;
  private options: WelcomeViewOptions;

  constructor(options: WelcomeViewOptions) {
    this.options = options;
    this.palette = createTuiPalette(options.colorEnabled);
  }

  collapse(): void {
    this.collapsed = true;
  }

  expand(): void {
    this.collapsed = false;
  }

  update(
    options: Partial<Omit<WelcomeViewOptions, "colorEnabled">>,
  ): void {
    this.options = { ...this.options, ...options };
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.collapsed || width <= 0) {
      return [];
    }
    if (width < 64) {
      return this.renderCompact(width);
    }
    return this.renderWide(Math.min(width, 92));
  }

  private renderWide(width: number): string[] {
    const lines = [this.border("╭", "╮", width)];
    for (const line of WIDE_LOGO) {
      lines.push(this.row(line, width, this.palette.title));
    }
    lines.push(
      this.row(
        `TinyCode v${this.options.version}  ·  专注、轻量的终端 Coding Agent`,
        width,
        this.palette.accent,
      ),
      this.divider(width),
      this.row(`项目  ${this.options.projectRoot}`, width),
      this.row(
        `模型  ${this.options.model}   权限  ${this.options.permissionMode}   会话  ${shortId(this.options.sessionId)}`,
        width,
      ),
      this.divider(width),
      this.row("最近会话", width, this.palette.title),
    );
    if (this.options.recentSessions.length === 0) {
      lines.push(this.row("暂无历史任务，直接在下方输入开始。", width, this.palette.muted));
    } else {
      for (const session of this.options.recentSessions) {
        lines.push(
          this.row(
            `${sessionTime(session.createdAt)}  ${session.preview || "未命名任务"}  · ${String(session.messages)} 条 · ${shortId(session.id)}`,
            width,
            this.palette.muted,
          ),
        );
      }
    }
    lines.push(
      this.divider(width),
      this.row(
        "Ctrl+R 继续会话   Ctrl+N 新建会话   /help 帮助   /settings 设置",
        width,
        this.palette.accent,
      ),
      this.border("╰", "╯", width),
    );
    return lines;
  }

  private renderCompact(width: number): string[] {
    const lines = [
      this.palette.title(`TinyCode v${this.options.version}`),
      `模型 ${this.options.model} · 权限 ${this.options.permissionMode}`,
      `项目 ${this.options.projectRoot}`,
    ];
    const latest = this.options.recentSessions[0];
    if (latest !== undefined) {
      lines.push(`最近 ${sessionTime(latest.createdAt)} · ${latest.preview}`);
    }
    lines.push(this.palette.accent("Ctrl+R 继续 · Ctrl+N 新建 · /help · /settings"));
    return lines.map((line) => truncateToWidth(line, width));
  }

  private border(left: string, right: string, width: number): string {
    return this.palette.accent(`${left}${"─".repeat(Math.max(0, width - 2))}${right}`);
  }

  private divider(width: number): string {
    return this.palette.accent(`├${"─".repeat(Math.max(0, width - 2))}┤`);
  }

  private row(
    text: string,
    width: number,
    style: (value: string) => string = (value) => value,
  ): string {
    const innerWidth = Math.max(0, width - 4);
    const content = truncateToWidth(text, innerWidth);
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
    return `${this.palette.accent("│")} ${style(content)}${padding} ${this.palette.accent("│")}`;
  }
}
