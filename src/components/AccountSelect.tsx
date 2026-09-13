import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { Account } from '../types';
import { useAnchoredMenu } from '../hooks/useAnchoredMenu';

/** Typeahead account picker (used in the add row and inline edit rows). */
export default function AccountSelect({
  options,
  value, // number id or '' for placeholder
  onChange,
  placeholder = 'Account*',
  className = 'input h-9 w-full',
  ariaLabel,
}: {
  options: Pick<Account, 'id' | 'name'>[];
  value: number | '';
  onChange: (v: number | '') => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const pos = useAnchoredMenu(open, inputRef);

  // Sync input text with selected value
  useEffect(() => {
    if (value === '') {
      setQuery('');
    } else {
      const name = options.find((o) => o.id === value)?.name ?? '';
      setQuery(name);
    }
  }, [value, options]);

  const list = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const base = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    return base.slice(0, 20);
  }, [options, query]);

  useEffect(() => setHighlight(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listId]);

  const choose = (item: { id: number; name: string }) => {
    onChange(item.id);
    setQuery(item.name);
    setOpen(false);
  };

  return (
    <>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && list[highlight] ? `${listId}-${highlight}` : undefined}
        aria-label={ariaLabel ?? placeholder.replace(/\*$/, '')}
        className={className}
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
            }
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(0, list.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (list[highlight]) {
              e.preventDefault();
              e.stopPropagation(); // don't submit the form / save the row
              choose(list[highlight]);
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation(); // close the menu, not a surrounding dialog
            setOpen(false);
          } else if (e.key === 'Tab') {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />

      {open &&
        pos &&
        createPortal(
          <div
            style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
            className="menu z-[60]"
            onWheel={(e) => e.stopPropagation()}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label={ariaLabel ?? placeholder.replace(/\*$/, '')}
              className="overflow-auto py-1"
              style={{ maxHeight: pos.maxHeight }}
            >
              {list.length === 0 && <li className="px-3 py-2 text-sm opacity-60">No accounts</li>}
              {list.map((item, idx) => (
                <li
                  key={item.id}
                  id={`${listId}-${idx}`}
                  role="option"
                  aria-selected={item.id === value}
                  className={clsx('menu-item', idx === highlight && 'menu-item-active')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(item);
                  }}
                  onMouseEnter={() => setHighlight(idx)}
                >
                  <span className="truncate">{item.name}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
