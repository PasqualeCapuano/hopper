/**
 * Interface strings, powered by i18next. English is the default; every other
 * language is one JSON file in src/locales. Components use `useTranslation()`;
 * non-React code (errors, provider catalog, prompts) uses `t()` from here.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import it from "../locales/it.json";

export type Locale = "en" | "it";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "it", label: "Italiano" },
];

export type Key = keyof typeof en;

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it } },
  lng: "en",
  fallbackLng: "en",
  // Keys are flat ("popup.copy"), so the dot is not a separator.
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
});

export function setLocale(locale: Locale): void {
  if (i18next.language !== locale) void i18next.changeLanguage(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return isLocale(i18next.language) ? i18next.language : "en";
}

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "it";
}

/** Looks a string up in the current locale; `{{name}}` placeholders are filled from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  return i18next.t(key, vars);
}

/** The placeholder for the copied text in prompts, in the current locale. */
export function textToken(): string {
  return getLocale() === "it" ? "{{testo}}" : "{{text}}";
}

export default i18next;
