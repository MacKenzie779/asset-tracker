// src/components/AppVersion.tsx
import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

declare const __APP_VERSION__: string;

export default function AppVersion() {
  const [ver, setVer] = useState('v…');

  useEffect(() => {
    (async () => {
      // In dev, show the Git tag injected by Vite
      if (import.meta.env.DEV && __APP_VERSION__) {
        setVer(__APP_VERSION__);
        return;
      }
      // In packaged builds, show the app version (from tauri.conf / package.json)
      try {
        const v = await getVersion(); // e.g. "0.1.4"
        setVer(`v${v}`);
      } catch {
        setVer(__APP_VERSION__ || 'vdev');
      }
    })();
  }, []);

  return <span>{ver}</span>;
}

