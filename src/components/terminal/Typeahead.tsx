import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useAnchoredMenu } from '../../hooks/useAnchoredMenu';

export type TAItem = { id: string; label: string; color?: string | null; hint?: string };

type Props = {
  items: TAItem[];
  value: string;
  onChange: (text: string) => void;
  /** Called when an item is accepted from the list (click, Enter, Tab). */
  onPick?: (item: TAItem) => void;
  /** Strict: on blur the text must be an item label, otherwise it reverts to the last picked item ('' if none). */
  strict?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  inputRef?: RefObject<HTMLInputElement>;
  disabled?: boolean;
  invalid?: boolean;
  /** Fires for keys the typeahead did not consume (Enter commits a form, Escape cancels an edit). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  emptyText?: string;
  createHint?: boolean;
};

/**
 * Terminal-styled combobox. Typing filters; ↑↓ move; Enter or Tab accept the
 * highlighted item (when it differs from what is typed); Escape closes.
 */
export default function Typeahead({
  items,
  value,
  onChange,
  onPick,
  strict = false,
  placeholder,
  className,
  ariaLabel,
  inputRef,
  disabled,
  invalid,
  onKeyDown,
  emptyText = 'No matches',
  createHint = false,
}: Props) {
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const listId = useId();
  const pos = useAnchoredMenu(open, ref, 220);
  const lastPicked = useRef<string>('');

  const list = useMemo(() => {
    const q = value.trim().toLowerCase();
    const base = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
    // exact match first, then prefix matches, then the rest
    return [...base]
      .sort((a, b) => rank(a.label, q) - rank(b.label, q))
      .slice(0, 12);
  }, [items, value]);

  const exact = useMemo(() => {
    const q = value.trim().toLowerCase();
    return q ? items.find((i) => i.label.toLowerCase() === q) ?? null : null;
  }, [items, value]);

  useEffect(() => setHl(0), [value, open]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${hl}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, hl, listId]);

  const pick = (item: TAItem) => {
    lastPicked.current = item.label;
    onChange(item.label);
    onPick?.(item);
    setOpen(false);
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHl((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, Math.max(0, list.length - 1)) : Math.max(h - 1, 0)));
      return;
    }
    if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
      onKeyDown?.(e);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const item = open ? list[hl] : undefined;
      if (item && item.label !== value) {
        // accept the completion; Enter stays here, Tab moves on afterwards
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); }
        pick(item);
        return;
      }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (exact && exact.label !== lastPicked.current) { lastPicked.current = exact.label; onPick?.(exact); }
      setOpen(false);
      onKeyDown?.(e);
      return;
    }
    onKeyDown?.(e);
  };

  const blur = () => {
    window.setTimeout(() => {
      setOpen(false);
      if (exact) {
        if (exact.label !== value) onChange(exact.label);
        if (exact.label !== lastPicked.current) { lastPicked.current = exact.label; onPick?.(exact); }
      } else if (strict && value.trim() !== '') {
        onChange(lastPicked.current);
      }
    }, 120);
  };

  const label = ariaLabel ?? placeholder?.replace(/\*$/, '') ?? 'Value';
  const q = value.trim();

  return (
    <>
      <input
        ref={ref}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && list[hl] ? `${listId}-${hl}` : undefined}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={clsx('t-in', invalid && 'is-invalid', className)}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={keyDown}
        onBlur={blur}
      />
      {open && pos && createPortal(
        <div
          className="t-menu"
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: Math.max(pos.width, 160) }}
          onWheel={(e) => e.stopPropagation()}
        >
          <ul id={listId} role="listbox" aria-label={label} style={{ maxHeight: pos.maxHeight }}>
            {list.map((item, idx) => (
              <li
                key={item.id}
                id={`${listId}-${idx}`}
                role="option"
                aria-selected={item.label === value}
                className={clsx('t-menu-item', idx === hl && 'is-hl', item.label === value && 'is-selected')}
                onMouseDown={(e) => { e.preventDefault(); pick(item); }}
                onMouseEnter={() => setHl(idx)}
              >
                {item.color !== undefined && <span className="t-dot" style={{ background: item.color ?? 'transparent' }} />}
                <span className="t-truncate">{item.label}</span>
                {item.hint && <span className="meta" style={{ marginLeft: 'auto', fontSize: 9 }}>{item.hint}</span>}
              </li>
            ))}
            {list.length === 0 && (
              <li className="t-menu-empty">{createHint && q ? `⏎ creates “${q}”` : emptyText}</li>
            )}
            {createHint && q && !exact && list.length > 0 && (
              <li className="t-menu-empty">⏎ with the typed name creates “{q}”</li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
}

function rank(label: string, q: string): number {
  if (!q) return 0;
  const l = label.toLowerCase();
  if (l === q) return 0;
  if (l.startsWith(q)) return 1;
  return 2;
}
