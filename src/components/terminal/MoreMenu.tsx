import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useAnchoredMenu } from '../../hooks/useAnchoredMenu';

export type MenuAction = { label: string; onClick: () => void; danger?: boolean; hint?: string; disabled?: boolean };

/** The collapsed `⋯` row affordance: one button, one portal menu. */
export default function MoreMenu({ actions, label, className }: { actions: MenuAction[]; label: string; className?: string }) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const listId = useId();
  const pos = useAnchoredMenu(open, btnRef, 160);

  useEffect(() => {
    if (!open) return;
    setHl(0);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (document.getElementById(listId)?.parentElement?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, listId]);

  const run = (a: MenuAction) => {
    if (a.disabled) return;
    setOpen(false);
    a.onClick();
  };

  const keyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(true); }
      return;
    }
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, actions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(actions[hl]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const width = 170;
  const left = pos ? Math.max(8, pos.left + pos.width - width) : 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={clsx('t-more', className)}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onKeyDown={keyDown}
      >
        ⋯
      </button>
      {open && pos && createPortal(
        <div className="t-menu" style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left, width }}>
          <ul id={listId} role="menu" aria-label={label}>
            {actions.map((a, idx) => (
              <li
                key={a.label}
                role="menuitem"
                aria-disabled={a.disabled || undefined}
                className={clsx('t-menu-item', idx === hl && 'is-hl')}
                style={{ color: a.danger ? 'var(--neg-muted)' : undefined, opacity: a.disabled ? 0.45 : undefined }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHl(idx)}
                onClick={(e) => { e.stopPropagation(); run(a); }}
              >
                <span className="t-truncate" style={{ flex: 1 }}>{a.label}</span>
                {a.hint && <span className="meta" style={{ fontSize: 9 }}>{a.hint}</span>}
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
}
