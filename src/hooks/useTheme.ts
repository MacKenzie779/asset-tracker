import { useCallback, useSyncExternalStore } from 'react';
import {
  getResolvedTheme,
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from '../lib/theme';

export function useTheme() {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference);
  const resolved = useSyncExternalStore(subscribeTheme, getResolvedTheme);
  const setPreference = useCallback((p: ThemePreference) => setThemePreference(p), []);
  return { preference, resolved, setPreference };
}
