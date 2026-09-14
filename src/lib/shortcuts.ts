import { t } from './i18n';

export type Shortcut = {
  id: string;
  /** Display form, e.g. 'Mod+K', '/', 'N', '?', 'Mod+Shift+L', 'Mod+1…5'. */
  keys: string;
  description: string;
  match: (e: KeyboardEvent) => boolean;
  run: (e: KeyboardEvent) => void;
  /** Fires even while typing in a field (only sensible for Mod combos). */
  global?: boolean;
  when?: () => boolean;
};

export const isMod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;

/** True when key presses on `t` are text input (so single-key shortcuts must stay quiet). */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  const role = t.getAttribute('role');
  return role === 'combobox' || role === 'textbox';
}

const IS_MAC = /Macintosh|Mac OS X|iPhone|iPad/i.test(navigator.userAgent);

/** 'Mod+Shift+L' -> ['⌘', 'Shift', 'L'] on macOS, ['Ctrl'/'Strg', 'Shift', 'L'] elsewhere. */
export function formatKeys(keys: string): string[] {
  return keys.split('+').map((k) => (k === 'Mod' ? (IS_MAC ? '⌘' : t('key.ctrl')) : k));
}
