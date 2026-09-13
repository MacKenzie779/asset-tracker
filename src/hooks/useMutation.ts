import { useCallback } from 'react';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/errors';

/**
 * Runs an async mutation and reports the outcome as a toast.
 * Rethrows on failure so the caller can keep its editing state.
 */
export function useMutation() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, msgs: { success?: string; error: string }): Promise<T> => {
      try {
        const result = await fn();
        if (msgs.success) toast.success(msgs.success);
        return result;
      } catch (e) {
        toast.error(msgs.error, { description: errorMessage(e) });
        throw e;
      }
    },
    [toast]
  );
}
