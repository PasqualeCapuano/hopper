import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSecret } from "./secrets";
import { modelFor, type Settings } from "./settings";

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

function mapError(err: unknown): AiError {
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
    return new AiError("offline", "Nessuna connessione");
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
export async function* streamChat(
  settings: Settings,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const apiKey = await getSecret(settings.provider);
  if (!apiKey) throw new AiError("no-key", "Nessuna API key configurata");
  const model = modelFor(settings);

  try {
    if (settings.provider === "anthropic") {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
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

    const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const stream = await client.responses.create(
      {
        model,
        instructions: settings.systemPrompt,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") yield event.delta;
    }
  } catch (err) {
    throw mapError(err);
  }
}

/** Minimal call used by Settings to verify a key. */
export async function testConnection(settings: Settings, apiKey: string): Promise<void> {
  try {
    if (settings.provider === "anthropic") {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
      await client.messages.create({
        model: modelFor(settings),
        max_tokens: 32,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "Rispondi solo: ok" }],
      });
      return;
    }
    const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    await client.responses.create({ model: modelFor(settings), input: "Rispondi solo: ok" });
  } catch (err) {
    throw mapError(err);
  }
}
