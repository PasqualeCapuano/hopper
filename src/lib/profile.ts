/** Structured description of the user that becomes the system prompt. */
import { getLocale, t, type Locale } from "./i18n";

export type Language = "auto" | "it" | "en" | "other";
export type Tone = "direct" | "warm" | "formal" | "casual";
export type Length = "short" | "normal" | "detailed";

export interface Profile {
  name: string;
  role: string;
  language: Language;
  languageOther: string;
  tone: Tone;
  length: Length;
  signature: string;
  extra: string;
}

export const DEFAULT_PROFILE: Profile = {
  name: "",
  role: "",
  language: "auto",
  languageOther: "",
  tone: "direct",
  length: "normal",
  signature: "",
  extra: "",
};

export const LANGUAGE_IDS: Language[] = ["auto", "it", "en", "other"];
export const TONE_IDS: Tone[] = ["direct", "warm", "formal", "casual"];
export const LENGTH_IDS: Length[] = ["short", "normal", "detailed"];

export function languages(): { id: Language; label: string }[] {
  return LANGUAGE_IDS.map((id) => ({ id, label: t(`lang.${id}`) }));
}
export function tones(): { id: Tone; label: string; hint: string }[] {
  return TONE_IDS.map((id) => ({ id, label: t(`tone.${id}`), hint: t(`tone.${id}.hint`) }));
}
export function lengths(): { id: Length; label: string; hint: string }[] {
  return LENGTH_IDS.map((id) => ({ id, label: t(`len.${id}`), hint: t(`len.${id}.hint`) }));
}

/** The system prompt, written in the interface language. */
export function composeSystemPrompt(p: Profile, locale: Locale = getLocale()): string {
  return locale === "it" ? composeIt(p) : composeEn(p);
}

function composeEn(p: Profile): string {
  const lines: string[] = [];
  const who = p.name.trim() ? `${p.name.trim()}'s` : "the user's";
  const role = p.role.trim() ? ` (${p.role.trim()})` : "";
  lines.push(`You are ${who} personal assistant${role}. You work inside a system popup: answer right away, with no preamble, without repeating the question and without pleasantries.`);

  switch (p.language) {
    case "auto": lines.push("Language: answer in the language of the copied text. If the request is in another language, use the language of the request."); break;
    case "it": lines.push("Language: always answer in Italian, whatever language the text is in."); break;
    case "en": lines.push("Language: always answer in English, whatever language the text is in."); break;
    case "other": lines.push(`Language: always answer in ${p.languageOther.trim() || "English"}.`); break;
  }

  switch (p.tone) {
    case "direct": lines.push("Tone: direct and dry, like an experienced colleague who is short on time."); break;
    case "warm": lines.push("Tone: warm and concrete, kind without being wordy."); break;
    case "formal": lines.push("Tone: formal and professional; in messages, use polite forms of address."); break;
    case "casual": lines.push("Tone: casual and relaxed, like between friends; in messages, be informal."); break;
  }

  switch (p.length) {
    case "short": lines.push("Length: as short as possible. One sentence if one sentence is enough."); break;
    case "normal": lines.push("Length: as much as needed and no more."); break;
    case "detailed": lines.push("Length: complete, with explanations and examples when they help."); break;
  }

  const sig = p.signature.trim() || p.name.trim();
  if (sig) lines.push(`When you write a message or an email on the user's behalf, sign it "${sig}".`);
  if (p.extra.trim()) lines.push(p.extra.trim());
  return lines.join("\n");
}

function composeIt(p: Profile): string {
  const lines: string[] = [];
  const who = p.name.trim() ? `di ${p.name.trim()}` : "dell'utente";
  const role = p.role.trim() ? ` (${p.role.trim()})` : "";
  lines.push(`Sei l'assistente personale ${who}${role}. Lavori dentro un popup di sistema: rispondi subito a ciò che viene chiesto, senza preamboli, senza ripetere la domanda e senza formule di cortesia.`);

  switch (p.language) {
    case "auto": lines.push("Lingua: rispondi nella lingua del testo copiato. Se la richiesta è in un'altra lingua, usa quella della richiesta."); break;
    case "it": lines.push("Lingua: rispondi sempre in italiano, anche se il testo è in un'altra lingua."); break;
    case "en": lines.push("Language: always answer in English, whatever language the text is in."); break;
    case "other": lines.push(`Lingua: rispondi sempre in ${p.languageOther.trim() || "italiano"}.`); break;
  }

  switch (p.tone) {
    case "direct": lines.push("Tono: diretto e asciutto, come un collega esperto che ha poco tempo."); break;
    case "warm": lines.push("Tono: cordiale e concreto, gentile senza essere prolisso."); break;
    case "formal": lines.push("Tono: formale e professionale; nei messaggi dai del lei."); break;
    case "casual": lines.push("Tono: informale e rilassato, come tra amici; nei messaggi dai del tu."); break;
  }

  switch (p.length) {
    case "short": lines.push("Lunghezza: il più breve possibile. Una frase se basta una frase."); break;
    case "normal": lines.push("Lunghezza: quanto serve e non di più."); break;
    case "detailed": lines.push("Lunghezza: completa, con spiegazioni ed esempi quando aiutano."); break;
  }

  const sig = p.signature.trim() || p.name.trim();
  if (sig) lines.push(`Quando scrivi un messaggio o una email per conto dell'utente, firmalo "${sig}".`);
  if (p.extra.trim()) lines.push(p.extra.trim());
  return lines.join("\n");
}
