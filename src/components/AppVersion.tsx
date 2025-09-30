// src/components/AppVersion.tsx
import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

// If you also keep the Vite define, declare it (optional fallback):
declare const __APP_VERSION__: string | undefined;

export default function AppVersion() {
  const [ver, setVer] = useState<string>('');
  useEffect(() => {
    (async () => {
      try {
        const v = await getVersion();   // e.g. "0.1.4"
        setVer(`v${v}`);
      } catch {
        // fallback to build-time define if present
        if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__) {
          setVer(__APP_VERSION__);
        } else {
          setVer('vdev');
        }
      }
    })();
  }, []);
  return <span>{ver}</span>;
}
