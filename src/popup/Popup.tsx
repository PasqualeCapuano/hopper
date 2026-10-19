import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { AiError, streamChat, type ChatMessage } from "../lib/ai";
import { newThread, upsertThread, type Thread } from "../lib/history";
import { providerInfo } from "../lib/providers";
import { applyHotkeys, prettyShortcut } from "../lib/hotkeys";
import { ACTION_ICONS } from "../lib/icons";
import { applyTheme } from "../lib/theme";
import { applyTrayLabels } from "../lib/tray";
import {
  buildPrompt,
  loadSettings,
  modelFor,
  type ActionOutput,
  type QuickAction,
  type Settings,
} from "../lib/settings";

type Screen = "idle" | "result" | "chat" | "error";
type Notice = "copied" | "pasted" | null;

interface PopupError {
  kind: AiError["kind"] | "accessibility";
  message: string;
  retryAfter?: number;
}

const ICON = {
  logo: "M5 16.5a7 7 0 0 1 14 0M4.5 19.2h.01M19.5 19.2h.01",
  close: "M18 6 6 18M6 6l12 12",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
};

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default function Popup() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("idle");
  const [title, setTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<PopupError | null>(null);
  const [entered, setEntered] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<Thread | null>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => {
    abortRef.current?.abort();
    void invoke("hide_popup");
  }, []);

  const reset = useCallback((text: string | null) => {
    abortRef.current?.abort();
    threadRef.current = null;
    setClip(text);
    setScreen("idle");
    setTitle(null);
    setMessages([]);
    setPartial("");
    setBusy(false);
    setDraft("");
    setChatDraft("");
    setNotice(null);
    setError(null);
  }, []);

  // Window plumbing: open event from the hotkey/tray, hide on blur.
  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      void applyTheme(s.theme);
      // Saved bindings (hotkey + per-action shortcuts) win over the compiled-in default.
      void applyHotkeys(s).catch(() => {});
      void applyTrayLabels(s.locale);
    });
    // Quiet update check at launch; failures (dev builds, offline) are ignored.
    void check().then((u) => { if (u) setUpdate(u); }).catch(() => {});
    const unlistenOpen = listen<{ text: string | null; action: string | null }>("popup-open", (e) => {
      void loadSettings().then((s) => { setSettings(s); void applyTheme(s.theme); });
      reset(e.payload.text);
      setPendingAction(e.payload.action);
      setEntered(false);
      requestAnimationFrame(() => setEntered(true));
      setTimeout(() => promptRef.current?.focus(), 30);
    });
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) hide();
    });
    return () => {
      void unlistenOpen.then((f) => f());
      void unlistenFocus.then((f) => f());
    };
  }, [hide, reset]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, partial]);

  const copyText = useCallback(async (text: string) => {
    await writeText(text);
    setNotice("copied");
  }, []);

  const pasteText = useCallback(async (text: string) => {
    const granted = await invoke<boolean>("accessibility_granted");
    if (!granted) {
      await writeText(text);
      setError({
        kind: "accessibility",
        message: "",
      });
      setScreen("error");
      return;
    }
    await invoke("paste_text", { text });
    setNotice("pasted");
  }, []);

  const run = useCallback(
    async (userText: string, label: string, output: ActionOutput, nextScreen: Screen) => {
      if (!settings) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const thread = threadRef.current ?? newThread(clip, label);
      threadRef.current = thread;
      const history: ChatMessage[] = [...messages, { role: "user", content: userText }];
      setMessages(history);
      setTitle(label);
      setScreen(nextScreen);
      setPartial("");
      setNotice(null);
      setError(null);
      setBusy(true);

      let acc = "";
      try {
        for await (const delta of streamChat(settings, history, controller.signal)) {
          acc += delta;
          setPartial(acc);
        }
        const done: ChatMessage[] = [...history, { role: "assistant", content: acc }];
        setMessages(done);
        setPartial("");
        thread.messages = done;
        await upsertThread(thread);
        if (output === "copy") await copyText(acc);
        if (output === "paste") await pasteText(acc);
      } catch (err) {
        if (err instanceof AiError && err.kind === "aborted") return;
        const e = err instanceof AiError ? err : new AiError("other", String(err));
        setError({ kind: e.kind, message: e.message, retryAfter: e.retryAfter });
        setScreen("error");
      } finally {
        if (abortRef.current === controller) setBusy(false);
      }
    },
    [settings, clip, messages, copyText, pasteText],
  );

  const runAction = useCallback(
    (action: QuickAction) => {
      if (!clip) return;
      void run(buildPrompt(action.prompt, clip), action.label, action.output, "result");
    },
    [clip, run],
  );

  // A per-action global shortcut: run the action once the clipboard text is in place.
  useEffect(() => {
    if (!pendingAction || !settings || screen !== "idle") return;
    const action = settings.actions.find((a) => a.id === pendingAction);
    setPendingAction(null);
    if (action && clip) runAction(action);
  }, [pendingAction, settings, clip, screen, runAction]);

  const sendFree = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const prompt = clip ? `${text}\n\n---\n${clip}` : text;
    void run(prompt, text.length > 40 ? `${text.slice(0, 40)}…` : text, "show", "result");
  }, [draft, clip, run]);

  const openChat = useCallback(() => {
    if (messages.length === 0) {
      threadRef.current = newThread(clip, t("popup.chat"));
      setTitle(t("popup.chat"));
    }
    setScreen("chat");
    setTimeout(() => chatInputRef.current?.focus(), 30);
  }, [messages.length, clip, t]);

  const sendChat = useCallback(() => {
    const text = chatDraft.trim();
    if (!text || busy) return;
    setChatDraft("");
    const prompt = messages.length === 0 && clip ? `${text}\n\n---\n${clip}` : text;
    void run(prompt, title ?? t("popup.chat"), "show", "chat");
  }, [chatDraft, busy, messages.length, clip, run, title, t]);

  const lastReply = messages.length && messages[messages.length - 1].role === "assistant" ? messages[messages.length - 1].content : "";

  // Keyboard: Esc closes, digits pick an action, Enter copies, Cmd/Ctrl+Enter pastes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }
      if (screen === "idle" && !inInput && settings && clip && /^[1-9]$/.test(e.key)) {
        const action = settings.actions[Number(e.key) - 1];
        if (action) runAction(action);
        return;
      }
      if (screen === "result" && !busy && lastReply && e.key === "Enter") {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) void pasteText(lastReply);
        else void copyText(lastReply);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, settings, clip, busy, lastReply, hide, runAction, copyText, pasteText]);

  const installUpdate = useCallback(async () => {
    if (!update || updating) return;
    setUpdating(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setUpdating(false);
    }
  }, [update, updating]);

  const actions = settings?.actions.slice(0, 6) ?? [];
  const providerLabel = settings ? `${providerInfo(settings.provider).name} · ${modelFor(settings) || t("popup.noModel")}` : "…";

  return (
    <div className={"popup glass" + (entered ? " enter" : "")}>
      <div className="popup-header" data-tauri-drag-region>
        <div className="logo"><Icon d={ICON.logo} size={15} /></div>
        <div className="title">{title ?? t("popup.assistant")}</div>
        {screen !== "idle" && clip ? <div className="sub">· {t("popup.chars", { n: clip.length })}</div> : null}
        <div className="spacer" data-tauri-drag-region />
        {screen === "idle" ? <div className="kbd">{prettyShortcut(settings?.hotkey ?? "")}</div> : null}
        <button className="icon-btn" aria-label={t("popup.settings")} onClick={() => void invoke("open_settings_cmd")}><Icon d={ICON.settings} /></button>
        <button className="icon-btn" aria-label={t("popup.close")} onClick={hide}><Icon d={ICON.close} /></button>
      </div>

      {screen === "idle" && (
        <>
          {clip ? (
            <div className="clip">
              <div className="clip-meta">
                <span className="label">{t("popup.fromClipboard")}</span>
                <span>{t("popup.chars", { n: clip.length })}</span>
              </div>
              <div className="clip-text">{clip}</div>
            </div>
          ) : (
            <div className="clip empty">{t("popup.empty")}</div>
          )}
          <div className="actions">
            {actions.map((a, i) => (
              <button key={a.id} className="action" disabled={!clip} onClick={() => runAction(a)}>
                <span className="action-icon"><Icon d={ACTION_ICONS[a.icon ?? ""] ?? ACTION_ICONS.sparkles} size={15} /></span>
                <span>{a.label}</span>
                <span className="num">{i + 1}</span>
              </button>
            ))}
            <button className="action" onClick={openChat}>
              <span className="action-icon"><Icon d={ACTION_ICONS.chat} size={15} /></span>
              <span>{t("popup.freeChat")}</span>
            </button>
          </div>
          <div className="input-row">
            <input
              ref={promptRef}
              className="text-input"
              placeholder={clip ? t("popup.placeholderClip") : t("popup.placeholderAsk")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendFree(); }}
            />
            <button className="send" aria-label={t("popup.send")} onClick={sendFree} disabled={!draft.trim()}><Icon d={ICON.send} /></button>
          </div>
        </>
      )}

      {screen === "result" && (
        <>
          <div className="response">
            {busy ? partial : lastReply}
            {busy ? <span className="cursor" /> : null}
          </div>
          <div className="status">
            <span className={"dot" + (busy ? " busy" : "")} />
            <span>{busy ? t("popup.writing") : providerLabel}</span>
            <div className="spacer" />
            {notice === "copied" ? <span className="ok">{t("popup.copied")}</span> : null}
            {notice === "pasted" ? <span className="ok">{t("popup.pasted")}</span> : null}
            {busy ? <span className="hint">{t("popup.escCancel")}</span> : null}
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={busy} onClick={() => void copyText(lastReply)}>{t("popup.copy")} <span className="kbd-hint">↵</span></button>
            <button className="btn" disabled={busy} onClick={() => void pasteText(lastReply)}>{t("popup.pasteInApp")} <span className="kbd-hint">⌘↵</span></button>
            <button className="btn" disabled={busy} onClick={openChat}>{t("popup.continueChat")}</button>
            <div className="spacer" />
            <button className="btn" disabled={busy} onClick={() => { const last = messages.filter((m) => m.role === "user").pop(); if (last) { setMessages(messages.slice(0, -2)); void run(last.content, title ?? t("popup.assistant"), "show", "result"); } }}>{t("popup.regenerate")}</button>
          </div>
        </>
      )}

      {screen === "chat" && (
        <>
          <div className="chat">
            {clip ? <div className="ctx">{t("popup.ctx", { n: clip.length })}</div> : null}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "msg-user" : "msg-ai"}>
                {m.role === "user" ? m.content.split("\n\n---\n")[0] : m.content}
              </div>
            ))}
            {busy ? <div className="msg-ai">{partial}<span className="cursor" /></div> : null}
            {!busy && lastReply ? (
              <div className="btn-row">
                <button className="btn small" onClick={() => void copyText(lastReply)}>{t("popup.copy")}</button>
                <button className="btn small" onClick={() => void pasteText(lastReply)}>{t("popup.pasteInApp")}</button>
                {notice === "copied" ? <span className="inline-ok">{t("popup.copiedShort")}</span> : null}
                {notice === "pasted" ? <span className="inline-ok">{t("popup.pasted")}</span> : null}
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>
          <div className="input-row">
            <input
              ref={chatInputRef}
              className="text-input"
              placeholder={t("popup.chatPlaceholder")}
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
            />
            <button className="send" aria-label={t("popup.send")} onClick={sendChat} disabled={busy || !chatDraft.trim()}><Icon d={ICON.send} /></button>
          </div>
        </>
      )}

      {screen === "error" && error && (
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {error.kind === "accessibility" && (
            <div className="error-card warn">
              <div className="h">{t("err.acc.title")}</div>
              <div className="p">{t("err.acc.msg")}</div>
              <div className="btn-row">
                <button className="btn small primary" onClick={() => void invoke("accessibility_prompt")}>{t("err.acc.open")}</button>
                <button className="btn small" onClick={() => setScreen(messages.length ? "result" : "idle")}>{t("err.acc.manual")}</button>
              </div>
            </div>
          )}
          {error.kind === "no-key" && (
            <div className="error-card">
              <div className="h">{t("err.nokey.title")}</div>
              <div className="p">{t("err.nokey.msg")}</div>
              <div className="btn-row">
                <button className="btn small primary" onClick={() => void invoke("open_settings_cmd")}>{t("err.nokey.open")}</button>
                <button className="btn small" onClick={hide}>{t("popup.close")}</button>
              </div>
            </div>
          )}
          {error.kind === "auth" && (
            <div className="error-card">
              <div className="h">{t("err.auth.title")}</div>
              <div className="p">{t("err.auth.msg")}</div>
              <div className="btn-row">
                <button className="btn small primary" onClick={() => void invoke("open_settings_cmd")}>{t("err.auth.open")}</button>
                <button className="btn small" onClick={hide}>{t("popup.close")}</button>
              </div>
            </div>
          )}
          {error.kind === "rate-limit" && (
            <div className="error-card warn">
              <div className="h">{t("err.rate.title")}</div>
              <div className="p">{t("err.rate.msg", { n: error.retryAfter ?? 20 })}</div>
              <div className="btn-row">
                <button className="btn small" onClick={() => setScreen("idle")}>{t("err.back")}</button>
              </div>
            </div>
          )}
          {error.kind === "offline" && (
            <div className="error-card">
              <div className="h">{t("err.offline.title")}</div>
              <div className="p">{t("err.offline.msg")}</div>
              <div className="btn-row">
                <button className="btn small primary" onClick={() => { const last = messages.filter((m) => m.role === "user").pop(); if (last) { setMessages(messages.slice(0, -1)); void run(last.content, title ?? t("popup.assistant"), "show", "result"); } }}>{t("err.retry")}</button>
                <button className="btn small" onClick={hide}>{t("popup.close")}</button>
              </div>
            </div>
          )}
          {error.kind === "too-long" && (
            <div className="error-card warn">
              <div className="h">{t("err.toolong.title")}</div>
              <div className="p">{t("err.toolong.msg", { msg: error.message })}</div>
              <div className="btn-row">
                <button className="btn small" onClick={() => setScreen("idle")}>{t("err.back")}</button>
              </div>
            </div>
          )}
          {error.kind === "other" && (
            <div className="error-card">
              <div className="h">{t("err.other.title")}</div>
              <div className="p">{error.message}</div>
              <div className="btn-row">
                <button className="btn small" onClick={() => setScreen("idle")}>{t("err.back")}</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="footer">
        <span className="pill"><span className="dot" />{providerLabel}</span>
        {update ? (
          <button className="pill update" onClick={() => void installUpdate()} disabled={updating}>
            {updating ? t("popup.updating") : t("popup.updateAvailable", { v: update.version })}
          </button>
        ) : null}
        <div className="spacer" />
        <span className="hint">
          {screen === "idle" ? t("popup.hintIdle") : screen === "result" ? t("popup.hintResult") : t("popup.hintChat")}
        </span>
      </div>
    </div>
  );
}
