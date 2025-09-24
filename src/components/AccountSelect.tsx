import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Account } from '../types';

type Coords = { top: number; left: number; width: number };

export default function AccountSelect({
  options,
  value,                      // number id or '' for placeholder
  onChange,
  placeholder = 'Account*',
  className = 'input h-9 w-full',
}: {
  options: Pick<Account, 'id' | 'name'>[];
  value: number | '';
  onChange: (v: number | '') => void;
  placeholder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [query, setQuery] = useState('');

  // Sync input text with selected value
  useEffect(() => {
    if (value === '') {
      setQuery('');
    } else {
      const name = options.find(o => o.id === value)?.name ?? '';
      setQuery(name);
    }
  }, [value, options]);

  const measure = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
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

  const list = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const base = q ? options.filter(o => o.name.toLowerCase().includes(q)) : options;
    return base.slice(0, 20);
  }, [options, query]);

  const [highlight, setHighlight] = useState(0);
  useEffect(() => setHighlight(0), [query, open]);

  const choose = (item: { id: number; name: string }) => {
    onChange(item.id);
    setQuery(item.name);
    setOpen(false);
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
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />

      {open && coords && createPortal(
        <div
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
          className="z-50 rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden"
          onWheel={(e) => e.stopPropagation()}
        >
          <ul className="max-h-64 overflow-auto py-1">
            {list.length === 0 && (
              <li className="px-3 py-2 text-sm opacity-60">No accounts</li>
            )}
            {list.map((item, idx) => {
              const active = idx === highlight;
              return (
                <li
                  key={item.id}
                  className={[
                    'px-3 py-2 cursor-pointer text-sm',
                    active ? 'bg-neutral-100 dark:bg-neutral-800' : '',
                  ].join(' ')}
                  onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                  onMouseEnter={() => setHighlight(idx)}
                >
                  {item.name}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body
      )}
    </>
  );
}
