import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSecret } from "./secrets";
import { providerInfo } from "./providers";
import { baseUrlFor, modelFor, type Settings } from "./settings";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type AiErrorKind = "no-key" | "auth" | "rate-limit" | "offline" | "too-long" | "aborted" | "other";

export class AiError extends Error {
  kind: AiErrorKind;
  retryAfter?: number;
  constructor(kind: AiErrorKind, message: string, retryAfter?: number) {
    super(message);
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

function mapError(err: unknown, settings?: Settings): AiError {
  const offline = settings ? providerInfo(settings.provider).offlineHint : "Nessuna connessione";
  if (err instanceof AiError) return err;
  if (err instanceof DOMException && err.name === "AbortError") return new AiError("aborted", "Annullato");

  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) {
    return new AiError("auth", "API key non valida o scaduta");
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    const header = err.headers?.get?.("retry-after");
    const secs = header ? Number.parseInt(String(header), 10) : NaN;
    return new AiError("rate-limit", "Troppe richieste", Number.isFinite(secs) ? secs : 20);
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof OpenAI.BadRequestError) {
    const msg = err.message || "";
    if (/too long|context|tokens/i.test(msg)) return new AiError("too-long", "Testo troppo lungo per il modello");
    return new AiError("other", msg);
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) {
    return new AiError("offline", offline);
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    return new AiError("other", `Errore ${err.status ?? ""}: ${err.message}`.trim());
  }
  return new AiError("other", err instanceof Error ? err.message : String(err));
}

/**
 * Streams the assistant's reply as text deltas.
 * Both providers are called directly from the webview with the official SDKs;
 * the key is fetched from the OS keychain for this request only.
 */
/** Builds an OpenAI SDK client for any OpenAI-compatible provider. */
async function compatibleClient(settings: Settings, apiKey: string | null, maxRetries: number): Promise<OpenAI> {
  const info = providerInfo(settings.provider);
  const baseURL = baseUrlFor(settings);
  if (info.id === "custom" && !baseURL) throw new AiError("other", "Inserisci l'URL dell'endpoint nelle impostazioni");
  // The SDK refuses an empty key; local runtimes ignore whatever we send.
  return new OpenAI({ apiKey: apiKey || "hopper", baseURL: baseURL ?? undefined, dangerouslyAllowBrowser: true, maxRetries });
}

async function keyFor(settings: Settings): Promise<string | null> {
  const info = providerInfo(settings.provider);
  const apiKey = await getSecret(settings.provider);
  if (info.needsKey && !apiKey) throw new AiError("no-key", "Nessuna API key configurata");
  return apiKey;
}

/**
 * Streams the assistant's reply as text deltas.
 * Anthropic uses its own SDK; every other provider goes through the OpenAI SDK
 * pointed at that provider's base URL. Keys are read from local storage for
 * this request only.
 */
export async function* streamChat(
  settings: Settings,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const apiKey = await keyFor(settings);
  const model = modelFor(settings);
  if (!model) throw new AiError("other", "Scegli un modello nelle impostazioni");

  try {
    if (settings.provider === "anthropic") {
      const client = new Anthropic({ apiKey: apiKey ?? "", dangerouslyAllowBrowser: true, maxRetries: 1 });
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 16000,
          system: settings.systemPrompt,
          output_config: { effort: settings.effort },
          messages,
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        throw new AiError("other", "Il modello ha rifiutato questa richiesta");
      }
      return;
    }

    const client = await compatibleClient(settings, apiKey, 1);
    const stream = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "system", content: settings.systemPrompt }, ...messages],
        stream: true,
      },
      { signal },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  } catch (err) {
    throw mapError(err, settings);
  }
}

/** Lists the models a provider exposes (OpenAI-compatible `/models`). */
export async function listModels(settings: Settings, apiKey: string | null): Promise<string[]> {
  try {
    const client = await compatibleClient(settings, apiKey, 0);
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids.sort();
  } catch (err) {
    throw mapError(err, settings);
  }
}

/** Minimal call used by Settings to verify a key or a local server. */
export async function testConnection(settings: Settings, apiKey: string | null): Promise<void> {
  try {
    if (settings.provider === "anthropic") {
      const client = new Anthropic({ apiKey: apiKey ?? "", dangerouslyAllowBrowser: true, maxRetries: 0 });
      await client.messages.create({
        model: modelFor(settings),
        max_tokens: 32,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "Rispondi solo: ok" }],
      });
      return;
    }
    const client = await compatibleClient(settings, apiKey, 0);
    await client.chat.completions.create({
      model: modelFor(settings),
      max_tokens: 8,
      messages: [{ role: "user", content: "Rispondi solo: ok" }],
    });
  } catch (err) {
    throw mapError(err, settings);
  }
}
