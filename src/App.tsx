import { getCurrentWindow } from "@tauri-apps/api/window";
import Popup from "./popup/Popup";
import Settings from "./settings/Settings";

export default function App() {
  const label = getCurrentWindow().label;
  if (label === "settings") return <Settings />;
  return <Popup />;
}
