import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import ReactDOM from 'react-dom';
import clsx from 'clsx';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Right-aligned actions row rendered below the content. */
  footer?: ReactNode;
  size?: ModalSize;
  role?: 'dialog' | 'alertdialog';
  /** What receives focus on open: a ref, the first focusable element, or the panel itself. */
  initialFocus?: RefObject<HTMLElement> | 'first' | 'panel';
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  /** Replaces the default surface classes (background/border) of the panel. */
  panelClassName?: string;
};

const SIZE: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let openCount = 0;

/** True while at least one Modal is mounted and open. Used to silence global shortcuts. */
export function isAnyModalOpen(): boolean {
  return openCount > 0;
}

/**
 * Accessible dialog shell: portal, backdrop, focus trap, Escape, focus restore, scroll lock.
 * All other dialogs in the app render through this.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  role = 'dialog',
  initialFocus = 'first',
  closeOnBackdrop = true,
  closeOnEscape = true,
  panelClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // Keep the latest callbacks/options in refs so the open effect only depends on `open`.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  useEffect(() => {
    if (!open) return;
    openCount += 1;

    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef.current;
      let el: HTMLElement | null = null;
      if (target === 'panel') el = panel;
      else if (target === 'first') el = panel.querySelector<HTMLElement>(FOCUSABLE);
      else el = target.current ?? panel.querySelector<HTMLElement>(FOCUSABLE);
      (el ?? panel).focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      openCount = Math.max(0, openCount - 1);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') {
        prevFocus.focus();
      }
    };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (closeOnEscape) {
        e.stopPropagation();
        onCloseRef.current();
      }
      return;
    }
    if (e.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null
    );
    if (nodes.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && panel.contains(active);
    if (e.shiftKey) {
      if (!inside || active === first || active === panel) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last || active === panel) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
        onClick={closeOnBackdrop ? () => onCloseRef.current() : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        onKeyDown={onKeyDown}
        className={clsx(
          'relative z-10 w-[92vw] rounded-2xl border shadow-xl outline-none motion-safe:animate-modal-in',
          SIZE[size],
          panelClassName ??
            'bg-white dark:bg-neutral-900 border-neutral-200/60 dark:border-neutral-800/60'
        )}
      >
        <div className="p-5">
          {title ? (
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
          ) : null}
          {description ? (
            <div
              id={descId}
              className="mt-2 whitespace-pre-line break-words text-sm text-neutral-600 dark:text-neutral-400"
            >
              {description}
            </div>
          ) : null}
          {children ? <div className={clsx((title || description) && 'mt-4')}>{children}</div> : null}
          {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(node, document.body);
}
