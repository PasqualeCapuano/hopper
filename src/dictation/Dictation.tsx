import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { prettyShortcut } from "../lib/hotkeys";
import { loadSettings } from "../lib/settings";
import { applyTheme } from "../lib/theme";

type State = "listening" | "transcribing" | "error";
const BAR_SHAPE = [0.45, 0.75, 1, 0.65, 1, 0.75, 0.45];

/** The small always-on-top pill shown while dictating. Rust drives it with events. */
export default function Dictation() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>("listening");
  const [message, setMessage] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [toggle, setToggle] = useState(false);
  const [hotkey, setHotkey] = useState("");

  useEffect(() => {
    const refresh = () =>
      loadSettings().then((s) => {
        void applyTheme(s.theme);
        setToggle(s.dictation.toggle);
        setHotkey(s.dictation.hotkey);
      });
    void refresh();
    const u1 = listen<{ state: State; message: string | null }>("dictation-state", (e) => {
      setState(e.payload.state);
      setMessage(e.payload.message);
      if (e.payload.state === "listening") {
        setLevel(0);
        void refresh();
      }
    });
    const u2 = listen<{ level: number }>("dictation-level", (e) => setLevel(e.payload.level));
    return () => {
      void u1.then((f) => f());
      void u2.then((f) => f());
    };
  }, []);

  const errorText = message?.startsWith("no-audio:")
    ? t("dict.noAudioFrom", { device: message.slice("no-audio:".length) })
    : message === "no-audio" ? t("dict.noAudio") : message === "no-mic" ? t("dict.noMic") : message;

  return (
    <div className="dict glass">
      <span className={"dict-dot " + state} />
      {state === "listening" ? (
        <div className="dict-bars" aria-hidden="true">
          {BAR_SHAPE.map((k, i) => (
            <span key={i} className="dict-bar" style={{ transform: `scaleY(${(0.16 + Math.min(1, level * 1.4) * 0.84 * k).toFixed(3)})` }} />
          ))}
        </div>
      ) : null}
      {state === "listening" ? (
        <span className="dict-text">
          {t("dict.listening")}
          <span className="dict-hint">{toggle ? t("dict.pressAgain", { sc: prettyShortcut(hotkey) }) : t("dict.release")}</span>
        </span>
      ) : state === "transcribing" ? (
        <span className="dict-text">{t("dict.transcribing")}</span>
      ) : (
        <span className="dict-text error">{errorText}</span>
      )}
    </div>
  );
}
