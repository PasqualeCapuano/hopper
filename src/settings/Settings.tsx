import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { AiError, listModels, testConnection } from "../lib/ai";
import { PROVIDERS, providerInfo } from "../lib/providers";
import { applyHotkeys, prettyShortcut } from "../lib/hotkeys";
import HotkeyRecorder from "./HotkeyRecorder";
import { deleteSecret, getSecret, setSecret } from "../lib/secrets";
import {
  ANTHROPIC_MODELS,
  DEFAULT_ACTIONS,
  loadSettings,
  modelFor,
  saveSettings,
  type Provider,
  type QuickAction,
  type Settings as SettingsModel,
} from "../lib/settings";

type Tab = "account" | "hotkey" | "actions" | "general";

export default function Settings() {
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
    void loadSettings().then(setS);
  }, []);

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
        <div className="label">IMPOSTAZIONI</div>
        <button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}>Account e modello</button>
        <button className={tab === "hotkey" ? "active" : ""} onClick={() => setTab("hotkey")}>Scorciatoie</button>
        <button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>Azioni rapide</button>
        <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>Generale</button>
        <div className="version">Hopper {version ? `v${version}` : ""}</div>
      </nav>
      <main className="settings-main">
        {tab === "account" && <AccountTab key={keyVersion} s={s} update={update} onPendingKey={setPendingKey} />}
        {tab === "hotkey" && <HotkeyTab s={s} update={update} />}
        {tab === "actions" && <ActionsTab s={s} update={update} />}
        {tab === "general" && <GeneralTab s={s} update={update} />}
        <div className="btn-row" style={{ marginTop: "auto" }}>
          <div className="spacer" />
          {saved ? <span className="inline-ok">Salvato</span> : null}
          <button className="btn primary" onClick={() => void save()}>Salva</button>
        </div>
      </main>
    </div>
  );
}

function AccountTab({ s, update, onPendingKey }: { s: SettingsModel; update: (p: Partial<SettingsModel>) => void; onPendingKey: (p: { provider: Provider; key: string } | null) => void }) {
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
      setStoreError(`Non riesco a leggere le chiavi salvate: ${String(err)}`);
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
    setStatus({ ok: true, text: "Verifico la chiave…" });
    try {
      await testConnection(s, k);
      await setSecret(s.provider, k);
      setKey("");
      onPendingKey(null);
      setReplacing(false);
      await refresh();
      setStatus({ ok: true, text: "Connessione riuscita. Chiave salvata." });
    } catch (err) {
      const msg = err instanceof AiError ? err.message : String(err);
      setStatus({ ok: false, text: `${msg}. La chiave non è stata salvata.` });
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
      setStatus({ ok: true, text: "Chiave salvata (non verificata)." });
    } catch (err) {
      setStatus({ ok: false, text: `Salvataggio fallito: ${String(err)}` });
    }
  };

  const testOnly = async () => {
    setStatus({ ok: true, text: "Provo a contattare il server…" });
    try {
      await testConnection(s, await currentKey());
      setStatus({ ok: true, text: `Connessione riuscita con ${model}.` });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof AiError ? err.message : String(err) });
    }
  };

  const remove = async () => {
    await deleteSecret(s.provider);
    await refresh();
    setStatus({ ok: true, text: "Chiave rimossa." });
  };

  const loadModels = async () => {
    setModelsStatus("Carico l'elenco…");
    try {
      const ids = await listModels(s, await currentKey());
      setModels(ids);
      setModelsStatus(ids.length ? `${ids.length} modelli disponibili` : "Nessun modello: scaricane uno prima.");
      if (!model && ids.length) setModel(ids[0]);
    } catch (err) {
      setModelsStatus(err instanceof AiError ? err.message : String(err));
    }
  };

  return (
    <>
      <div>
        <h1>Account e modello</h1>
        <div className="lead">Hopper usa la tua chiave API, salvata in un file leggibile solo dal tuo utente, o un modello che gira sul tuo computer. Gli abbonamenti Claude Pro/Max e ChatGPT Plus non si possono collegare da app di terze parti; con Claude Max hai crediti API mensili inclusi.</div>
      </div>
      {storeError ? <div className="inline-err">{storeError}</div> : null}
      <div className="provider-grid">
        {PROVIDERS.map((p) => (
          <button key={p.id} className={"provider-card" + (s.provider === p.id ? " active" : "")} onClick={() => { update({ provider: p.id }); setStatus(null); setReplacing(false); setKey(""); onPendingKey(null); }}>
            <span className="name">{p.name}</span>
            <span className={"state" + (p.needsKey ? (hasKey[p.id] ? " ok" : "") : " ok")}>{p.local ? "Locale" : p.needsKey ? (hasKey[p.id] ? "Chiave salvata" : "Nessuna chiave") : "Senza chiave"}</span>
          </button>
        ))}
      </div>
      <div className="help">{info.desc}</div>

      {info.id === "custom" ? (
        <div className="field">
          <label htmlFor="base">URL dell'endpoint</label>
          <input id="base" className="mono" placeholder="https://esempio.com/v1" value={s.customBaseUrl} onChange={(e) => update({ customBaseUrl: e.target.value })} />
          <div className="help">Qualsiasi server che espone l'API chat completions di OpenAI. La chiave sotto è facoltativa.</div>
        </div>
      ) : null}

      {info.needsKey || info.id === "custom" ? (
        <div className="field">
          <label htmlFor="key">API key {info.name}</label>
          {editing || (info.id === "custom" && (!saved || replacing)) ? (
            <>
              <div className="btn-row">
                <input id="key" className="mono" type={show ? "text" : "password"} placeholder={info.keyPlaceholder} value={key} onChange={(e) => onKeyChange(e.target.value)} style={{ flexGrow: 1 }} autoFocus={replacing} />
                <button className="btn" onClick={() => setShow(!show)}>{show ? "Nascondi" : "Mostra"}</button>
                <button className="btn primary" onClick={() => void saveAndTest()} disabled={!key.trim()}>Prova e salva</button>
              </div>
              <div className="help">
                <a href="#" onClick={(e) => { e.preventDefault(); void saveOnly(); }} style={{ pointerEvents: key.trim() ? "auto" : "none", opacity: key.trim() ? 1 : 0.5 }}>Salva senza verificare</a>
                {info.keyUrl ? <>{" · "}Non hai una chiave? <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(info.keyUrl!); }}>Creala qui</a>.</> : null}
                {replacing ? <> · <a href="#" onClick={(e) => { e.preventDefault(); setReplacing(false); setKey(""); onPendingKey(null); }}>Annulla</a></> : null}
              </div>
            </>
          ) : (
            <>
              <div className="btn-row">
                <input id="key" className="mono" type="text" readOnly value={"••••••••••••••••••••••••  salvata"} style={{ flexGrow: 1, color: "var(--muted)" }} />
                <button className="btn" onClick={() => { setReplacing(true); setStatus(null); }}>Sostituisci</button>
                <button className="btn" onClick={() => void remove()}>Rimuovi</button>
                <button className="btn" onClick={() => void testOnly()}>Prova</button>
              </div>
              <div className="help">La chiave non viene mai mostrata: per cambiarla incollane una nuova.</div>
            </>
          )}
        </div>
      ) : (
        <div className="field">
          <label>Server locale</label>
          <div className="btn-row">
            <button className="btn" onClick={() => void testOnly()}>Prova connessione</button>
            {info.keyUrl ? <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(info.keyUrl!); }}>Scarica {info.name}</a> : null}
          </div>
          <div className="help">Nessuna chiave: Hopper parla con {info.name} su {info.baseURL}. I testi non lasciano il computer.</div>
        </div>
      )}
      {status ? <div className={status.ok ? "inline-ok" : "inline-err"}>{status.text}</div> : null}

      <div className="grid-2">
        <div className="field">
          <label htmlFor="model">Modello</label>
          {s.provider === "anthropic" ? (
            <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
              {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : models.length ? (
            <select id="model" value={models.includes(model) ? model : ""} onChange={(e) => setModel(e.target.value)}>
              {!models.includes(model) ? <option value="">{model || "Scegli…"}</option> : null}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input id="model" className="mono" placeholder={info.defaultModel || "nome del modello"} value={s.models[s.provider] ?? ""} onChange={(e) => setModel(e.target.value)} />
          )}
          {s.provider !== "anthropic" ? (
            <div className="help">
              <a href="#" onClick={(e) => { e.preventDefault(); void loadModels(); }}>Carica l'elenco dal provider</a>
              {modelsStatus ? <> · {modelsStatus}</> : null}
            </div>
          ) : null}
        </div>
        {s.provider === "anthropic" ? (
          <div className="field">
            <label htmlFor="effort">Profondità di ragionamento</label>
            <select id="effort" value={s.effort} onChange={(e) => update({ effort: e.target.value as SettingsModel["effort"] })}>
              <option value="low">Bassa · risposte rapide</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="sys">Istruzioni per il tuo agente</label>
        <textarea id="sys" rows={4} value={s.systemPrompt} onChange={(e) => update({ systemPrompt: e.target.value })} />
        <div className="help">Vale per ogni richiesta: chi sei, lingua, tono.</div>
      </div>
    </>
  );
}

function HotkeyTab({ s, update }: { s: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async (shortcut: string) => {
    const next = { ...s, hotkey: shortcut };
    update({ hotkey: shortcut });
    try {
      const failed = await applyHotkeys(next);
      if (failed.includes("open")) {
        setStatus({ ok: false, text: `${prettyShortcut(shortcut)} non è disponibile: probabilmente la usa già un'altra app. Scegline un'altra.` });
      } else {
        setStatus({ ok: true, text: `${prettyShortcut(shortcut)} è attiva. Premi Salva per tenerla.` });
      }
    } catch (err) {
      setStatus({ ok: false, text: String(err) });
    }
  };

  const withShortcut = s.actions.filter((a) => a.shortcut);

  return (
    <>
      <div>
        <h1>Scorciatoie</h1>
        <div className="lead">La hotkey globale apre il popup sopra qualsiasi finestra e legge la clipboard in quel momento. Clicca sul campo e premi la combinazione che vuoi.</div>
      </div>
      <div className="field">
        <label>Apri Hopper</label>
        <HotkeyRecorder value={s.hotkey} onChange={(sc) => void change(sc)} />
        {status ? <div className={status.ok ? "inline-ok" : "inline-err"}>{status.text}</div> : null}
        <div className="help">Serve almeno un modificatore (⌘, ⌃, ⌥ o ⇧), oppure un tasto funzione. Alcune combinazioni sono riservate dal sistema o da altre app.</div>
      </div>
      <div className="field">
        <label>Azioni rapide con scorciatoia</label>
        {withShortcut.length ? (
          <div className="shortcut-list">
            {withShortcut.map((a) => (
              <div key={a.id} className="shortcut-row"><span>{a.label}</span><span className="kbd">{prettyShortcut(a.shortcut!)}</span></div>
            ))}
          </div>
        ) : null}
        <div className="help">Ogni azione rapida può avere la sua combinazione: apre il popup ed esegue subito l'azione sul testo copiato. Si impostano in Azioni rapide.</div>
      </div>
      <div className="field">
        <label>Nel popup</label>
        <div className="help">1–6 lancia un'azione rapida · ↵ invia o copia · ⌘↵ incolla nell'app · Esc chiude.</div>
      </div>
    </>
  );
}

function ActionsTab({ s, update }: { s: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const [selected, setSelected] = useState(0);
  const action = s.actions[selected];

  const patch = (p: Partial<QuickAction>) => {
    const actions = s.actions.map((a, i) => (i === selected ? { ...a, ...p } : a));
    update({ actions });
  };
  const add = () => {
    const a: QuickAction = { id: `custom-${Date.now()}`, label: "Nuova azione", prompt: "…\n\n{{testo}}", output: "show" };
    update({ actions: [...s.actions, a] });
    setSelected(s.actions.length);
  };
  const remove = () => {
    const actions = s.actions.filter((_, i) => i !== selected);
    update({ actions });
    setSelected(Math.max(0, selected - 1));
  };
  const move = (dir: -1 | 1) => {
    const j = selected + dir;
    if (j < 0 || j >= s.actions.length) return;
    const actions = [...s.actions];
    [actions[selected], actions[j]] = [actions[j], actions[selected]];
    update({ actions });
    setSelected(j);
  };

  return (
    <>
      <div>
        <h1>Azioni rapide</h1>
        <div className="lead">Le prime 6 compaiono nel popup, con i tasti 1–6. Il prompt riceve il testo copiato al posto di {"{{testo}}"}.</div>
      </div>
      <div className="actions-layout">
        <div className="actions-list">
          {s.actions.map((a, i) => (
            <button key={a.id} className={i === selected ? "active" : ""} onClick={() => setSelected(i)}>
              <span>{a.label}</span>
              {i < 6 ? <span className="num">{i + 1}</span> : null}
            </button>
          ))}
          <div className="btn-row">
            <button className="btn small" onClick={add}>+ Nuova</button>
            <button className="btn small" onClick={() => update({ actions: DEFAULT_ACTIONS })}>Ripristina</button>
          </div>
        </div>
        {action ? (
          <div className="actions-editor">
            <div className="field">
              <label htmlFor="al">Nome</label>
              <input id="al" value={action.label} onChange={(e) => patch({ label: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ap">Prompt</label>
              <textarea id="ap" rows={7} className="mono" value={action.prompt} onChange={(e) => patch({ prompt: e.target.value })} />
            </div>
            <div className="field">
              <label>Scorciatoia globale</label>
              <HotkeyRecorder value={action.shortcut ?? ""} onChange={(sc) => patch({ shortcut: sc || undefined })} clearable placeholder="Nessuna" />
              <div className="help">Premila in qualsiasi app: apre il popup ed esegue questa azione sul testo copiato. Attiva dopo Salva.</div>
            </div>
            <div className="field">
              <label htmlFor="ao">Dopo la risposta</label>
              <select id="ao" value={action.output} onChange={(e) => patch({ output: e.target.value as QuickAction["output"] })}>
                <option value="show">Mostra nel popup</option>
                <option value="copy">Copia subito</option>
                <option value="paste">Incolla subito nell'app</option>
              </select>
            </div>
            <div className="btn-row">
              <button className="btn small danger" onClick={remove}>Elimina</button>
              <div className="spacer" />
              <button className="btn small" onClick={() => move(-1)}>↑ Su</button>
              <button className="btn small" onClick={() => move(1)}>↓ Giù</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function GeneralTab({ s, update }: { s: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const [auto, setAuto] = useState(s.autostart);
  const [acc, setAcc] = useState<boolean | null>(null);
  const [upd, setUpd] = useState<string | null>(null);

  const checkUpdates = async () => {
    setUpd("Controllo…");
    try {
      const u = await check();
      if (!u) { setUpd("Hai già l'ultima versione."); return; }
      setUpd(`Scarico la versione ${u.version}…`);
      await u.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setUpd(`Controllo non riuscito: ${String(err)}`);
    }
  };

  useEffect(() => {
    void isEnabled().then(setAuto).catch(() => {});
    void invoke<boolean>("accessibility_granted").then(setAcc);
  }, []);

  const toggleAuto = async () => {
    if (auto) await disable();
    else await enable();
    setAuto(!auto);
    update({ autostart: !auto });
  };

  return (
    <>
      <div>
        <h1>Generale</h1>
        <div className="lead">L'app vive nella barra dei menu. Nessun server: testi e chiavi restano sul tuo computer.</div>
      </div>
      <div className="field">
        <label className="toggle"><input type="checkbox" checked={auto} onChange={() => void toggleAuto()} /> Avvia al login</label>
      </div>
      <div className="field">
        <label>Permesso Accessibilità (macOS)</label>
        <div className="help">Serve solo per "Incolla nell'app". {acc === null ? "" : acc ? "Concesso." : "Non concesso."}</div>
        {acc === false ? <div><button className="btn small" onClick={() => void invoke("accessibility_prompt").then(() => invoke<boolean>("accessibility_granted")).then(setAcc)}>Richiedi permesso</button></div> : null}
      </div>
      <div className="field">
        <label>Aggiornamenti</label>
        <div className="help">Hopper controlla da sola all'avvio e ti avvisa nel popup. Gli aggiornamenti arrivano da GitHub e sono firmati.</div>
        <div className="btn-row"><button className="btn small" onClick={() => void checkUpdates()}>Controlla ora</button>{upd ? <span className="help">{upd}</span> : null}</div>
      </div>
      <div className="field">
        <label>Cronologia</label>
        <div className="help">Gli ultimi 30 thread sono salvati in locale e si riaprono da "Continua in chat".</div>
      </div>
    </>
  );
}
