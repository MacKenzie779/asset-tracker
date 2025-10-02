// main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

function applyDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', !!dark);
}

function isLinuxUA() {
  const ua = navigator.userAgent.toLowerCase();
  // catches Linux and many Wayland/X11 embeds; ignores Android
  return ua.includes(' linux ') || ua.endsWith(' linux') || ua.includes(' x11; linux');
}

(async () => {
  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  applyDark(mql?.matches ?? false);
  const onMql = (e: MediaQueryListEvent) => applyDark(e.matches);
  mql?.addEventListener?.('change', onMql);

  if (isLinuxUA()) {
    try {
      const dark = await invoke<boolean>('system_prefers_dark');
      applyDark(dark);
    } catch {}
    try {
      await listen<boolean>('theme-updated', (e) => applyDark(!!e.payload));
    } catch {}
  }
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
