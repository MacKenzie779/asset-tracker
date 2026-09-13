import { useEffect, useState, type RefObject } from 'react';

export type MenuPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  flipped: boolean;
};

const GAP = 6;
const EDGE = 8;

/**
 * Viewport-fixed position for a portal menu anchored to `anchorRef`.
 * Opens below the anchor; flips above when there is not enough room underneath.
 * Re-measures on scroll (any container) and resize while open.
 */
export function useAnchoredMenu(
  open: boolean,
  anchorRef: RefObject<HTMLElement>,
  preferredHeight = 264
): MenuPosition | null {
  const [pos, setPos] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - EDGE;
      const spaceAbove = r.top - EDGE;
      const flipped = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
      if (flipped) {
        setPos({
          bottom: window.innerHeight - r.top + GAP,
          left: r.left,
          width: r.width,
          maxHeight: Math.max(120, Math.min(256, spaceAbove - GAP)),
          flipped,
        });
      } else {
        setPos({
          top: r.bottom + GAP,
          left: r.left,
          width: r.width,
          maxHeight: Math.max(120, Math.min(256, spaceBelow - GAP)),
          flipped,
        });
      }
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, anchorRef, preferredHeight]);

  return pos;
}
