import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AiError, listModels, testConnection } from "../lib/ai";
import { PROVIDERS, providerInfo } from "../lib/providers";
import { applyHotkeys, prettyShortcut } from "../lib/hotkeys";
import HotkeyRecorder from "./HotkeyRecorder";
import ActionsTab from "./ActionsTab";
import GeneralTab from "./GeneralTab";
import ProfileTab from "./ProfileTab";
import { applyTheme } from "../lib/theme";
import { deleteSecret, getSecret, setSecret } from "../lib/secrets";
import {
  ANTHROPIC_MODELS,
  loadSettings,
  modelFor,
  saveSettings,
  type Provider,
  type Settings as SettingsModel,
} from "../lib/settings";

type Tab = "account" | "profile" | "hotkey" | "actions" | "general";

export default function Settings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("account");
  const [s, setS] = useState<SettingsModel | null>(null);
  const [saved, setSaved] = useState(false);
  const [pendingKey, setPendingKey] = useState<{ provider: Provider; key: string } | null>(null);
  const [keyVersion, setKeyVersion] = useState(0);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setS(loaded);
      void applyTheme(loaded.theme);
    });
  }, []);

  // The native title bar follows the interface language.
  useEffect(() => {
    void getCurrentWindow().setTitle(t("window.settings")).catch(() => {});
  }, [t, s?.locale]);

  if (!s) return null;

  const update = (patch: Partial<SettingsModel>) => {
    setS({ ...s, ...patch });
    setSaved(false);
  };

  const save = async () => {
    await saveSettings(s);
    await applyHotkeys(s).catch(() => []);
    if (pendingKey && pendingKey.key.trim()) {
      await setSecret(pendingKey.provider, pendingKey.key.trim());
      setPendingKey(null);
      setKeyVersion((v) => v + 1);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="settings glass">
      <nav className="settings-nav">
        <div className="label">{t("nav.label")}</div>
        <button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}>{t("nav.account")}</button>
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>{t("nav.profile")}</button>
        <button className={tab === "hotkey" ? "active" : ""} onClick={() => setTab("hotkey")}>{t("nav.hotkey")}</button>
        <button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>{t("nav.actions")}</button>
        <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>{t("nav.general")}</button>
        <div className="version">Hopper {version ? `v${version}` : ""}</div>
      </nav>
      <main className="settings-main">
        {tab === "account" && <AccountTab key={keyVersion} s={s} update={update} onPendingKey={setPendingKey} />}
        {tab === "profile" && <ProfileTab s={s} update={update} />}
        {tab === "hotkey" && <HotkeyTab s={s} update={update} />}
        {tab === "actions" && <ActionsTab s={s} update={update} />}
        {tab === "general" && <GeneralTab s={s} update={update} />}
        <div className="btn-row" style={{ marginTop: "auto" }}>
          <div className="spacer" />
          {saved ? <span className="inline-ok">{t("nav.saved")}</span> : null}
          <button className="btn primary" onClick={() => void save()}>{t("nav.save")}</button>
        </div>
      </main>
    </div>
  );
}

function AccountTab({ s, update, onPendingKey }: { s: SettingsModel; update: (p: Partial<SettingsModel>) => void; onPendingKey: (p: { provider: Provider; key: string } | null) => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState<Partial<Record<Provider, boolean>>>({});
  const [replacing, setReplacing] = useState(false);
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsStatus, setModelsStatus] = useState<string | null>(null);

  const info = providerInfo(s.provider);
  const saved = !!hasKey[s.provider];
  const editing = info.needsKey && (!saved || replacing);
  const model = modelFor(s);

  const refresh = async () => {
    try {
      const entries = await Promise.all(
        PROVIDERS.filter((p) => p.needsKey || p.id === "custom").map(async (p) => [p.id, !!(await getSecret(p.id))] as const),
      );
      setHasKey(Object.fromEntries(entries));
      setStoreError(null);
    } catch (err) {
      setStoreError(t("acc.keysReadError", { err: String(err) }));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setModels([]);
    setModelsStatus(null);
  }, [s.provider]);

  const setModel = (m: string) => update({ models: { ...s.models, [s.provider]: m } });

  const onKeyChange = (v: string) => {
    setKey(v);
    onPendingKey(v.trim() ? { provider: s.provider, key: v } : null);
  };

  const currentKey = async () => (key.trim() ? key.trim() : await getSecret(s.provider));

  const saveAndTest = async () => {
    const k = key.trim();
    if (!k) return;
    setStatus({ ok: true, text: t("acc.verifying") });
    try {
      await testConnection(s, k);
      await setSecret(s.provider, k);
      setKey("");
      onPendingKey(null);
      setReplacing(false);
      await refresh();
      setStatus({ ok: true, text: t("acc.connOkSaved") });
    } catch (err) {
      const msg = err instanceof AiError ? err.message : String(err);
      setStatus({ ok: false, text: t("acc.notSaved", { msg }) });
    }
  };

  const saveOnly = async () => {
    const k = key.trim();
    if (!k) return;
    try {
      await setSecret(s.provider, k);
      setKey("");
      onPendingKey(null);
      setReplacing(false);
      await refresh();
      setStatus({ ok: true, text: t("acc.savedUnverified") });
    } catch (err) {
      setStatus({ ok: false, text: t("acc.saveFailed", { err: String(err) }) });
    }
  };

  const testOnly = async () => {
    setStatus({ ok: true, text: t("acc.contacting") });
    try {
      await testConnection(s, await currentKey());
      setStatus({ ok: true, text: t("acc.connOkWith", { model }) });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof AiError ? err.message : String(err) });
    }
  };

  const remove = async () => {
    await deleteSecret(s.provider);
    await refresh();
    setStatus({ ok: true, text: t("acc.removed") });
  };

  const loadModels = async () => {
    setModelsStatus(t("acc.loading"));
    try {
      const ids = await listModels(s, await currentKey());
      setModels(ids);
      setModelsStatus(ids.length ? t("acc.modelsCount", { n: ids.length }) : t("acc.noModels"));
      if (!model && ids.length) setModel(ids[0]);
    } catch (err) {
      setModelsStatus(err instanceof AiError ? err.message : String(err));
    }
  };

  return (
    <>
      <div>
        <h1>{t("acc.title")}</h1>
        <div className="lead">{t("acc.lead")}</div>
      </div>
      {storeError ? <div className="inline-err">{storeError}</div> : null}
      <div className="provider-grid">
        {PROVIDERS.map((p) => (
          <button key={p.id} className={"provider-card" + (s.provider === p.id ? " active" : "")} onClick={() => { update({ provider: p.id }); setStatus(null); setReplacing(false); setKey(""); onPendingKey(null); }}>
            <span className="name">{p.name}</span>
            <span className={"state" + (p.needsKey ? (hasKey[p.id] ? " ok" : "") : " ok")}>{p.local ? t("acc.local") : p.needsKey ? (hasKey[p.id] ? t("acc.keySaved") : t("acc.noKey")) : t("acc.keyless")}</span>
          </button>
        ))}
      </div>
      <div className="help">{info.desc}</div>

      {info.id === "custom" ? (
        <div className="field">
          <label htmlFor="base">{t("acc.endpointUrl")}</label>
          <input id="base" className="mono" placeholder="https://example.com/v1" value={s.customBaseUrl} onChange={(e) => update({ customBaseUrl: e.target.value })} />
          <div className="help">{t("acc.endpointHelp")}</div>
        </div>
      ) : null}

      {info.needsKey || info.id === "custom" ? (
        <div className="field">
          <label htmlFor="key">{t("acc.apiKey", { name: info.name })}</label>
          {editing || (info.id === "custom" && (!saved || replacing)) ? (
            <>
              <div className="btn-row">
                <input id="key" className="mono" type={show ? "text" : "password"} placeholder={info.keyPlaceholder} value={key} onChange={(e) => onKeyChange(e.target.value)} style={{ flexGrow: 1 }} autoFocus={replacing} />
                <button className="btn" onClick={() => setShow(!show)}>{show ? t("acc.hide") : t("acc.show")}</button>
                <button className="btn primary" onClick={() => void saveAndTest()} disabled={!key.trim()}>{t("acc.testSave")}</button>
              </div>
              <div className="help">
                <a href="#" onClick={(e) => { e.preventDefault(); void saveOnly(); }} style={{ pointerEvents: key.trim() ? "auto" : "none", opacity: key.trim() ? 1 : 0.5 }}>{t("acc.saveNoTest")}</a>
                {info.keyUrl ? <>{" · "}{t("acc.noKeyYet")} <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(info.keyUrl!); }}>{t("acc.createHere")}</a>.</> : null}
                {replacing ? <> · <a href="#" onClick={(e) => { e.preventDefault(); setReplacing(false); setKey(""); onPendingKey(null); }}>{t("acc.cancel")}</a></> : null}
              </div>
            </>
          ) : (
            <>
              <div className="btn-row">
                <input id="key" className="mono" type="text" readOnly value={`••••••••••••••••••••••••  ${t("acc.savedMask")}`} style={{ flexGrow: 1, color: "var(--muted)" }} />
                <button className="btn" onClick={() => { setReplacing(true); setStatus(null); }}>{t("acc.replace")}</button>
                <button className="btn" onClick={() => void remove()}>{t("acc.remove")}</button>
                <button className="btn" onClick={() => void testOnly()}>{t("acc.test")}</button>
              </div>
              <div className="help">{t("acc.keyNeverShown")}</div>
            </>
          )}
        </div>
      ) : (
        <div className="field">
          <label>{t("acc.localServer")}</label>
          <div className="btn-row">
            <button className="btn" onClick={() => void testOnly()}>{t("acc.testConn")}</button>
            {info.keyUrl ? <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(info.keyUrl!); }}>{t("acc.download", { name: info.name })}</a> : null}
          </div>
          <div className="help">{t("acc.localHelp", { name: info.name, url: info.baseURL ?? "" })}</div>
        </div>
      )}
      {status ? <div className={status.ok ? "inline-ok" : "inline-err"}>{status.text}</div> : null}

      <div className="grid-2">
        <div className="field">
          <label htmlFor="model">{t("acc.model")}</label>
          {s.provider === "anthropic" ? (
            <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
              {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} · {t(m.tag)}</option>)}
            </select>
          ) : models.length ? (
            <select id="model" value={models.includes(model) ? model : ""} onChange={(e) => setModel(e.target.value)}>
              {!models.includes(model) ? <option value="">{model || t("acc.choose")}</option> : null}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input id="model" className="mono" placeholder={info.defaultModel || t("acc.modelName")} value={s.models[s.provider] ?? ""} onChange={(e) => setModel(e.target.value)} />
          )}
          {s.provider !== "anthropic" ? (
            <div className="help">
              <a href="#" onClick={(e) => { e.preventDefault(); void loadModels(); }}>{t("acc.loadModels")}</a>
              {modelsStatus ? <> · {modelsStatus}</> : null}
            </div>
          ) : null}
        </div>
        {s.provider === "anthropic" ? (
          <div className="field">
            <label htmlFor="effort">{t("acc.effort")}</label>
            <select id="effort" value={s.effort} onChange={(e) => update({ effort: e.target.value as SettingsModel["effort"] })}>
              <option value="low">{t("effort.low")}</option>
              <option value="medium">{t("effort.medium")}</option>
              <option value="high">{t("effort.high")}</option>
            </select>
          </div>
        ) : null}
      </div>
    </>
  );
}

function HotkeyTab({ s, update }: { s: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async (shortcut: string) => {
    const next = { ...s, hotkey: shortcut };
    update({ hotkey: shortcut });
    try {
      const failed = await applyHotkeys(next);
      if (failed.includes("open")) {
        setStatus({ ok: false, text: t("hk.taken", { sc: prettyShortcut(shortcut) }) });
      } else {
        setStatus({ ok: true, text: t("hk.active", { sc: prettyShortcut(shortcut) }) });
      }
    } catch (err) {
      setStatus({ ok: false, text: String(err) });
    }
  };

  const withShortcut = s.actions.filter((a) => a.shortcut);

  return (
    <>
      <div>
        <h1>{t("hk.title")}</h1>
        <div className="lead">{t("hk.lead")}</div>
      </div>
      <div className="field">
        <label>{t("hk.open")}</label>
        <HotkeyRecorder value={s.hotkey} onChange={(sc) => void change(sc)} />
        {status ? <div className={status.ok ? "inline-ok" : "inline-err"}>{status.text}</div> : null}
        <div className="help">{t("hk.help")}</div>
      </div>
      <div className="field">
        <label>{t("hk.actionsLabel")}</label>
        {withShortcut.length ? (
          <div className="shortcut-list">
            {withShortcut.map((a) => (
              <div key={a.id} className="shortcut-row"><span>{a.label}</span><span className="kbd">{prettyShortcut(a.shortcut!)}</span></div>
            ))}
          </div>
        ) : null}
        <div className="help">{t("hk.actionsHelp")}</div>
      </div>
      <div className="field">
        <label>{t("hk.inPopup")}</label>
        <div className="help">{t("hk.inPopupHelp")}</div>
      </div>
    </>
  );
}
