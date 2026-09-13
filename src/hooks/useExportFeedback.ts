import { useCallback } from 'react';
import { open as openWithSystem } from '@tauri-apps/plugin-shell';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/errors';
import { basename, dirname } from '../lib/path';

/** "Export saved" toast with Open / Show folder actions. */
export function useExportFeedback() {
  const toast = useToast();
  const openPath = useCallback(
    async (p: string) => {
      try { await openWithSystem(p); } catch (e) { toast.error('Could not open', { description: errorMessage(e) }); }
    },
    [toast]
  );
  return useCallback(
    (path: string) =>
      toast.success('Export saved', {
        description: basename(path),
        duration: 10000,
        actions: [
          { label: 'OPEN', onClick: () => openPath(path) },
          { label: 'SHOW FOLDER', onClick: () => openPath(dirname(path)) },
        ],
      }),
    [toast, openPath]
  );
}
