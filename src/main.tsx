// main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTheme } from './lib/theme';

// Apply the persisted / OS theme before the first paint.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
