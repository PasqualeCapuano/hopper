/**
 * Provider catalog. Everything except Anthropic speaks the OpenAI-compatible
 * chat completions API, so one code path covers cloud providers, OpenRouter
 * and local runtimes (Ollama, LM Studio).
  * Descriptions and offline hints come from the locale files (prov.<id>.*).
 */
import { t } from "./i18n";

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
  /** Short description, in the interface language. */
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
    get desc() { return t("prov.anthropic.desc"); },
    api: "anthropic",
    baseURL: null,
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-api03-…",
    defaultModel: "claude-opus-5-5",
    get offlineHint() { return t("prov.anthropic.offline"); },
    local: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    get desc() { return t("prov.openai.desc"); },
    api: "openai-compatible",
    baseURL: null,
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    defaultModel: "gpt-5",
    get offlineHint() { return t("prov.openai.offline"); },
    local: false,
  },
  {
    id: "ollama",
    name: "Ollama",
    get desc() { return t("prov.ollama.desc"); },
    api: "openai-compatible",
    baseURL: "http://localhost:11434/v1",
    needsKey: false,
    keyUrl: "https://ollama.com/download",
    keyPlaceholder: "",
    defaultModel: "llama3.2",
    get offlineHint() { return t("prov.ollama.offline"); },
    local: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    get desc() { return t("prov.lmstudio.desc"); },
    api: "openai-compatible",
    baseURL: "http://localhost:1234/v1",
    needsKey: false,
    keyUrl: "https://lmstudio.ai",
    keyPlaceholder: "",
    defaultModel: "",
    get offlineHint() { return t("prov.lmstudio.offline"); },
    local: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    get desc() { return t("prov.openrouter.desc"); },
    api: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
    defaultModel: "openrouter/auto",
    get offlineHint() { return t("prov.openrouter.offline"); },
    local: false,
  },
  {
    id: "gemini",
    name: "Gemini",
    get desc() { return t("prov.gemini.desc"); },
    api: "openai-compatible",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    defaultModel: "gemini-2.5-flash",
    get offlineHint() { return t("prov.gemini.offline"); },
    local: false,
  },
  {
    id: "mistral",
    name: "Mistral",
    get desc() { return t("prov.mistral.desc"); },
    api: "openai-compatible",
    baseURL: "https://api.mistral.ai/v1",
    needsKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "…",
    defaultModel: "mistral-large-latest",
    get offlineHint() { return t("prov.mistral.offline"); },
    local: false,
  },
  {
    id: "groq",
    name: "Groq",
    get desc() { return t("prov.groq.desc"); },
    api: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    defaultModel: "llama-3.3-70b-versatile",
    get offlineHint() { return t("prov.groq.offline"); },
    local: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    get desc() { return t("prov.deepseek.desc"); },
    api: "openai-compatible",
    baseURL: "https://api.deepseek.com/v1",
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-…",
    defaultModel: "deepseek-chat",
    get offlineHint() { return t("prov.deepseek.offline"); },
    local: false,
  },
  {
    id: "custom",
    get name() { return t("prov.custom.name"); },
    get desc() { return t("prov.custom.desc"); },
    api: "openai-compatible",
    baseURL: "",
    needsKey: false,
    keyUrl: null,
    get keyPlaceholder() { return t("prov.custom.keyPh"); },
    defaultModel: "",
    get offlineHint() { return t("prov.custom.offline"); },
    local: false,
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
