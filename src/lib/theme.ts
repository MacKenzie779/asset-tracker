// Theme store. The `dark` class on <html> is the only thing Tailwind looks at.
//
// Preference ('light' | 'dark' | 'system') is persisted in localStorage.
// 'system' reproduces the original behaviour exactly: prefers-color-scheme plus,
// on Linux, the XDG portal via the `system_prefers_dark` command and the
// `theme-updated` event pushed from Rust. Those OS sources keep running while a
// fixed theme is selected so switching back to 'system' is instant.
import type { CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'assettracker.theme';

let pref: ThemePreference = readPreference();
let systemDark = false;
let resolved: ResolvedTheme = 'light';
let initialized = false;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolve(): ResolvedTheme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

function apply() {
  resolved = resolve();
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  listeners.forEach((l) => l());
}

function isLinuxUA() {
  const ua = navigator.userAgent.toLowerCase();
  // catches Linux and many Wayland/X11 embeds; ignores Android
  return ua.includes(' linux ') || ua.endsWith(' linux') || ua.includes(' x11; linux');
}

/** Call once, synchronously, before the first React render. */
export function initTheme() {
  if (initialized) return;
  initialized = true;

  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  systemDark = mql?.matches ?? false;
  apply();
  mql?.addEventListener?.('change', (e: MediaQueryListEvent) => {
    systemDark = e.matches;
    apply();
  });

  if (isLinuxUA()) {
    (async () => {
      try {
        const dark = await invoke<boolean>('system_prefers_dark');
        systemDark = !!dark;
        apply();
      } catch {}
      try {
        await listen<boolean>('theme-updated', (e) => {
          systemDark = !!e.payload;
          apply();
        });
      } catch {}
    })();
  }
}

export function getThemePreference(): ThemePreference {
  return pref;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolved;
}

export function setThemePreference(p: ThemePreference) {
  pref = p;
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {}
  apply();
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/* ---------- chart colours (Recharts needs plain strings, not classes) ---------- */
export type ChartTheme = {
  grid: string;
  axis: string;
  tick: string;
  text: string;
  surface: string;
  cursor: string;
  positive: string; // emerald
  negative: string; // rose
  accent: string;   // blue
  tooltip: CSSProperties;
};

export function chartTheme(theme: ResolvedTheme): ChartTheme {
  const dark = theme === 'dark';
  const surface = dark ? '#171717' : '#ffffff';
  const axis = dark ? '#404040' : '#d4d4d4';
  const text = dark ? '#e5e5e5' : '#171717';
  return {
    grid: dark ? '#262626' : '#e5e5e5',
    axis,
    tick: dark ? '#a3a3a3' : '#737373',
    text,
    surface,
    cursor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    positive: dark ? '#34d399' : '#059669',
    negative: dark ? '#fb7185' : '#e11d48',
    accent: dark ? '#60a5fa' : '#2563eb',
    tooltip: {
      backgroundColor: surface,
      border: `1px solid ${axis}`,
      color: text,
      borderRadius: 12,
      boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
    },
  };
}
