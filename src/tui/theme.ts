import type {
  EditorTheme,
  SelectListTheme,
  SettingsListTheme,
} from "@earendil-works/pi-tui";

const identity = (text: string): string => text;

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => `> ${text}`,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
};

export const editorTheme: EditorTheme = {
  borderColor: identity,
  selectList: selectListTheme,
};

export const settingsListTheme: SettingsListTheme = {
  label: identity,
  value: identity,
  description: identity,
  cursor: "> ",
  hint: identity,
};
