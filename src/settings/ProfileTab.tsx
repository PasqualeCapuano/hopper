import { useState } from "react";
import { composeSystemPrompt, LANGUAGES, LENGTHS, TONES, type Profile } from "../lib/profile";
import type { Settings } from "../lib/settings";

export default function ProfileTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const p = s.profile;
  const set = (patch: Partial<Profile>) => update({ profile: { ...p, ...patch } });

  return (
    <>
      <div>
        <h1>Il tuo assistente</h1>
        <div className="lead">Poche scelte, nessun testo da scrivere. Hopper le trasforma nelle istruzioni che accompagnano ogni richiesta.</div>
      </div>

      <section className="section">
        <h2>Chi sei</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="pn">Nome</label>
            <input id="pn" placeholder="Pasquale" value={p.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pr">Cosa fai</label>
            <input id="pr" placeholder="istruttore di scherma a Dubai" value={p.role} onChange={(e) => set({ role: e.target.value })} />
          </div>
        </div>
        <div className="help">Facoltativi. Servono a dare contesto, per esempio a chi firmare le email o a cosa si riferisce un testo.</div>
      </section>

      <section className="section">
        <h2>Lingua delle risposte</h2>
        <div className="btn-row">
          <div className="segmented" role="radiogroup" aria-label="Lingua">
            {LANGUAGES.map((l) => (
              <button key={l.id} role="radio" aria-checked={p.language === l.id} className={p.language === l.id ? "active" : ""} onClick={() => set({ language: l.id })}>{l.label}</button>
            ))}
          </div>
          {p.language === "other" ? <input className="inline-input" placeholder="es. español" value={p.languageOther} onChange={(e) => set({ languageOther: e.target.value })} aria-label="Altra lingua" /> : null}
        </div>
        <div className="help">"Come il testo" risponde in inglese a un'email in inglese e in italiano a un messaggio in italiano.</div>
      </section>

      <section className="section">
        <h2>Tono</h2>
        <div className="choice-grid">
          {TONES.map((t) => (
            <button key={t.id} className={"choice" + (p.tone === t.id ? " active" : "")} onClick={() => set({ tone: t.id })}>
              <span className="choice-label">{t.label}</span>
              <span className="choice-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Lunghezza</h2>
        <div className="choice-grid">
          {LENGTHS.map((l) => (
            <button key={l.id} className={"choice" + (p.length === l.id ? " active" : "")} onClick={() => set({ length: l.id })}>
              <span className="choice-label">{l.label}</span>
              <span className="choice-hint">{l.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Firma</h2>
        <div className="field">
          <input placeholder={p.name.trim() || "Nome con cui firmare email e messaggi"} value={p.signature} onChange={(e) => set({ signature: e.target.value })} aria-label="Firma" style={{ maxWidth: 420 }} />
          <div className="help">Usata quando un'azione scrive un messaggio per te, come "Rispondi". Vuota: usa il nome.</div>
        </div>
      </section>

      <section className="section">
        <h2>Altro che deve sapere</h2>
        <div className="field">
          <textarea rows={3} placeholder="Facoltativo. Es.: lavoro in una scuola di scherma, i nomi dei colleghi sono Mihail e Sarah, non usare mai emoji." value={p.extra} onChange={(e) => set({ extra: e.target.value })} aria-label="Altre istruzioni" />
        </div>
      </section>

      <section className="section">
        <div className="btn-row">
          <button className="btn small" onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? "Nascondi le istruzioni" : "Vedi le istruzioni generate"}</button>
        </div>
        {showPrompt ? <pre className="prompt-preview">{composeSystemPrompt(p)}</pre> : null}
      </section>
    </>
  );
}
