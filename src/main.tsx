
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { invoke } from '@tauri-apps/api/core';

// main.tsx (or earliest bootstrap)
// 1) opt-in browser UI to both schemes (scrollbars/forms)
const meta = document.createElement('meta');
meta.name = 'color-scheme';
meta.content = 'light dark';
document.head.appendChild(meta);

// 2) ask Tauri which scheme the portal wants

(async () => {
  try {
    const dark = await invoke<boolean>('system_prefers_dark');
    document.documentElement.classList.toggle('dark', dark);
  } catch {}
})();


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)



