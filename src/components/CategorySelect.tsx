import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useCategories } from '../hooks/useCategories';
import { useAnchoredMenu } from '../hooks/useAnchoredMenu';
import { IconPlus } from './icons';

type Item = { kind: 'existing' | 'create'; text: string };

/**
 * Typeahead category picker. Only existing categories can be picked by typing;
 * a new one is created only through the explicit `+ Create "…"` row.
 */
export default function CategorySelect({
  value,
  onChange,
  placeholder = 'Category',
  className = 'input h-8 w-full',
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { categories } = useCategories();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? '');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const pos = useAnchoredMenu(open, inputRef);

  // keep internal text synced with value
  useEffect(() => setQuery(value ?? ''), [value]);

  const list = useMemo<Item[]>(() => {
    const q = (query ?? '').trim();
    const ql = q.toLowerCase();
    const base = ql ? categories.filter((c) => c.toLowerCase().includes(ql)) : categories;
    const items: Item[] = base.slice(0, 12).map((text) => ({ kind: 'existing', text }));
    if (q && !categories.some((c) => c.toLowerCase() === ql)) items.push({ kind: 'create', text: q });
    return items;
  }, [categories, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listId]);

  const choose = (item: Item) => {
    onChange(item.text);
    setQuery(item.text);
    setOpen(false);
  };

  // Does the typed query exactly match an existing category (case-insensitive)?
  const queryMatchesExisting = () => {
    const q = (query ?? '').trim().toLowerCase();
    return categories.find((c) => c.toLowerCase() === q) ?? null;
  };

  const label = ariaLabel ?? placeholder.replace(/\*$/, '');

  return (
    <>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && list[highlight] ? `${listId}-${highlight}` : undefined}
        aria-label={label}
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
        onBlur={() => {
          // If typed value isn't an existing category, revert to previous prop value
          setTimeout(() => {
            const exact = queryMatchesExisting();
            if (exact) {
              // normalize casing if needed
              setQuery(exact);
              if (exact !== value) onChange(exact);
            } else {
              setQuery(value ?? '');
            }
            setOpen(false);
          }, 120);
        }}
      />

      {open &&
        pos &&
        createPortal(
          <div
            style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
            className="menu z-[60]"
            // prevent table from capturing wheel/scroll
            onWheel={(e) => e.stopPropagation()}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label={label}
              className="overflow-auto py-1"
              style={{ maxHeight: pos.maxHeight }}
            >
              {list.map((item, idx) => {
                const active = idx === highlight;
                return (
                  <li
                    key={`${item.kind}:${item.text}`}
                    id={`${listId}-${idx}`}
                    role="option"
                    aria-selected={item.kind === 'existing' && item.text === value}
                    className={clsx(
                      'menu-item',
                      active && 'menu-item-active',
                      item.kind === 'create' && 'text-blue-600 dark:text-blue-400'
                    )}
                    // use mousedown so blur on input doesn't kill the click
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(item);
                    }}
                    onMouseEnter={() => setHighlight(idx)}
                  >
                    {item.kind === 'create' ? (
                      <>
                        <IconPlus className="h-4 w-4 shrink-0" />
                        <span className="truncate">Create “{item.text}”</span>
                      </>
                    ) : (
                      <span className="truncate">{item.text}</span>
                    )}
                  </li>
                );
              })}
              {list.length === 0 && <li className="px-3 py-2 text-sm opacity-60">No matches</li>}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
