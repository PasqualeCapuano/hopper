import { load, type Store } from "@tauri-apps/plugin-store";
import { providerInfo, type ProviderId } from "./providers";
import { composeSystemPrompt, DEFAULT_PROFILE, type Profile } from "./profile";
import { isLocale, setLocale, type Locale } from "./i18n";

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
  /** Structured description of the user; see systemPromptFor(). */
  profile: Profile;
  hotkey: string;
  autostart: boolean;
  theme: "system" | "light" | "dark";
  /** Interface language. English unless the user picks another. */
  locale: Locale;
  actions: QuickAction[];
}

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", tag: "model.recommended" as const },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", tag: "model.faster" as const },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", tag: "model.cheaper" as const },
];

const DEFAULT_ACTIONS_EN: QuickAction[] = [
  { id: "translate", label: "Translate", icon: "globe", output: "show",
    prompt: "Translate the text into English. Keep tone and formatting. Reply with the translation only.\n\n{{text}}" },
  { id: "summarize", label: "Summarize", icon: "list", output: "show",
    prompt: "Summarize the text in at most 3 sentences, in the language of the text. Get straight to the point.\n\n{{text}}" },
  { id: "reply", label: "Reply", icon: "reply", output: "show",
    prompt: "Write a reply to this message in the same language as the text. Warm and direct tone, at most 5 lines. Reply with the text of the reply only.\n\n{{text}}" },
  { id: "fix", label: "Fix", icon: "check", output: "show",
    prompt: "Fix grammar, spelling and punctuation mistakes without changing the meaning or the tone. Reply with the corrected text only.\n\n{{text}}" },
  { id: "explain", label: "Explain", icon: "bulb", output: "show",
    prompt: "Explain this text simply and briefly. If it contains requests or deadlines, list them.\n\n{{text}}" },
];

const DEFAULT_ACTIONS_IT: QuickAction[] = [
  { id: "translate", label: "Traduci in italiano", icon: "globe", output: "show",
    prompt: "Traduci il testo in italiano. Mantieni tono e formattazione. Rispondi solo con la traduzione.\n\n{{testo}}" },
  { id: "summarize", label: "Riassumi", icon: "list", output: "show",
    prompt: "Riassumi il testo in massimo 3 frasi, nella lingua del testo. Vai dritto al punto.\n\n{{testo}}" },
  { id: "reply", label: "Rispondi", icon: "reply", output: "show",
    prompt: "Scrivi una risposta a questo messaggio nella stessa lingua del testo. Tono cordiale e diretto, massimo 5 righe. Rispondi solo con il testo della risposta.\n\n{{testo}}" },
  { id: "fix", label: "Correggi", icon: "check", output: "show",
    prompt: "Correggi errori di grammatica, ortografia e punteggiatura senza cambiare il significato o il tono. Rispondi solo con il testo corretto.\n\n{{testo}}" },
  { id: "explain", label: "Spiega", icon: "bulb", output: "show",
    prompt: "Spiega questo testo in modo semplice e breve, in italiano. Se contiene richieste o scadenze, elencale.\n\n{{testo}}" },
];

/** The built-in quick actions, in the given interface language. */
export function defaultActions(locale: Locale): QuickAction[] {
  return (locale === "it" ? DEFAULT_ACTIONS_IT : DEFAULT_ACTIONS_EN).map((a) => ({ ...a }));
}

/**
 * When the interface language changes, built-in actions the user never edited
 * follow it; customised ones are left alone.
 */
export function translateDefaultActions(actions: QuickAction[], from: Locale, to: Locale): QuickAction[] {
  if (from === to) return actions;
  const old = defaultActions(from);
  const next = defaultActions(to);
  return actions.map((a) => {
    const o = old.find((d) => d.id === a.id);
    const n = next.find((d) => d.id === a.id);
    if (!o || !n || o.label !== a.label || o.prompt !== a.prompt) return a;
    return { ...a, label: n.label, prompt: n.prompt };
  });
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  models: {},
  customBaseUrl: "",
  effort: "medium",
  profile: DEFAULT_PROFILE,
  hotkey: navigator.userAgent.includes("Mac") ? "Alt+Space" : "Ctrl+Shift+Space",
  autostart: false,
  theme: "system",
  locale: "en",
  actions: defaultActions("en"),
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
  const saved = (await s.get<Partial<Settings> & { anthropicModel?: string; openaiModel?: string; systemPrompt?: string }>("settings")) ?? {};
  const locale: Locale = isLocale(saved.locale) ? saved.locale : "en";
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    locale,
    models: { ...(saved.models ?? {}) },
    profile: { ...DEFAULT_PROFILE, ...(saved.profile ?? {}) },
    actions: saved.actions ?? defaultActions(locale),
  };
  // Settings written before 0.4 had a free-form system prompt: keep it as extra instructions.
  if (!saved.profile && saved.systemPrompt && !saved.systemPrompt.startsWith("Sei un assistente personale che lavora dentro un popup")) {
    merged.profile.extra = saved.systemPrompt;
  }
  // Settings written by 0.1.x kept one model field per provider.
  if (saved.anthropicModel && !merged.models.anthropic) merged.models.anthropic = saved.anthropicModel;
  if (saved.openaiModel && !merged.models.openai) merged.models.openai = saved.openaiModel;
  setLocale(merged.locale);
  return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await store();
  await s.set("settings", settings);
  await s.save();
  setLocale(settings.locale);
}

/** Fills the copied text into a prompt; both `{{text}}` and `{{testo}}` work in any language. */
export function buildPrompt(template: string, text: string): string {
  if (template.includes("{{text}}") || template.includes("{{testo}}")) {
    return template.split("{{text}}").join(text).split("{{testo}}").join(text);
  }
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

export function systemPromptFor(settings: Settings): string {
  return composeSystemPrompt(settings.profile, settings.locale);
}
