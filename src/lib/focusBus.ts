// Lets a keyboard shortcut in Layout focus a field owned by a page — even when the
// shortcut also navigates there and the field only mounts afterwards.
import { useEffect, type RefObject } from 'react';

export type FocusTarget = 'search' | 'quick-add';

const EVT = 'assettracker:focus';
const PENDING_TTL = 2000;

let pending: { target: FocusTarget; at: number } | null = null;

export function requestFocus(target: FocusTarget) {
  pending = { target, at: Date.now() };
  window.dispatchEvent(new CustomEvent<FocusTarget>(EVT, { detail: target }));
}

function consumePending(target: FocusTarget): boolean {
  if (pending && pending.target === target && Date.now() - pending.at < PENDING_TTL) {
    pending = null;
    return true;
  }
  return false;
}

/** Focus `ref` when `target` is requested — on mount if a request is pending, or live via the event. */
export function useFocusTarget(target: FocusTarget, ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const focus = () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    };

    let mountTimer: number | null = null;
    if (consumePending(target)) mountTimer = window.setTimeout(focus, 0);

    const handler = (e: Event) => {
      if ((e as CustomEvent<FocusTarget>).detail !== target) return;
      pending = null;
      focus();
    };
    window.addEventListener(EVT, handler);
    return () => {
      if (mountTimer != null) window.clearTimeout(mountTimer);
      window.removeEventListener(EVT, handler);
    };
  }, [target, ref]);
}
