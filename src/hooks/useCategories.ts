import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Category = { id: number; name: string };

// global “invalidate” event so any component can tell the store to refresh
const EVT = 'categories:invalidate';

export function invalidateCategories() {
  window.dispatchEvent(new Event(EVT));
}

export function useCategories() {
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await invoke('list_categories')) as Category[];
      setCategories(rows.map(r => r.name));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // initial load
    refresh();
    // listen for invalidation
    const handler = () => refresh();
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, [refresh]);

  return { categories, loading, refresh };
}
