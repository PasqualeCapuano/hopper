import { invoke } from "@tauri-apps/api/core";
import i18n, { type Locale } from "./i18n";

/** Relabels the tray menu in the given interface language. */
export async function applyTrayLabels(locale: Locale): Promise<void> {
  const opt = { lng: locale };
  await invoke("set_tray_labels", {
    open: i18n.t("tray.open", opt),
    settings: i18n.t("tray.settings", opt),
    quit: i18n.t("tray.quit", opt),
  }).catch(() => {});
}
