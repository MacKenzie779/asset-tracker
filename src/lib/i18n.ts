// Language store, shaped like lib/theme: a tiny external store the components
// subscribe to through useSyncExternalStore, so switching the language
// re-renders everything that reads a string.
//
// `t(key, params)` looks the key up in the active dictionary and fills `{name}`
// placeholders. `tn(base, n, params)` picks the `.one` / `.other` form and
// passes `n` along, so `tn('blotter.rowCount', 3)` -> "3 rows".
import { de } from '../locales/de';
import { en } from '../locales/en';

export type Lang = 'en' | 'de';
export type Dict = Record<keyof typeof en, string>;
export type TKey = keyof typeof en;

/** Keys that exist in a `.one` / `.other` pair, addressed without the suffix.
 *  Written through a generic so the conditional distributes over the key union. */
type StripOne<T> = T extends `${infer B}.one` ? B : never;
export type PluralKey = StripOne<TKey>;

export type TParams = Record<string, string | number>;

export const LANG_KEY = 'assettracker.lang';

const DICTS: Record<Lang, Dict> = { en, de };

let lang: Lang = read();
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'de') return v;
  } catch {}
  // First run: follow the OS/browser language, default to English.
  try {
    if (navigator.language?.toLowerCase().startsWith('de')) return 'de';
  } catch {}
  return 'en';
}

/** Call once, before the first React render. */
export function initI18n() {
  document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch {}
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export function subscribeLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function fill(s: string, params?: TParams): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function t(key: TKey, params?: TParams): string {
  const d = DICTS[lang];
  // A key missing from a translation falls back to English rather than blanking the UI.
  return fill(d[key] ?? en[key] ?? key, params);
}

export function tn(base: PluralKey, n: number, params?: TParams): string {
  const key = `${base}.${n === 1 ? 'one' : 'other'}` as TKey;
  return t(key, { n, ...params });
}

/** 1-based month (1 = January) as the locale's three-letter abbreviation. */
export function monthShort(month1: number): string {
  return t(`month.${month1}` as TKey);
}

/** Monday-first weekday abbreviations, for the calendar header. */
export function weekdaysShort(): string[] {
  return [1, 2, 3, 4, 5, 6, 7].map((n) => t(`weekday.${n}` as TKey));
}
