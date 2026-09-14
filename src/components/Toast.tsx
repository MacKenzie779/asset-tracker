import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import { t as translate } from '../lib/i18n';

export type ToastKind = 'success' | 'error' | 'info';

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
  /** Dismiss the toast after the action runs (default true). */
  closeOnClick?: boolean;
};

export type ToastInput = {
  kind?: ToastKind;
  title: string;
  description?: ReactNode;
  actions?: ToastAction[];
  /** Auto-dismiss delay in ms; `null` keeps the toast until dismissed. Default 4000, errors 8000. */
  duration?: number | null;
  /** Re-using an id replaces the existing toast instead of stacking a new one. */
  id?: string;
};

export type ToastApi = {
  show(t: ToastInput): string;
  success(title: string, opts?: Omit<ToastInput, 'kind' | 'title'>): string;
  error(title: string, opts?: Omit<ToastInput, 'kind' | 'title'>): string;
  info(title: string, opts?: Omit<ToastInput, 'kind' | 'title'>): string;
  dismiss(id: string): void;
  clear(): void;
};

type ToastItem = Omit<ToastInput, 'id' | 'kind' | 'duration'> & {
  id: string;
  kind: ToastKind;
  duration: number | null;
};

type Timer = { handle: number | null; remaining: number; startedAt: number };

const MAX_VISIBLE = 5;
const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  // Items live in a ref (imperative timers need the latest list); `bump` re-renders.
  const itemsRef = useRef<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, Timer>());
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const stopTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t?.handle != null) window.clearTimeout(t.handle);
    timersRef.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      stopTimer(id);
      const before = itemsRef.current.length;
      itemsRef.current = itemsRef.current.filter((t) => t.id !== id);
      if (itemsRef.current.length !== before) bump();
    },
    [stopTimer]
  );

  const startTimer = useCallback(
    (id: string, ms: number) => {
      stopTimer(id);
      const handle = window.setTimeout(() => dismiss(id), ms);
      timersRef.current.set(id, { handle, remaining: ms, startedAt: Date.now() });
    },
    [dismiss, stopTimer]
  );

  const pause = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (!t || t.handle == null) return;
    window.clearTimeout(t.handle);
    t.handle = null;
    t.remaining = Math.max(500, t.remaining - (Date.now() - t.startedAt));
  }, []);

  const resume = useCallback(
    (id: string) => {
      const t = timersRef.current.get(id);
      if (!t || t.handle != null) return;
      t.startedAt = Date.now();
      t.handle = window.setTimeout(() => dismiss(id), t.remaining);
    },
    [dismiss]
  );

  const show = useCallback(
    (input: ToastInput) => {
      const id = input.id ?? `toast-${++seq}`;
      const kind = input.kind ?? 'info';
      const duration =
        input.duration === undefined ? (kind === 'error' ? 8000 : 4000) : input.duration;

      const next = itemsRef.current.filter((t) => t.id !== id);
      next.push({ id, kind, duration, title: input.title, description: input.description, actions: input.actions });
      // Drop the oldest beyond the cap (and their timers).
      while (next.length > MAX_VISIBLE) {
        const dropped = next.shift();
        if (dropped) stopTimer(dropped.id);
      }
      itemsRef.current = next;
      bump();

      if (duration === null) stopTimer(id);
      else startTimer(id, duration);
      return id;
    },
    [startTimer, stopTimer]
  );

  const clear = useCallback(() => {
    for (const id of Array.from(timersRef.current.keys())) stopTimer(id);
    itemsRef.current = [];
    bump();
  }, [stopTimer]);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, opts) => show({ ...opts, kind: 'success', title }),
      error: (title, opts) => show({ ...opts, kind: 'error', title }),
      info: (title, opts) => show({ ...opts, kind: 'info', title }),
      dismiss,
      clear,
    }),
    [show, dismiss, clear]
  );

  // Clear all timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) if (t.handle != null) window.clearTimeout(t.handle);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-relevant="additions" className="t-toasts">
        {itemsRef.current.map((t) => (
          <ToastCard
            key={t.id}
            item={t}
            onDismiss={() => dismiss(t.id)}
            onPause={() => pause(t.id)}
            onResume={() => resume(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const KIND_LABEL: Record<ToastKind, 'toast.ok' | 'toast.err' | 'toast.info'> = { success: 'toast.ok', error: 'toast.err', info: 'toast.info' };

function ToastCard({
  item,
  onDismiss,
  onPause,
  onResume,
}: {
  item: ToastItem;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
      className="t-toast"
    >
      <span className={clsx('k mono', item.kind)}>{translate(KIND_LABEL[item.kind])}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="t">{item.title}</p>
        {item.description ? <div className="d">{item.description}</div> : null}
        {item.actions && item.actions.length > 0 ? (
          <div className="a">
            {item.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="t-btn t-btn--secondary t-btn--sm"
                onClick={async () => {
                  try {
                    await a.onClick();
                  } finally {
                    if (a.closeOnClick !== false) onDismiss();
                  }
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" className="x mono" aria-label={translate('toast.dismiss')} title={translate('toast.dismiss')} onClick={onDismiss}>✕</button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
