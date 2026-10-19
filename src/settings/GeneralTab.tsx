import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { clearThreads, listThreads } from "../lib/history";
import { applyTheme, type Theme } from "../lib/theme";
import { LOCALES, setLocale, type Locale } from "../lib/i18n";
import { applyTrayLabels } from "../lib/tray";
import { translateDefaultActions, type Settings } from "../lib/settings";

const REPO = "https://github.com/PasqualeCapuano/hopper";
const IS_MAC = navigator.userAgent.includes("Mac");

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} className={"switch" + (checked ? " on" : "")} onClick={() => onChange(!checked)}>
        <span className="knob" />
      </button>
    </label>
  );
}

export default function GeneralTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const { t } = useTranslation();
  const [auto, setAuto] = useState(s.autostart);
  const [acc, setAcc] = useState<boolean | null>(null);
  const [scr, setScr] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");
  const [dataDir, setDataDir] = useState("");
  const [threads, setThreads] = useState<number | null>(null);
  const [upd, setUpd] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    void isEnabled().then(setAuto).catch(() => {});
    void invoke<boolean>("accessibility_granted").then(setAcc);
    void invoke<boolean>("screen_recording_granted").then(setScr);
    void getVersion().then(setVersion).catch(() => {});
    void appDataDir().then(setDataDir).catch(() => {});
    void listThreads().then((th) => setThreads(th.length)).catch(() => setThreads(0));
  }, []);

  const toggleAuto = async (v: boolean) => {
    try {
      if (v) await enable();
      else await disable();
      setAuto(v);
      update({ autostart: v });
    } catch (err) {
      setUpd(String(err));
    }
  };

  const setTheme = (th: Theme) => {
    update({ theme: th });
    void applyTheme(th);
  };

  const changeLocale = (locale: Locale) => {
    if (locale === s.locale) return;
    setLocale(locale);
    // Built-in actions the user never touched follow the language; the tray menu too.
    update({ locale, actions: translateDefaultActions(s.actions, s.locale, locale) });
    void applyTrayLabels(locale);
  };

  const checkUpdates = async () => {
    setUpd(t("gen.checking"));
    try {
      const u = await check();
      if (!u) { setUpd(t("gen.upToDate")); return; }
      setUpd(t("gen.downloading", { v: u.version }));
      await u.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setUpd(t("gen.checkFailed", { err: String(err) }));
    }
  };

  const requestAccessibility = async () => {
    await invoke("accessibility_prompt");
    setAcc(await invoke<boolean>("accessibility_granted"));
  };

  const requestScreen = async () => {
    await invoke("screen_recording_prompt");
    setScr(await invoke<boolean>("screen_recording_granted"));
  };

  const wipeHistory = async () => {
    await clearThreads();
    setThreads(0);
    setCleared(true);
    setTimeout(() => setCleared(false), 1500);
  };

  return (
    <>
      <div>
        <h1>{t("gen.title")}</h1>
        <div className="lead">{t("gen.lead")}</div>
      </div>

      <section className="section">
        <h2>{t("gen.language")}</h2>
        <div className="segmented" role="radiogroup" aria-label={t("gen.language")}>
          {LOCALES.map((l) => (
            <button key={l.id} role="radio" aria-checked={s.locale === l.id} className={s.locale === l.id ? "active" : ""} onClick={() => changeLocale(l.id)}>{l.label}</button>
          ))}
        </div>
        <div className="help">{t("gen.languageHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("gen.startup")}</h2>
        <Switch checked={auto} onChange={(v) => void toggleAuto(v)} label={t("gen.autostart")} />
        <div className="help">{t("gen.autostartHelp")}</div>
        <Switch checked={s.grabSelection} onChange={(v) => { update({ grabSelection: v }); void invoke("set_prefs", { grabSelection: v }).catch(() => {}); }} label={t("gen.grab")} />
        <div className="help">{t("gen.grabHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("gen.appearance")}</h2>
        <div className="segmented" role="radiogroup" aria-label={t("gen.appearance")}>
          {(["system", "light", "dark"] as Theme[]).map((th) => (
            <button key={th} role="radio" aria-checked={s.theme === th} className={s.theme === th ? "active" : ""} onClick={() => setTheme(th)}>{t(`theme.${th}`)}</button>
          ))}
        </div>
        <div className="help">{t("gen.themeHelp")}</div>
      </section>

      {IS_MAC ? (
        <section className="section">
          <h2>{t("gen.permissions")}</h2>
          <div className="status-row">
            <span>{t("gen.accessibility")}</span>
            <span className={"status-pill" + (acc ? " ok" : acc === false ? " warn" : "")}>{acc === null ? "…" : acc ? t("gen.granted") : t("gen.notGranted")}</span>
            {acc === false ? <button className="btn small" onClick={() => void requestAccessibility()}>{t("gen.request")}</button> : null}
          </div>
          <div className="help">{t("gen.accHelp")}</div>
          <div className="status-row">
            <span>{t("gen.screenRecording")}</span>
            <span className={"status-pill" + (scr ? " ok" : scr === false ? " warn" : "")}>{scr === null ? "…" : scr ? t("gen.granted") : t("gen.notGranted")}</span>
            {scr === false ? <button className="btn small" onClick={() => void requestScreen()}>{t("gen.request")}</button> : null}
          </div>
          <div className="help">{t("gen.screenHelp")}</div>
        </section>
      ) : null}

      <section className="section">
        <h2>{t("gen.updates")}</h2>
        <div className="status-row">
          <span>{t("gen.installed")}</span>
          <span className="status-pill">{version ? `v${version}` : "…"}</span>
          <button className="btn small" onClick={() => void checkUpdates()}>{t("gen.checkNow")}</button>
          {upd ? <span className="help">{upd}</span> : null}
        </div>
        <div className="help">{t("gen.updatesHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("gen.data")}</h2>
        <div className="status-row">
          <span>{t("gen.history")}</span>
          <span className="status-pill">{threads === null ? "…" : t("gen.threads", { n: threads })}</span>
          <button className="btn small" onClick={() => void wipeHistory()} disabled={!threads}>{t("gen.clear")}</button>
          {cleared ? <span className="inline-ok">{t("gen.cleared")}</span> : null}
        </div>
        <div className="help">{t("gen.historyHelp")}</div>
        <div className="status-row">
          <span>{t("gen.dataFolder")}</span>
          <code className="path">{dataDir || "…"}</code>
          <button className="btn small" onClick={() => void openPath(dataDir)} disabled={!dataDir}>{t("gen.open")}</button>
        </div>
        <div className="help">{t("gen.dataHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("gen.about")}</h2>
        <div className="help">{t("gen.aboutText")}</div>
        <div className="btn-row">
          <button className="btn small" onClick={() => void openUrl(REPO)}>{t("gen.github")}</button>
          <button className="btn small" onClick={() => void openUrl(`${REPO}/issues/new`)}>{t("gen.report")}</button>
          <button className="btn small" onClick={() => void openUrl(`${REPO}/releases`)}>{t("gen.releases")}</button>
        </div>
      </section>
    </>
  );
}
