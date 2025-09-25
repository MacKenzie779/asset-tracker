import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCategories } from '../hooks/useCategories';

type Coords = { top: number; left: number; width: number; height: number };

export default function CategorySelect({
  value,
  onChange,
  placeholder = 'Category',
  className = 'input h-8 w-full',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { categories } = useCategories();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? '');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  // keep internal text synced with value
  useEffect(() => setQuery(value ?? ''), [value]);

  // compute and update dropdown coordinates (fixed to viewport)
  const measure = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left, width: r.width, height: r.height });
  };

  useEffect(() => {
    if (!open) return;
    measure();
    const onScroll = () => measure();
    const onResize = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Filtered list (existing categories only)
  const list = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const base = q ? categories.filter(c => c.toLowerCase().includes(q)) : categories;
    return base.slice(0, 12);
  }, [categories, query]);

  useEffect(() => { setHighlight(0); }, [query, open]);

  const choose = (text: string) => {
    // Only accept selections from existing list items
    onChange(text);
    setQuery(text);
    setOpen(false);
  };

  // Does the typed query exactly match an existing category (case-insensitive)?
  const queryMatchesExisting = () => {
    const q = (query ?? '').trim().toLowerCase();
    return categories.find(c => c.toLowerCase() === q) ?? null;
  };

  return (
    <>
      <input
        ref={inputRef}
        className={className}
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(0, list.length - 1))); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
          if (e.key === 'Enter')     { e.preventDefault(); if (list[highlight]) choose(list[highlight]); }
          if (e.key === 'Escape')    { setOpen(false); }
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

      {open && coords && createPortal(
        <div
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: coords.width,
          }}
          className="z-50 rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden"
          // prevent table from capturing wheel/scroll
          onWheel={(e) => e.stopPropagation()}
        >
          <ul className="max-h-64 overflow-auto py-1">
            {list.map((item, idx) => {
              const active = idx === highlight;
              return (
                <li
                  key={item + idx}
                  className={[
                    'px-3 py-2 cursor-pointer text-sm',
                    'flex items-center justify-between',
                    active ? 'bg-neutral-100 dark:bg-neutral-800' : '',
                  ].join(' ')}
                  // use mousedown so blur on input doesn't kill the click
                  onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                  onMouseEnter={() => setHighlight(idx)}
                >
                  <span>{item}</span>
                </li>
              );
            })}
            {list.length === 0 && (
              <li className="px-3 py-2 text-sm opacity-60">No matches</li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
}
