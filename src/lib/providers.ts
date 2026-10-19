/**
 * Provider catalog. Everything except Anthropic speaks the OpenAI-compatible
 * chat completions API, so one code path covers cloud providers, OpenRouter
 * and local runtimes (Ollama, LM Studio).
 */
export type ProviderId =
  | "anthropic"
  | "openai"
  | "ollama"
  | "lmstudio"
  | "openrouter"
  | "gemini"
  | "mistral"
  | "groq"
  | "deepseek"
  | "custom";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  desc: string;
  api: "anthropic" | "openai-compatible";
  /** Base URL for OpenAI-compatible providers. `null` for the SDK default. */
  baseURL: string | null;
  /** Local runtimes need no key. */
  needsKey: boolean;
  /** Where to create a key. */
  keyUrl: string | null;
  keyPlaceholder: string;
  defaultModel: string;
  /** Shown when the provider cannot be reached. */
  offlineHint: string;
  local: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Claude",
    desc: "Anthropic. Con Max hai crediti API inclusi.",
    api: "anthropic",
    baseURL: null,
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-api03-…",
    defaultModel: "claude-opus-5-5",
    offlineHint: "Nessuna connessione ad Anthropic.",
    local: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    desc: "GPT, con la chiave di platform.openai.com.",
    api: "openai-compatible",
    baseURL: null,
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    defaultModel: "gpt-5",
    offlineHint: "Nessuna connessione a OpenAI.",
    local: false,
  },
  {
    id: "ollama",
    name: "Ollama",
    desc: "Modelli sul tuo computer. Gratis, offline, privato.",
    api: "openai-compatible",
    baseURL: "http://localhost:11434/v1",
    needsKey: false,
    keyUrl: "https://ollama.com/download",
    keyPlaceholder: "",
    defaultModel: "llama3.2",
    offlineHint: "Ollama non risponde su localhost:11434. Avvialo, oppure installalo da ollama.com e scarica un modello con `ollama pull llama3.2`.",
    local: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    desc: "Modelli locali tramite il server di LM Studio.",
    api: "openai-compatible",
    baseURL: "http://localhost:1234/v1",
    needsKey: false,
    keyUrl: "https://lmstudio.ai",
    keyPlaceholder: "",
    defaultModel: "",
    offlineHint: "LM Studio non risponde su localhost:1234. Apri LM Studio e avvia il server locale (Developer › Start server).",
    local: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    desc: "Una chiave, centinaia di modelli.",
    api: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
    defaultModel: "openrouter/auto",
    offlineHint: "Nessuna connessione a OpenRouter.",
    local: false,
  },
  {
    id: "gemini",
    name: "Gemini",
    desc: "Google AI Studio.",
    api: "openai-compatible",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    defaultModel: "gemini-2.5-flash",
    offlineHint: "Nessuna connessione a Google.",
    local: false,
  },
  {
    id: "mistral",
    name: "Mistral",
    desc: "Modelli europei, La Plateforme.",
    api: "openai-compatible",
    baseURL: "https://api.mistral.ai/v1",
    needsKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "…",
    defaultModel: "mistral-large-latest",
    offlineHint: "Nessuna connessione a Mistral.",
    local: false,
  },
  {
    id: "groq",
    name: "Groq",
    desc: "Risposte velocissime su modelli aperti.",
    api: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    defaultModel: "llama-3.3-70b-versatile",
    offlineHint: "Nessuna connessione a Groq.",
    local: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    desc: "Economico, buono su codice e ragionamento.",
    api: "openai-compatible",
    baseURL: "https://api.deepseek.com/v1",
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-…",
    defaultModel: "deepseek-chat",
    offlineHint: "Nessuna connessione a DeepSeek.",
    local: false,
  },
  {
    id: "custom",
    name: "Personalizzato",
    desc: "Qualsiasi endpoint compatibile OpenAI.",
    api: "openai-compatible",
    baseURL: "",
    needsKey: false,
    keyUrl: null,
    keyPlaceholder: "chiave, se richiesta",
    defaultModel: "",
    offlineHint: "L'endpoint non risponde. Controlla l'URL nelle impostazioni.",
    local: false,
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
