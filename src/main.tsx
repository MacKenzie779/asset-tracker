
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import { invoke } from '@tauri-apps/api/core';

(async () => {
  try {
    // only apply if you’re using Tailwind `darkMode: 'class'`
    // (for `darkMode: 'media'` this isn’t needed)
    const theme = await invoke<string>('system_theme');
    document.documentElement.classList.toggle('dark', theme === 'dark');

    // keep following system changes too
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', (e) => {
      document.documentElement.classList.toggle('dark', e.matches);
    });
  } catch {}
})();





ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
