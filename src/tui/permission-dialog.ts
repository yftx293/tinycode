import {
  SelectList,
  Text,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";

import type {
  PermissionManager,
  PermissionPromptRequest,
  PromptFn,
  PromptOutcome,
} from "../permissions/manager.js";
import { selectListTheme } from "./theme.js";

export const permissionChoices: readonly {
  label: string;
  outcome: PromptOutcome;
}[] = [
  { label: "Allow once", outcome: "once" },
  { label: "Always allow", outcome: "always" },
  { label: "Deny", outcome: "deny" },
];

export type PermissionPresenter = (
  request: PermissionPromptRequest,
) => Promise<PromptOutcome>;

export function installPermissionPrompt(
  manager: PermissionManager,
  presenter: PermissionPresenter,
): void {
  const prompt: PromptFn = (request) => presenter(request);
  manager.setPrompt(prompt);
}

class PermissionDialog implements Component {
  private readonly title: Text;
  private readonly list: SelectList;

  constructor(
    request: PermissionPromptRequest,
    resolveChoice: (outcome: PromptOutcome) => void,
  ) {
    this.title = new Text(
      `Permission required: ${request.toolName}\n${request.reason}\n${JSON.stringify(request.input)}`,
      1,
      1,
    );
    const items: SelectItem[] = permissionChoices.map((choice) => ({
      value: choice.outcome,
      label: choice.label,
    }));
    this.list = new SelectList(items, items.length, selectListTheme);
    this.list.onSelect = (item) => {
      resolveChoice(item.value as PromptOutcome);
    };
    this.list.onCancel = () => {
      resolveChoice("deny");
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

export function createPermissionPresenter(tui: TUI): PermissionPresenter {
  return (request) =>
    new Promise<PromptOutcome>((resolveChoice) => {
      let settled = false;
      const finish = (outcome: PromptOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        handle.hide();
        resolveChoice(outcome);
      };
      const dialog = new PermissionDialog(request, finish);
      const handle = tui.showOverlay(dialog, { width: "80%", minWidth: 40 });
    });
}
