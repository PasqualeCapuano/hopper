import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "system" | "light" | "dark";

/** Applies the appearance to this window: CSS tokens and the native window theme. */
export async function applyTheme(theme: Theme): Promise<void> {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    await getCurrentWindow().setTheme(theme === "system" ? null : theme);
  } catch {
    // Older runtimes may not support it; CSS still follows.
  }
}
