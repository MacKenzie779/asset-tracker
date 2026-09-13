import { useEffect, useRef } from 'react';
import { isAnyModalOpen } from '../components/Modal';
import { isEditableTarget, type Shortcut } from '../lib/shortcuts';

/**
 * One window keydown listener for the given shortcuts.
 * Silent while a dialog is open; single-key shortcuts are also silent while typing.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (isAnyModalOpen()) return;
      const editable = isEditableTarget(e.target);
      for (const s of ref.current) {
        if (s.when && !s.when()) continue;
        if (!s.global && (editable || e.ctrlKey || e.metaKey || e.altKey)) continue;
        if (s.match(e)) {
          e.preventDefault();
          s.run(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
