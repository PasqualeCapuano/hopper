/** Structured description of the user that becomes the system prompt. */
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

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "auto", label: "Come il testo" },
  { id: "it", label: "Italiano" },
  { id: "en", label: "English" },
  { id: "other", label: "Altra" },
];

export const TONES: { id: Tone; label: string; hint: string }[] = [
  { id: "direct", label: "Diretto", hint: "va al punto, niente giri di parole" },
  { id: "warm", label: "Cordiale", hint: "gentile ma concreto" },
  { id: "formal", label: "Formale", hint: "professionale, dà del lei" },
  { id: "casual", label: "Informale", hint: "come tra amici" },
];

export const LENGTHS: { id: Length; label: string; hint: string }[] = [
  { id: "short", label: "Breve", hint: "il minimo indispensabile" },
  { id: "normal", label: "Normale", hint: "quanto serve, senza allungare" },
  { id: "detailed", label: "Dettagliata", hint: "spiega e approfondisce" },
];

export function composeSystemPrompt(p: Profile): string {
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
