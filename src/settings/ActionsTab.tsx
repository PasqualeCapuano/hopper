import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { AiError, streamChat } from "../lib/ai";
import { ACTION_ICONS, ICON_NAMES } from "../lib/icons";
import { actionTemplates } from "../lib/templates";
import { textToken } from "../lib/i18n";
import { buildPrompt, defaultActions, type QuickAction, type Settings } from "../lib/settings";
import HotkeyRecorder from "./HotkeyRecorder";

const POPUP_SLOTS = 6;

function Icon({ name, size = 16 }: { name?: string; size?: number }) {
  const d = (name && ACTION_ICONS[name]) || ACTION_ICONS.sparkles;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default function ActionsTab({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [library, setLibrary] = useState(false);
  const [preview, setPreview] = useState<{ text: string; busy: boolean; error?: string } | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const action = s.actions[selected];

  const setActions = (actions: QuickAction[]) => update({ actions });
  const patch = (p: Partial<QuickAction>) => setActions(s.actions.map((a, i) => (i === selected ? { ...a, ...p } : a)));

  const add = (base?: Partial<QuickAction>) => {
    const a: QuickAction = {
      id: `custom-${Date.now()}`,
      label: base?.label ?? t("act.new"),
      prompt: base?.prompt ?? t("act.newPrompt", { token: textToken() }),
      output: base?.output ?? "show",
      icon: base?.icon ?? "sparkles",
      shortcut: undefined,
    };
    setActions([...s.actions, a]);
    setSelected(s.actions.length);
    setLibrary(false);
  };
  const duplicate = () => {
    if (!action) return;
    const copy: QuickAction = { ...action, id: `custom-${Date.now()}`, label: `${action.label} ${t("act.copySuffix")}`, shortcut: undefined };
    const actions = [...s.actions];
    actions.splice(selected + 1, 0, copy);
    setActions(actions);
    setSelected(selected + 1);
  };
  const remove = () => {
    setActions(s.actions.filter((_, i) => i !== selected));
    setSelected(Math.max(0, selected - 1));
  };
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const actions = [...s.actions];
    const [moved] = actions.splice(from, 1);
    actions.splice(to, 0, moved);
    setActions(actions);
    setSelected(to);
  };

  const insertVariable = (token: string) => {
    const el = promptRef.current;
    if (!el || !action) return;
    const start = el.selectionStart ?? action.prompt.length;
    const end = el.selectionEnd ?? start;
    const prompt = action.prompt.slice(0, start) + token + action.prompt.slice(end);
    patch({ prompt });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const test = async () => {
    if (!action) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let clip = "";
    try { clip = (await readText()) ?? ""; } catch { clip = ""; }
    if (!clip.trim()) { setPreview({ text: "", busy: false, error: t("act.clipEmpty") }); return; }
    setPreview({ text: "", busy: true });
    let acc = "";
    try {
      for await (const d of streamChat(s, [{ role: "user", content: buildPrompt(action.prompt, clip) }], controller.signal)) {
        acc += d;
        setPreview({ text: acc, busy: true });
      }
      setPreview({ text: acc, busy: false });
    } catch (err) {
      if (err instanceof AiError && err.kind === "aborted") return;
      setPreview({ text: acc, busy: false, error: err instanceof AiError ? err.message : String(err) });
    }
  };

  const templates = actionTemplates(s.locale);
  const groups = Array.from(new Set(templates.map((tpl) => tpl.group)));
  const variables = [{ token: textToken(), desc: t("act.varDesc") }];

  return (
    <>
      <div>
        <h1>{t("act.title")}</h1>
        <div className="lead">{t("act.lead", { n: POPUP_SLOTS })}</div>
      </div>
      <div className="actions-layout">
        <div className="actions-list">
          {s.actions.map((a, i) => (
            <div key={a.id}>
              {i === POPUP_SLOTS ? <div className="actions-sep"><span>{t("act.sepShortcutOnly")}</span></div> : null}
              <button
                className={"action-item" + (i === selected ? " active" : "") + (over === i && dragging !== null && dragging !== i ? " over" : "") + (dragging === i ? " dragging" : "")}
                draggable
                onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); setOver(i); }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); if (dragging !== null) reorder(dragging, i); setDragging(null); setOver(null); }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                onClick={() => { setSelected(i); setPreview(null); }}
              >
                <span className="grip" aria-hidden="true">⋮⋮</span>
                <span className="action-icon"><Icon name={a.icon} /></span>
                <span className="action-label">{a.label}</span>
                {i < POPUP_SLOTS ? <span className="num">{i + 1}</span> : null}
              </button>
            </div>
          ))}
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn small" onClick={() => add()}>{t("act.add")}</button>
            <button className="btn small" onClick={() => setLibrary(!library)}>{t("act.library")}</button>
            <div className="spacer" />
            <button className="btn small" onClick={() => { setActions(defaultActions(s.locale)); setSelected(0); }}>{t("act.reset")}</button>
          </div>
        </div>

        {library ? (
          <div className="actions-editor">
            <div className="field">
              <label>{t("act.libTitle")}</label>
              <div className="help">{t("act.libHelp")}</div>
            </div>
            {groups.map((g) => (
              <div key={g} className="field">
                <label>{g}</label>
                <div className="template-grid">
                  {templates.filter((tpl) => tpl.group === g).map((tpl) => (
                    <button key={tpl.id} className="template" onClick={() => add(tpl)} title={tpl.prompt}>
                      <span className="action-icon"><Icon name={tpl.icon} /></span>
                      <span>{tpl.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : action ? (
          <div className="actions-editor">
            <div className="field">
              <label htmlFor="al">{t("act.name")}</label>
              <div className="btn-row">
                <div className="icon-picker">
                  {ICON_NAMES.map((n) => (
                    <button key={n} className={"icon-choice" + (action.icon === n ? " active" : "")} onClick={() => patch({ icon: n })} aria-label={t("act.iconAria", { n })}><Icon name={n} /></button>
                  ))}
                </div>
              </div>
              <input id="al" value={action.label} onChange={(e) => patch({ label: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ap">{t("act.prompt")}</label>
              <textarea id="ap" ref={promptRef} rows={7} className="mono" value={action.prompt} onChange={(e) => patch({ prompt: e.target.value })} />
              <div className="help variables">
                {t("act.variables")}
                {variables.map((v) => (
                  <button key={v.token} className="chip" onClick={() => insertVariable(v.token)} title={v.desc}>{v.token}</button>
                ))}
                <span>{t("act.varHelp")}</span>
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="ao">{t("act.after")}</label>
                <select id="ao" value={action.output} onChange={(e) => patch({ output: e.target.value as QuickAction["output"] })}>
                  <option value="show">{t("act.show")}</option>
                  <option value="copy">{t("act.copyNow")}</option>
                  <option value="paste">{t("act.pasteNow")}</option>
                </select>
              </div>
              <div className="field">
                <label>{t("act.shortcut")}</label>
                <HotkeyRecorder value={action.shortcut ?? ""} onChange={(sc) => patch({ shortcut: sc || undefined })} clearable placeholder={t("act.none")} />
              </div>
            </div>
            <div className="field">
              <div className="btn-row">
                <button className="btn small" onClick={() => void test()} disabled={preview?.busy}>{t("act.testClip")}</button>
                {preview?.busy ? <button className="btn small" onClick={() => abortRef.current?.abort()}>{t("act.cancel")}</button> : null}
                <div className="spacer" />
                <button className="btn small" onClick={duplicate}>{t("act.duplicate")}</button>
                <button className="btn small danger" onClick={remove}>{t("act.delete")}</button>
              </div>
              {preview ? (
                <div className="preview">
                  {preview.error ? <div className="inline-err">{preview.error}</div> : null}
                  {preview.text ? <div className="preview-text">{preview.text}{preview.busy ? <span className="cursor" /> : null}</div> : preview.busy ? <div className="help">{t("act.writing")}</div> : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="actions-editor"><div className="help">{t("act.noActions")}</div></div>
        )}
      </div>
    </>
  );
}
