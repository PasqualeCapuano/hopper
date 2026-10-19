import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { applyHotkeys, prettyShortcut } from "../lib/hotkeys";
import { providerInfo } from "../lib/providers";
import { getSecret } from "../lib/secrets";
import { STT_MODELS } from "../lib/dictation";
import type { DictationSettings, Settings, SttProvider } from "../lib/settings";
import HotkeyRecorder from "./HotkeyRecorder";

const PROVIDERS: { id: SttProvider; hint: string }[] = [
  { id: "groq", hint: "dict.groqHint" },
  { id: "openai", hint: "dict.openaiHint" },
];

export default function DictationTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const { t } = useTranslation();
  const d = s.dictation;
  const set = (patch: Partial<DictationSettings>) => update({ dictation: { ...d, ...patch } });
  const [keys, setKeys] = useState<Partial<Record<SttProvider, boolean>>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [mics, setMics] = useState<string[]>([]);

  useEffect(() => {
    void invoke<string[]>("list_microphones").then(setMics).catch(() => setMics([]));
    void Promise.all(PROVIDERS.map(async (p) => [p.id, !!(await getSecret(p.id))] as const)).then((e) => setKeys(Object.fromEntries(e)));
  }, []);

  const changeHotkey = async (shortcut: string) => {
    const next = { ...s, dictation: { ...d, hotkey: shortcut } };
    set({ hotkey: shortcut });
    if (!shortcut) { setStatus(null); return; }
    try {
      const failed = await applyHotkeys(next);
      setStatus(failed.includes("dictate") ? { ok: false, text: t("hk.taken", { sc: prettyShortcut(shortcut) }) } : { ok: true, text: t("hk.active", { sc: prettyShortcut(shortcut) }) });
    } catch (err) {
      setStatus({ ok: false, text: String(err) });
    }
  };

  const name = providerInfo(d.provider).name;

  return (
    <>
      <div>
        <h1>{t("dict.title")}</h1>
        <div className="lead">{t("dict.lead")}</div>
      </div>

      <section className="section">
        <h2>{t("dict.hotkey")}</h2>
        <HotkeyRecorder value={d.hotkey} onChange={(sc) => void changeHotkey(sc)} clearable placeholder={t("rec.none")} />
        {status ? <div className={status.ok ? "inline-ok" : "inline-err"}>{status.text}</div> : null}
        <div className="help">{t("dict.hotkeyHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("dict.mode")}</h2>
        <div className="choice-grid">
          <button className={"choice" + (!d.toggle ? " active" : "")} onClick={() => set({ toggle: false })}>
            <span className="choice-label">{t("dict.hold")}</span>
            <span className="choice-hint">{t("dict.holdHint")}</span>
          </button>
          <button className={"choice" + (d.toggle ? " active" : "")} onClick={() => set({ toggle: true })}>
            <span className="choice-label">{t("dict.toggle")}</span>
            <span className="choice-hint">{t("dict.toggleHint")}</span>
          </button>
        </div>
      </section>

      <section className="section">
        <h2>{t("dict.provider")}</h2>
        <div className="choice-grid">
          {PROVIDERS.map((p) => (
            <button key={p.id} className={"choice" + (d.provider === p.id ? " active" : "")} onClick={() => set({ provider: p.id })}>
              <span className="choice-label">{providerInfo(p.id).name}</span>
              <span className="choice-hint">{t(p.hint)}</span>
            </button>
          ))}
        </div>
        <div className={keys[d.provider] ? "inline-ok" : "inline-err"}>
          {keys[d.provider] ? t("dict.keySaved", { name }) : t("dict.keyMissing", { name })} <span className="help" style={{ display: "inline" }}>· {STT_MODELS[d.provider]}</span>
        </div>
      </section>

      <section className="section">
        <h2>{t("dict.device")}</h2>
        <div className="field">
          <select value={mics.includes(d.device) ? d.device : ""} onChange={(e) => set({ device: e.target.value })} aria-label={t("dict.device")} style={{ maxWidth: 420 }}>
            <option value="">{t("dict.deviceDefault")}</option>
            {mics.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="help">{t("dict.deviceHelp")}</div>
        </div>
      </section>

      <section className="section">
        <h2>{t("dict.language")}</h2>
        <div className="segmented" role="radiogroup" aria-label={t("dict.language")}>
          {(["auto", "it", "en"] as const).map((l) => (
            <button key={l} role="radio" aria-checked={d.language === l} className={d.language === l ? "active" : ""} onClick={() => set({ language: l })}>
              {l === "auto" ? t("dict.langAuto") : t(`lang.${l}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <label className="switch-row">
          <span>{t("dict.cleanup")}</span>
          <button type="button" role="switch" aria-checked={d.cleanup} className={"switch" + (d.cleanup ? " on" : "")} onClick={() => set({ cleanup: !d.cleanup })}>
            <span className="knob" />
          </button>
        </label>
        <div className="help">{t("dict.cleanupHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("dict.vocabulary")}</h2>
        <div className="field">
          <textarea rows={2} placeholder={t("dict.vocabularyPh")} value={d.vocabulary} onChange={(e) => set({ vocabulary: e.target.value })} aria-label={t("dict.vocabulary")} />
          <div className="help">{t("dict.vocabularyHelp")}</div>
        </div>
      </section>
    </>
  );
}
