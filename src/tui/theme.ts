import type {
  EditorTheme,
  SelectListTheme,
  SettingsListTheme,
} from "@earendil-works/pi-tui";

const identity = (text: string): string => text;

function ansi(code: number, enabled: boolean): (text: string) => string {
  return enabled
    ? (text) => `\u001b[${String(code)}m${text}\u001b[0m`
    : identity;
}

export function terminalColorsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !("NO_COLOR" in env) && env.TERM?.toLowerCase() !== "dumb";
}

export interface TuiPalette {
  title: (text: string) => string;
  accent: (text: string) => string;
  muted: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
}

export function createTuiPalette(
  enabled = terminalColorsEnabled(),
): TuiPalette {
  return {
    title: ansi(96, enabled),
    accent: ansi(94, enabled),
    muted: ansi(2, enabled),
    success: ansi(92, enabled),
    warning: ansi(93, enabled),
    error: ansi(91, enabled),
  };
}

const palette = createTuiPalette();

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => palette.accent(`> ${text}`),
  selectedText: palette.title,
  description: palette.muted,
  scrollInfo: palette.muted,
  noMatch: palette.warning,
};

export const editorTheme: EditorTheme = {
  borderColor: palette.accent,
  selectList: selectListTheme,
};

export const settingsListTheme: SettingsListTheme = {
  label: (text, selected) => selected ? palette.title(text) : text,
  value: (text, selected) => selected ? palette.accent(text) : text,
  description: palette.muted,
  cursor: palette.accent("> "),
  hint: palette.muted,
};
