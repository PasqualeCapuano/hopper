import { load, type Store } from "@tauri-apps/plugin-store";
import { providerInfo, type ProviderId } from "./providers";

export type Provider = ProviderId;
export type Effort = "low" | "medium" | "high";
export type ActionOutput = "show" | "copy" | "paste";

export interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  output: ActionOutput;
  /** Optional global shortcut that opens the popup and runs this action. */
  shortcut?: string;
  /** Icon name from src/lib/icons.ts. */
  icon?: string;
}

export interface Settings {
  provider: Provider;
  /** Chosen model per provider; falls back to the catalog default. */
  models: Partial<Record<Provider, string>>;
  /** Base URL for the "custom" provider. */
  customBaseUrl: string;
  effort: Effort;
  systemPrompt: string;
  hotkey: string;
  autostart: boolean;
  actions: QuickAction[];
}

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 · consigliato" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 · più veloce" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 · economico" },
];

export const DEFAULT_ACTIONS: QuickAction[] = [
  {
    id: "translate",
    label: "Traduci in italiano",
    icon: "globe",
    prompt:
      "Traduci il testo in italiano. Mantieni tono e formattazione. Rispondi solo con la traduzione.\n\n{{testo}}",
    output: "show",
  },
  {
    id: "summarize",
    label: "Riassumi",
    icon: "list",
    prompt:
      "Riassumi il testo in massimo 3 frasi, nella lingua del testo. Vai dritto al punto.\n\n{{testo}}",
    output: "show",
  },
  {
    id: "reply",
    label: "Rispondi",
    icon: "reply",
    prompt:
      "Scrivi una risposta a questo messaggio nella stessa lingua del testo. Tono cordiale e diretto, massimo 5 righe. Rispondi solo con il testo della risposta.\n\n{{testo}}",
    output: "show",
  },
  {
    id: "fix",
    label: "Correggi",
    icon: "check",
    prompt:
      "Correggi errori di grammatica, ortografia e punteggiatura senza cambiare il significato o il tono. Rispondi solo con il testo corretto.\n\n{{testo}}",
    output: "show",
  },
  {
    id: "explain",
    label: "Spiega",
    icon: "bulb",
    prompt:
      "Spiega questo testo in modo semplice e breve, in italiano. Se contiene richieste o scadenze, elencale.\n\n{{testo}}",
    output: "show",
  },
];

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  models: {},
  customBaseUrl: "",
  effort: "medium",
  systemPrompt:
    "Sei un assistente personale che lavora dentro un popup di sistema. Rispondi in modo diretto, senza preamboli né formule di cortesia inutili. Rispondi in italiano salvo che il testo o la richiesta siano in un'altra lingua.",
  hotkey: navigator.userAgent.includes("Mac") ? "Alt+Space" : "Ctrl+Shift+Space",
  autostart: false,
  actions: DEFAULT_ACTIONS,
};

let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("settings.json", { autoSave: true, defaults: {} });
  }
  return storePromise;
}

export async function loadSettings(): Promise<Settings> {
  const s = await store();
  const saved = (await s.get<Partial<Settings> & { anthropicModel?: string; openaiModel?: string }>("settings")) ?? {};
  const merged: Settings = { ...DEFAULT_SETTINGS, ...saved, models: { ...(saved.models ?? {}) } };
  // Settings written by 0.1.x kept one model field per provider.
  if (saved.anthropicModel && !merged.models.anthropic) merged.models.anthropic = saved.anthropicModel;
  if (saved.openaiModel && !merged.models.openai) merged.models.openai = saved.openaiModel;
  return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await store();
  await s.set("settings", settings);
  await s.save();
}

export function buildPrompt(template: string, text: string): string {
  if (template.includes("{{testo}}")) return template.split("{{testo}}").join(text);
  return `${template}\n\n---\n${text}`;
}

export function modelFor(settings: Settings): string {
  return settings.models[settings.provider] || providerInfo(settings.provider).defaultModel;
}

export function baseUrlFor(settings: Settings): string | null {
  const info = providerInfo(settings.provider);
  if (info.id === "custom") return settings.customBaseUrl.trim() || null;
  return info.baseURL;
}
