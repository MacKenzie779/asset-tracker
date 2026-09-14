import { t } from './i18n';

/** Turn whatever a Tauri command or a thrown value gives us into a readable string. */
export function errorMessage(e: unknown, fallback = t('error.generic')): string {
  if (typeof e === 'string') return e.trim() || fallback;
  if (e instanceof Error) return e.message || fallback;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  try {
    const s = String(e);
    return s && s !== '[object Object]' && s !== 'undefined' && s !== 'null' ? s : fallback;
  } catch {
    return fallback;
  }
}
