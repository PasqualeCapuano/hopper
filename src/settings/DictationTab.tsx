import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { applyHotkeys, prettyShortcut } from "../lib/hotkeys";
import { providerInfo } from "../lib/providers";
import { deleteSecret, getSecret, setSecret } from "../lib/secrets";
import { openUrl } from "@tauri-apps/plugin-opener";
import { STT_MODELS } from "../lib/dictation";
import type { DictationSettings, Settings, SttProvider } from "../lib/settings";
import HotkeyRecorder from "./HotkeyRecorder";

const METER_SHAPE = [0.35, 0.6, 0.85, 1, 0.85, 1, 0.7, 0.9, 0.6, 0.4, 0.75, 0.5];

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
  const [test, setTest] = useState<{ busy: boolean; text: string; ok?: boolean } | null>(null);
  const [level, setLevel] = useState(0);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyMsg, setKeyMsg] = useState<string | null>(null);

  const refreshKeys = () =>
    Promise.all(PROVIDERS.map(async (p) => [p.id, !!(await getSecret(p.id))] as const)).then((e) => setKeys(Object.fromEntries(e)));

  const saveKey = async () => {
    const k = keyDraft.trim();
    if (!k) return;
    await setSecret(d.provider, k);
    setKeyDraft("");
    setKeyMsg(t("dict.keyStored"));
    await refreshKeys();
  };
  const removeKey = async () => {
    await deleteSecret(d.provider);
    setKeyMsg(null);
    await refreshKeys();
  };
  const [peakSeen, setPeakSeen] = useState(0);

  // Live level while the test records, so the bars move as you speak.
  useEffect(() => {
    if (!test?.busy) return;
    setLevel(0);
    setPeakSeen(0);
    const un = listen<{ level: number }>("dictation-level", (e) => {
      setLevel(e.payload.level);
      setPeakSeen((p) => Math.max(p, e.payload.level));
    });
    return () => { void un.then((f) => f()); };
  }, [test?.busy]);

  const testMic = async () => {
    setTest({ busy: true, text: t("dict.testing") });
    try {
      const r = await invoke<{ device: string; rate: number; peak: number; seconds: number }>("dictation_test", { seconds: 3 });
      const ok = r.peak >= 0.004;
      setTest({ busy: false, ok, text: (ok ? t("dict.testOk") : t("dict.testSilent")) + ` · ${r.device} · ${r.rate} Hz · peak ${r.peak.toFixed(3)} · ${r.seconds.toFixed(1)} s` });
    } catch (err) {
      setTest({ busy: false, ok: false, text: String(err) });
    }
  };

  useEffect(() => {
    void invoke<string[]>("list_microphones").then(setMics).catch(() => setMics([]));
    void refreshKeys();
  }, []);

  useEffect(() => {
    setKeyDraft("");
    setKeyMsg(null);
  }, [d.provider]);

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
        <div className="help">{t("dict.keyNote", { name })} · {STT_MODELS[d.provider]}</div>
        {keys[d.provider] ? (
          <div className="btn-row">
            <span className="inline-ok">{t("dict.keySaved", { name })}</span>
            <button className="btn small" onClick={() => void removeKey()}>{t("acc.remove")}</button>
            {keyMsg ? <span className="help">{keyMsg}</span> : null}
          </div>
        ) : (
          <div className="field">
            <div className="btn-row">
              <input className="mono" type="password" placeholder={providerInfo(d.provider).keyPlaceholder} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} style={{ flexGrow: 1, maxWidth: 420 }} aria-label={t("dict.keyLabel", { name })} />
              <button className="btn primary small" onClick={() => void saveKey()} disabled={!keyDraft.trim()}>{t("nav.save")}</button>
            </div>
            <div className="help">
              {t("dict.keyMissingShort", { name })}
              {providerInfo(d.provider).keyUrl ? <> <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(providerInfo(d.provider).keyUrl!); }}>{t("acc.createHere")}</a>.</> : null}
            </div>
          </div>
        )}
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
        <div className="btn-row">
          <button className="btn small" onClick={() => void testMic()} disabled={test?.busy}>{t("dict.test")}</button>
          {test?.busy ? (
            <div className={"mic-meter" + (peakSeen > 0.05 ? " live" : "")} aria-hidden="true">
              {METER_SHAPE.map((k, i) => (
                <span key={i} className="dict-bar" style={{ transform: `scaleY(${(0.12 + Math.min(1, level * 1.4) * 0.88 * k).toFixed(3)})` }} />
              ))}
            </div>
          ) : null}
          {test ? <span className={test.busy ? (peakSeen > 0.05 ? "inline-ok" : "help") : test.ok ? "inline-ok" : "inline-err"}>{test.busy && peakSeen > 0.05 ? t("dict.testHearing") : test.text}</span> : null}
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
