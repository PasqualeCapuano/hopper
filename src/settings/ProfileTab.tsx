import { useState } from "react";
import { useTranslation } from "react-i18next";
import { composeSystemPrompt, languages, lengths, tones, type Profile } from "../lib/profile";
import type { Settings } from "../lib/settings";

export default function ProfileTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const { t } = useTranslation();
  const [showPrompt, setShowPrompt] = useState(false);
  const p = s.profile;
  const set = (patch: Partial<Profile>) => update({ profile: { ...p, ...patch } });

  return (
    <>
      <div>
        <h1>{t("prof.title")}</h1>
        <div className="lead">{t("prof.lead")}</div>
      </div>

      <section className="section">
        <h2>{t("prof.who")}</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="pn">{t("prof.name")}</label>
            <input id="pn" placeholder={t("prof.namePh")} value={p.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pr">{t("prof.role")}</label>
            <input id="pr" placeholder={t("prof.rolePh")} value={p.role} onChange={(e) => set({ role: e.target.value })} />
          </div>
        </div>
        <div className="help">{t("prof.whoHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("prof.language")}</h2>
        <div className="btn-row">
          <div className="segmented" role="radiogroup" aria-label={t("prof.language")}>
            {languages().map((l) => (
              <button key={l.id} role="radio" aria-checked={p.language === l.id} className={p.language === l.id ? "active" : ""} onClick={() => set({ language: l.id })}>{l.label}</button>
            ))}
          </div>
          {p.language === "other" ? <input className="inline-input" placeholder={t("prof.otherPh")} value={p.languageOther} onChange={(e) => set({ languageOther: e.target.value })} aria-label={t("lang.other")} /> : null}
        </div>
        <div className="help">{t("prof.langHelp")}</div>
      </section>

      <section className="section">
        <h2>{t("prof.tone")}</h2>
        <div className="choice-grid">
          {tones().map((o) => (
            <button key={o.id} className={"choice" + (p.tone === o.id ? " active" : "")} onClick={() => set({ tone: o.id })}>
              <span className="choice-label">{o.label}</span>
              <span className="choice-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{t("prof.length")}</h2>
        <div className="choice-grid">
          {lengths().map((o) => (
            <button key={o.id} className={"choice" + (p.length === o.id ? " active" : "")} onClick={() => set({ length: o.id })}>
              <span className="choice-label">{o.label}</span>
              <span className="choice-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{t("prof.signature")}</h2>
        <div className="field">
          <input placeholder={p.name.trim() || t("prof.sigPh")} value={p.signature} onChange={(e) => set({ signature: e.target.value })} aria-label={t("prof.signature")} style={{ maxWidth: 420 }} />
          <div className="help">{t("prof.sigHelp")}</div>
        </div>
      </section>

      <section className="section">
        <h2>{t("prof.extra")}</h2>
        <div className="field">
          <textarea rows={3} placeholder={t("prof.extraPh")} value={p.extra} onChange={(e) => set({ extra: e.target.value })} aria-label={t("prof.extra")} />
        </div>
      </section>

      <section className="section">
        <div className="btn-row">
          <button className="btn small" onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? t("prof.hidePrompt") : t("prof.showPrompt")}</button>
        </div>
        {showPrompt ? <pre className="prompt-preview">{composeSystemPrompt(p, s.locale)}</pre> : null}
      </section>
    </>
  );
}
