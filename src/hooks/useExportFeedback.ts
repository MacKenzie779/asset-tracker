import { useCallback } from 'react';
import { open as openWithSystem } from '@tauri-apps/plugin-shell';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/errors';
import { t } from '../lib/i18n';
import { basename, dirname } from '../lib/path';

/** "Export saved" toast with Open / Show folder actions. */
export function useExportFeedback() {
  const toast = useToast();
  const openPath = useCallback(
    async (p: string) => {
      try { await openWithSystem(p); } catch (e) { toast.error(t('export.openFailed'), { description: errorMessage(e) }); }
    },
    [toast]
  );
  return useCallback(
    (path: string) =>
      toast.success(t('export.savedToast'), {
        description: basename(path),
        duration: 10000,
        actions: [
          { label: t('action.open'), onClick: () => openPath(path) },
          { label: t('action.showFolder'), onClick: () => openPath(dirname(path)) },
        ],
      }),
    [toast, openPath]
  );
}
