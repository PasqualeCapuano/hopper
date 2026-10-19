import { getCurrentWindow } from "@tauri-apps/api/window";
import Popup from "./popup/Popup";
import Settings from "./settings/Settings";
import Dictation from "./dictation/Dictation";

export default function App() {
  const label = getCurrentWindow().label;
  if (label === "settings") return <Settings />;
  if (label === "dictation") return <Dictation />;
  return <Popup />;
}
