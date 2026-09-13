import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { IconChevronDown } from './icons';

export type Option = {
  value: string;
  label: string;
  /** When present a colour dot is rendered (null = transparent placeholder dot). */
  color?: string | null;
};

type Props = {
  options: Option[];
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

/** Button + listbox dropdown with full keyboard support. */
export default function BasicSelect({
  options,
  value,
  onChange,
  placeholder = 'Select',
  className,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : undefined;

  useEffect(() => {
    if (open) setHighlight(Math.max(0, selectedIdx));
  }, [open, selectedIdx]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keep the highlighted option visible.
  useEffect(() => {
    if (!open) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  const pick = (idx: number) => {
    const o = options[idx];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => Math.min(Math.max(h + delta, 0), options.length - 1));
      return;
    }
    if (!open) return;
    if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlight(options.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      pick(highlight);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // close the menu, not a surrounding dialog
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className={clsx('input h-10 w-full text-left flex items-center justify-between gap-2', className)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={clsx('flex min-w-0 items-center gap-2', !selected && 'text-neutral-500')}>
          {selected && selected.color !== undefined ? <Dot color={selected.color} /> : null}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <IconChevronDown
          className={clsx('h-4 w-4 shrink-0 opacity-60 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="menu absolute z-20 mt-1 max-h-64 w-full overflow-auto py-1"
        >
          {options.map((o, idx) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-idx={idx}
              className={clsx(
                'menu-item',
                idx === highlight && 'menu-item-active',
                o.value === value && 'font-medium'
              )}
              onMouseDown={(e) => e.preventDefault()} // keep focus on the button
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => pick(idx)}
            >
              {o.color !== undefined ? <Dot color={o.color} /> : null}
              <span className="truncate">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? 'transparent' }}
    />
  );
}
