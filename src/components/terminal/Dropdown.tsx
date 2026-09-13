import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useAnchoredMenu } from '../../hooks/useAnchoredMenu';

export type DDOption = { value: string; label: string; color?: string | null };

type Props = {
  options: DDOption[];
  value: string;
  onChange: (v: string) => void;
  /** Trigger text; defaults to the selected option's label. */
  label?: string;
  ariaLabel: string;
  /** Highlight the trigger when the value is not the default. */
  isSet?: boolean;
  align?: 'left' | 'right';
  className?: string;
};

/** `LABEL ▾` trigger with a portal listbox. */
export default function Dropdown({ options, value, onChange, label, ariaLabel, isSet, align = 'right', className }: Props) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const listId = useId();
  const pos = useAnchoredMenu(open, btnRef, 240);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) setHl(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (document.getElementById(listId)?.parentElement?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, listId]);

  const pick = (idx: number) => {
    const o = options[idx];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const keyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHl((h) => Math.min(Math.max(h + (e.key === 'ArrowDown' ? 1 : -1), 0), options.length - 1));
    } else if (!open) {
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation(); pick(hl);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const menuWidth = 180;
  const left = pos ? (align === 'right' ? Math.max(8, pos.left + pos.width - menuWidth) : pos.left) : 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={clsx('t-dd', isSet && 'is-set', className)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={keyDown}
      >
        {(label ?? selected?.label ?? ariaLabel).toUpperCase()} ▾
      </button>
      {open && pos && createPortal(
        <div className="t-menu" style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left, width: menuWidth }}>
          <ul id={listId} role="listbox" aria-label={ariaLabel} style={{ maxHeight: pos.maxHeight }}>
            {options.map((o, idx) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={clsx('t-menu-item', idx === hl && 'is-hl', o.value === value && 'is-selected')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHl(idx)}
                onClick={() => pick(idx)}
              >
                {o.color !== undefined && <span className="t-dot" style={{ background: o.color ?? 'transparent' }} />}
                <span className="t-truncate">{o.label}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
}
