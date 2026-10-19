import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { clearThreads, listThreads } from "../lib/history";
import { applyTheme, type Theme } from "../lib/theme";
import type { Settings } from "../lib/settings";

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
  const [auto, setAuto] = useState(s.autostart);
  const [acc, setAcc] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");
  const [dataDir, setDataDir] = useState("");
  const [threads, setThreads] = useState<number | null>(null);
  const [upd, setUpd] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    void isEnabled().then(setAuto).catch(() => {});
    void invoke<boolean>("accessibility_granted").then(setAcc);
    void getVersion().then(setVersion).catch(() => {});
    void appDataDir().then(setDataDir).catch(() => {});
    void listThreads().then((t) => setThreads(t.length)).catch(() => setThreads(0));
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

  const setTheme = (t: Theme) => {
    update({ theme: t });
    void applyTheme(t);
  };

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

  const requestAccessibility = async () => {
    await invoke("accessibility_prompt");
    setAcc(await invoke<boolean>("accessibility_granted"));
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
        <h1>Generale</h1>
        <div className="lead">Hopper vive nella barra dei menu. Nessun server: testi, chiavi e cronologia restano sul tuo computer.</div>
      </div>

      <section className="section">
        <h2>Avvio</h2>
        <Switch checked={auto} onChange={(v) => void toggleAuto(v)} label="Avvia Hopper al login" />
        <div className="help">Resta in attesa della hotkey senza finestre aperte. Puoi chiuderla in qualsiasi momento dal menu nella barra.</div>
      </section>

      <section className="section">
        <h2>Aspetto</h2>
        <div className="segmented" role="radiogroup" aria-label="Tema">
          {([["system", "Sistema"], ["light", "Chiaro"], ["dark", "Scuro"]] as [Theme, string][]).map(([t, label]) => (
            <button key={t} role="radio" aria-checked={s.theme === t} className={s.theme === t ? "active" : ""} onClick={() => setTheme(t)}>{label}</button>
          ))}
        </div>
        <div className="help">Il popup è traslucido e lascia intravedere ciò che c'è sotto. "Sistema" segue l'aspetto di macOS o Windows.</div>
      </section>

      {IS_MAC ? (
        <section className="section">
          <h2>Permessi</h2>
          <div className="status-row">
            <span>Accessibilità</span>
            <span className={"status-pill" + (acc ? " ok" : acc === false ? " warn" : "")}>{acc === null ? "…" : acc ? "Concesso" : "Non concesso"}</span>
            {acc === false ? <button className="btn small" onClick={() => void requestAccessibility()}>Richiedi</button> : null}
          </div>
          <div className="help">Serve solo per "Incolla nell'app": Hopper preme ⌘V al posto tuo. Tutto il resto funziona senza. Si concede in Impostazioni di Sistema › Privacy e sicurezza › Accessibilità.</div>
        </section>
      ) : null}

      <section className="section">
        <h2>Aggiornamenti</h2>
        <div className="status-row">
          <span>Versione installata</span>
          <span className="status-pill">{version ? `v${version}` : "…"}</span>
          <button className="btn small" onClick={() => void checkUpdates()}>Controlla ora</button>
          {upd ? <span className="help">{upd}</span> : null}
        </div>
        <div className="help">Hopper controlla da sola all'avvio e ti avvisa nel popup. Gli aggiornamenti arrivano da GitHub e sono firmati.</div>
      </section>

      <section className="section">
        <h2>Dati</h2>
        <div className="status-row">
          <span>Cronologia</span>
          <span className="status-pill">{threads === null ? "…" : `${threads} thread`}</span>
          <button className="btn small" onClick={() => void wipeHistory()} disabled={!threads}>Cancella</button>
          {cleared ? <span className="inline-ok">Cronologia cancellata</span> : null}
        </div>
        <div className="help">Gli ultimi 30 thread restano in locale e si riaprono da "Continua in chat".</div>
        <div className="status-row">
          <span>Cartella dei dati</span>
          <code className="path">{dataDir || "…"}</code>
          <button className="btn small" onClick={() => void openPath(dataDir)} disabled={!dataDir}>Apri</button>
        </div>
        <div className="help">Contiene impostazioni, cronologia e chiavi (leggibili solo dal tuo utente). Cancellarla azzera tutto.</div>
      </section>

      <section className="section">
        <h2>Informazioni</h2>
        <div className="help">Hopper è open source con licenza MIT. Fatta da Pasquale Capuano con Tauri, Rust e React.</div>
        <div className="btn-row">
          <button className="btn small" onClick={() => void openUrl(REPO)}>Codice su GitHub</button>
          <button className="btn small" onClick={() => void openUrl(`${REPO}/issues/new`)}>Segnala un problema</button>
          <button className="btn small" onClick={() => void openUrl(`${REPO}/releases`)}>Novità delle versioni</button>
        </div>
      </section>
    </>
  );
}
