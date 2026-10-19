import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./settings";

const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * Registers the global hotkey, the screenshot hotkey and every quick action
 * that has one, and pushes the behaviour prefs to Rust. Returns failed ids.
 */
export async function applyHotkeys(settings: Settings): Promise<string[]> {
  void invoke("set_prefs", { grabSelection: settings.grabSelection, dictationToggle: settings.dictation.toggle }).catch(() => {});
  const bindings = [{ id: "open", shortcut: settings.hotkey }];
  if (settings.shotHotkey?.trim()) bindings.push({ id: "shot", shortcut: settings.shotHotkey.trim() });
  if (settings.dictation.hotkey?.trim()) bindings.push({ id: "dictate", shortcut: settings.dictation.hotkey.trim() });
  for (const a of settings.actions) {
    if (a.shortcut?.trim()) bindings.push({ id: a.id, shortcut: a.shortcut.trim() });
  }
  return invoke<string[]>("set_hotkeys", { bindings });
}

/** Turns a keydown event into a Tauri shortcut string, or null for a bare modifier. */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  if (!code || /^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(code)) return null;
  const parts: string[] = [];
  if (e.metaKey) parts.push(IS_MAC ? "Command" : "Super");
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const isFunctionKey = /^F\d{1,2}$/.test(code);
  if (parts.length === 0 && !isFunctionKey) return null;
  parts.push(code);
  return parts.join("+");
}

const KEY_LABELS: Record<string, string> = {
  Space: "Space",
  Enter: "↵",
  Escape: "Esc",
  Backspace: "⌫",
  Tab: "⇥",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/** Human-readable form: "Alt+Space" → "⌥ Space", "Control+Shift+KeyK" → "⌃ ⇧ K". */
export function prettyShortcut(shortcut: string): string {
  if (!shortcut) return "";
  return shortcut
    .split("+")
    .map((part) => {
      switch (part) {
        case "CommandOrControl":
        case "CmdOrCtrl":
          return IS_MAC ? "⌘" : "Ctrl";
        case "Command":
        case "Cmd":
        case "Super":
          return IS_MAC ? "⌘" : "Win";
        case "Control":
        case "Ctrl":
          return IS_MAC ? "⌃" : "Ctrl";
        case "Alt":
        case "Option":
          return IS_MAC ? "⌥" : "Alt";
        case "Shift":
          return IS_MAC ? "⇧" : "Shift";
        default: {
          if (KEY_LABELS[part]) return KEY_LABELS[part];
          const m = /^(Key|Digit)(.)$/.exec(part);
          return m ? m[2] : part;
        }
      }
    })
    .join(" ");
}
