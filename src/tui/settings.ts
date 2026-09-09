import {
  SelectList,
  SettingsList,
  Text,
  type Component,
  type SelectItem,
  type SettingItem,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  tinyCodeConfigSchema,
  type TinyCodeConfig,
} from "../config/schema.js";
import { selectListTheme, settingsListTheme } from "./theme.js";

export type SettingId =
  | "model"
  | "permissionMode"
  | "maxOutputTokens"
  | "context.maxTokens"
  | "context.compactThreshold"
  | "context.toolResultMaxChars";

const permissionValues = ["询问（ask）", "自动（auto）"] as const;

function numericValues(current: number, presets: readonly number[]): string[] {
  return [...new Set([current, ...presets])]
    .sort((left, right) => left - right)
    .map(String);
}

function modelValue(config: TinyCodeConfig): string {
  return [config.model.provider, config.model.model].filter(Boolean).join("/");
}

function modelSubmenu(
  models: readonly string[],
): NonNullable<SettingItem["submenu"]> {
  return (currentValue, done) => {
    const values = [...new Set([currentValue, ...models])].filter(
      (value) => value.length > 0,
    );
    const items: SelectItem[] = values.map((value) => ({
      value,
      label: value,
    }));
    const list = new SelectList(items, 12, selectListTheme);
    list.onSelect = (item) => {
      done(item.value);
    };
    list.onCancel = () => {
      done();
    };
    return list;
  };
}

export function createSettingItems(
  config: TinyCodeConfig,
  models: readonly string[],
): SettingItem[] {
  return [
    {
      id: "model",
      label: "运行模型",
      currentValue: modelValue(config),
      description: "Enter 打开模型列表",
      submenu: modelSubmenu(models),
    },
    {
      id: "permissionMode",
      label: "权限模式（TINYCODE_PERMISSION_MODE）",
      currentValue:
        config.permissionMode === "ask" ? permissionValues[0] : permissionValues[1],
      values: [...permissionValues],
    },
    {
      id: "maxOutputTokens",
      label: "最大输出 Token 数（TINYCODE_MAX_OUTPUT_TOKENS）",
      currentValue: String(config.maxOutputTokens),
      values: numericValues(config.maxOutputTokens, [2_048, 4_096, 8_192, 16_384]),
    },
    {
      id: "context.maxTokens",
      label: "上下文最大 Token 数（TINYCODE_CONTEXT_MAX_TOKENS）",
      currentValue: String(config.context.maxTokens),
      values: numericValues(config.context.maxTokens, [16_000, 32_000, 64_000, 128_000]),
    },
    {
      id: "context.compactThreshold",
      label: "上下文压缩阈值（TINYCODE_CONTEXT_COMPACT_THRESHOLD）",
      currentValue: String(config.context.compactThreshold),
      values: numericValues(config.context.compactThreshold, [0.6, 0.7, 0.8, 0.9]),
    },
    {
      id: "context.toolResultMaxChars",
      label: "工具结果最大字符数（TINYCODE_CONTEXT_TOOL_RESULT_MAX_CHARS）",
      currentValue: String(config.context.toolResultMaxChars),
      values: numericValues(config.context.toolResultMaxChars, [6_000, 12_000, 24_000, 48_000]),
    },
  ];
}

function configuredModel(value: string): TinyCodeConfig["model"] {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("模型必须使用 provider/model 格式");
  }
  return {
    provider: value.slice(0, separator),
    model: value.slice(separator + 1),
  };
}

export function applySettingChange(
  config: TinyCodeConfig,
  id: SettingId,
  value: string,
): TinyCodeConfig {
  const next = structuredClone(config);
  switch (id) {
    case "model":
      next.model = configuredModel(value);
      break;
    case "permissionMode":
      next.permissionMode = value === permissionValues[1] ? "auto" : "ask";
      break;
    case "maxOutputTokens":
      next.maxOutputTokens = Number(value);
      break;
    case "context.maxTokens":
      next.context.maxTokens = Number(value);
      break;
    case "context.compactThreshold":
      next.context.compactThreshold = Number(value);
      break;
    case "context.toolResultMaxChars":
      next.context.toolResultMaxChars = Number(value);
      break;
  }
  return tinyCodeConfigSchema.parse(next);
}

class SettingsDialog implements Component {
  private readonly title = new Text(
    "TinyCode 设置\n方向键选择，Enter 修改，Esc 保存并关闭",
    1,
    1,
  );
  private readonly list: SettingsList;

  constructor(
    config: TinyCodeConfig,
    models: readonly string[],
    onChange: (id: SettingId, value: string) => void,
    onClose: () => void,
  ) {
    this.list = new SettingsList(
      createSettingItems(config, models),
      8,
      settingsListTheme,
      (id, value) => {
        onChange(id as SettingId, value);
      },
      onClose,
    );
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

export type SettingsPresenter = (
  config: TinyCodeConfig,
  models: readonly string[],
) => Promise<TinyCodeConfig>;

export function createSettingsPresenter(tui: TUI): SettingsPresenter {
  return (config, models) =>
    new Promise<TinyCodeConfig>((resolveConfig) => {
      let current = structuredClone(config);
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        handle.hide();
        resolveConfig(current);
      };
      const dialog = new SettingsDialog(
        current,
        models,
        (id, value) => {
          current = applySettingChange(current, id, value);
        },
        finish,
      );
      const handle = tui.showOverlay(dialog, {
        width: "90%",
        minWidth: 60,
        maxHeight: "80%",
      });
    });
}
