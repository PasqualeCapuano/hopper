import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { AiError, testConnection } from "../lib/ai";
import { deleteSecret, getSecret, setSecret } from "../lib/secrets";
import {
  ANTHROPIC_MODELS,
  DEFAULT_ACTIONS,
  loadSettings,
  saveSettings,
  type Provider,
  type QuickAction,
  type Settings as SettingsModel,
} from "../lib/settings";

type Tab = "account" | "hotkey" | "actions" | "general";

const PROVIDER_INFO: Record<Provider, { name: string; desc: string; url: string; placeholder: string }> = {
  anthropic: {
    name: "Anthropic · Claude",
    desc: "Chiave da console.anthropic.com. Con Max hai crediti API inclusi.",
    url: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-api03-…",
  },
  openai: {
    name: "OpenAI",
    desc: "Chiave da platform.openai.com.",
    url: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
};

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
  const [hasKey, setHasKey] = useState<Record<Provider, boolean>>({ anthropic: false, openai: false });
  const [replacing, setReplacing] = useState(false);
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [keychainError, setKeychainError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [a, o] = await Promise.all([getSecret("anthropic"), getSecret("openai")]);
      setHasKey({ anthropic: !!a, openai: !!o });
      setKeychainError(null);
    } catch (err) {
      setKeychainError(`Non riesco a leggere le chiavi salvate: ${String(err)}`);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const info = PROVIDER_INFO[s.provider];
  const saved = hasKey[s.provider];
  const editing = !saved || replacing;

  const onKeyChange = (v: string) => {
    setKey(v);
    onPendingKey(v.trim() ? { provider: s.provider, key: v } : null);
  };

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

  const remove = async () => {
    await deleteSecret(s.provider);
    await refresh();
    setStatus({ ok: true, text: "Chiave rimossa." });
  };

  return (
    <>
      <div>
        <h1>Account e modello</h1>
        <div className="lead">Hopper usa una API key a consumo, salvata in un file leggibile solo dal tuo utente, sul tuo computer. Gli abbonamenti Claude Pro/Max e ChatGPT Plus non si possono collegare da app di terze parti, ma con Max hai crediti API mensili inclusi.</div>
      </div>
      {keychainError ? <div className="inline-err">{keychainError}</div> : null}
      <div className="grid-2">
        {(["anthropic", "openai"] as Provider[]).map((p) => (
          <button key={p} className={"provider-card" + (s.provider === p ? " active" : "")} onClick={() => { update({ provider: p }); setStatus(null); setReplacing(false); setKey(""); onPendingKey(null); }}>
            <span className="name">{PROVIDER_INFO[p].name}</span>
            <span className="desc">{PROVIDER_INFO[p].desc}</span>
            <span className={"state" + (hasKey[p] ? " ok" : "")}>{hasKey[p] ? "Chiave salvata" : "Nessuna chiave"}</span>
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="key">API key {info.name}</label>
        {editing ? (
          <>
            <div className="btn-row">
              <input id="key" className="mono" type={show ? "text" : "password"} placeholder={info.placeholder} value={key} onChange={(e) => onKeyChange(e.target.value)} style={{ flexGrow: 1 }} autoFocus={replacing} />
              <button className="btn" onClick={() => setShow(!show)}>{show ? "Nascondi" : "Mostra"}</button>
              <button className="btn primary" onClick={() => void saveAndTest()} disabled={!key.trim()}>Prova e salva</button>
            </div>
            <div className="help">
              <a href="#" onClick={(e) => { e.preventDefault(); void saveOnly(); }} style={{ pointerEvents: key.trim() ? "auto" : "none", opacity: key.trim() ? 1 : 0.5 }}>Salva senza verificare</a>
              {" · "}Non hai una chiave? <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(info.url); }}>Creala qui</a>.
              {replacing ? <> · <a href="#" onClick={(e) => { e.preventDefault(); setReplacing(false); setKey(""); onPendingKey(null); }}>Annulla</a></> : null}
            </div>
          </>
        ) : (
          <>
            <div className="btn-row">
              <input id="key" className="mono" type="text" readOnly value={"••••••••••••••••••••••••  salvata"} style={{ flexGrow: 1, color: "var(--muted)" }} />
              <button className="btn" onClick={() => { setReplacing(true); setStatus(null); }}>Sostituisci</button>
              <button className="btn" onClick={() => void remove()}>Rimuovi</button>
            </div>
            <div className="help">La chiave non viene mai mostrata: per cambiarla incollane una nuova.</div>
          </>
        )}
        {status ? <div className={status.ok ? "inline-ok" : "inline-err"}>{status.text}</div> : null}
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="model">Modello</label>
          {s.provider === "anthropic" ? (
            <select id="model" value={s.anthropicModel} onChange={(e) => update({ anthropicModel: e.target.value })}>
              {ANTHROPIC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : (
            <input id="model" className="mono" value={s.openaiModel} onChange={(e) => update({ openaiModel: e.target.value })} />
          )}
        </div>
        <div className="field">
          <label htmlFor="effort">Profondità di ragionamento</label>
          <select id="effort" value={s.effort} onChange={(e) => update({ effort: e.target.value as SettingsModel["effort"] })} disabled={s.provider !== "anthropic"}>
            <option value="low">Bassa · risposte rapide</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
        </div>
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
  const [draft, setDraft] = useState(s.hotkey);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = async () => {
    try {
      await invoke("set_hotkey", { hotkey: draft.trim() });
      update({ hotkey: draft.trim() });
      setStatus({ ok: true, text: "Scorciatoia attiva. Ricorda di salvare." });
    } catch (err) {
      setStatus({ ok: false, text: `Combinazione non valida: ${String(err)}` });
    }
  };

  return (
    <>
      <div>
        <h1>Scorciatoie</h1>
        <div className="lead">La hotkey globale apre il popup sopra qualsiasi finestra e legge la clipboard in quel momento.</div>
      </div>
      <div className="field">
        <label htmlFor="hk">Hotkey globale</label>
        <div className="btn-row">
          <input id="hk" className="mono" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 260 }} />
          <button className="btn primary" onClick={() => void apply()}>Applica</button>
        </div>
        {status ? <div className={status.ok ? "inline-ok" : "inline-err"}>{status.text}</div> : null}
        <div className="help">Formato: tasti separati da +. Esempi: Alt+Space, CommandOrControl+Shift+K, Ctrl+Alt+A.</div>
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
