import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { prettyShortcut, shortcutFromEvent } from "../lib/hotkeys";

interface Props {
  value: string;
  onChange: (shortcut: string) => void;
  /** Allow clearing (for optional per-action shortcuts). */
  clearable?: boolean;
  placeholder?: string;
}

/** Click, press a combination, done. Esc cancels; Backspace clears when clearable. */
export default function HotkeyRecorder({ value, onChange, clearable, placeholder }: Props) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); setHeld([]); return; }
      if ((e.key === "Backspace" || e.key === "Delete") && clearable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        onChange("");
        setRecording(false);
        setHeld([]);
        return;
      }
      const mods: string[] = [];
      if (e.metaKey) mods.push("⌘");
      if (e.ctrlKey) mods.push("⌃");
      if (e.altKey) mods.push("⌥");
      if (e.shiftKey) mods.push("⇧");
      setHeld(mods);
      const sc = shortcutFromEvent(e);
      if (sc) {
        onChange(sc);
        setRecording(false);
        setHeld([]);
        ref.current?.blur();
      }
    };
    const onKeyUp = () => setHeld([]);
    const stop = () => { setRecording(false); setHeld([]); };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stop);
    };
  }, [recording, clearable, onChange]);

  const label = recording
    ? held.length ? `${held.join(" ")} …` : t("rec.press")
    : value ? prettyShortcut(value) : (placeholder ?? t("rec.none"));

  return (
    <button
      ref={ref}
      type="button"
      className={"hotkey-recorder" + (recording ? " recording" : "") + (value ? "" : " empty")}
      onClick={() => setRecording(true)}
      onBlur={() => { setRecording(false); setHeld([]); }}
      aria-label={recording ? t("rec.recording") : t("rec.aria", { label })}
    >
      <span>{label}</span>
      {!recording ? <span className="hint-small">{value ? t("rec.clickChange") : t("rec.clickSet")}</span> : <span className="hint-small">{t("rec.escCancel")}{clearable ? t("rec.bsClear") : ""}</span>}
    </button>
  );
}
