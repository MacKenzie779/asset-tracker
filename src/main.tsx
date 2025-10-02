import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// meta: let forms/scrollbars follow theme
const meta = document.createElement('meta');
meta.name = 'color-scheme';
meta.content = 'light dark';
document.head.appendChild(meta);

// initial apply (your existing code)
(async () => {
  try {
    const dark = await invoke<boolean>('system_prefers_dark');
    document.documentElement.classList.toggle('dark', dark);
  } catch {}
})();

// live updates
listen<boolean>('theme-updated', (e) => {
  document.documentElement.classList.toggle('dark', !!e.payload);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
