
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import { invoke } from '@tauri-apps/api/core';

async function applySystemTheme() {
  try {
    const theme = await invoke<string>('system_theme'); // your Rust command
    document.documentElement.classList.toggle('dark', theme === 'dark');

    // also follow live OS changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', (e) => {
      document.documentElement.classList.toggle('dark', e.matches);
    });
  } catch {}
}

// If your bundler supports top-level await (Vite does):
applySystemTheme().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})



