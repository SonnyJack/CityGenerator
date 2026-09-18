import { create } from 'zustand';
import { fr } from './fr.js';
import { de } from './de.js';
import { es } from './es.js';

/**
 * UI localisation. Keys are the English strings; a dictionary per locale
 * maps them to translations, and a missing entry falls back to English.
 * Generated content (place names, room names, use labels) stays in the
 * document's language; only the chrome is translated.
 */
export type Locale = 'en' | 'fr' | 'de' | 'es';

export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'es', name: 'Español' },
];

export const DICTIONARIES: Record<Exclude<Locale, 'en'>, Record<string, string>> = { fr, de, es };

const STORAGE = 'citygen.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved && LOCALES.some((l) => l.id === saved)) return saved as Locale;
  } catch {
    // No storage: fall through to the browser language.
  }
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
  return LOCALES.some((l) => l.id === lang) ? (lang as Locale) : 'en';
}

interface LocaleState {
  locale: Locale;
  setLocale(locale: Locale): void;
}

export const useLocale = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale(locale) {
    try {
      localStorage.setItem(STORAGE, locale);
    } catch {
      // Remembered for this session only.
    }
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
    set({ locale });
  },
}));

if (typeof document !== 'undefined') document.documentElement.lang = useLocale.getState().locale;

/** Translate `key` into `locale`, filling `{name}` placeholders from `vars`. */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const text = locale === 'en' ? key : (DICTIONARIES[locale][key] ?? key);
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Translate with the current locale (no re-render on change; use `useT` in components). */
export const t: Translate = (key, vars) => translate(useLocale.getState().locale, key, vars);

/** The translation function bound to the current locale, re-rendering on change. */
export function useT(): Translate {
  const locale = useLocale((s) => s.locale);
  return (key, vars) => translate(locale, key, vars);
}
