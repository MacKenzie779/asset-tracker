import { useCallback, useSyncExternalStore } from 'react';
import {
  getLang, setLang, subscribeLang, t, tn,
  type Lang, type PluralKey, type TKey, type TParams,
} from '../lib/i18n';

/**
 * Subscribes the calling component to language changes.
 *
 * The returned `t` / `tn` change identity whenever the language changes, so a
 * `useMemo` / `useCallback` that builds translated strings only has to list `t`
 * in its dependencies to be rebuilt on a switch. (The module-level `t` in
 * lib/i18n is stable and is the one to use outside of render.)
 */
export function useI18n() {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  const tr = useCallback((key: TKey, params?: TParams) => t(key, params), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const trn = useCallback((base: PluralKey, n: number, params?: TParams) => tn(base, n, params), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = useCallback((l: Lang) => setLang(l), []);
  return { lang, setLang: change, t: tr, tn: trn };
}
