import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Account } from '../../types';

type Props = {
  options: Account[];
  value?: number | null;          // null = All accounts
  onChange: (v: number | null) => void;
  className?: string;
};

export default function AccountSelectTx({
  options,
  value = null,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!menuRef.current || !btnRef.current) return;
      if (menuRef.current.contains(e.target as Node) || btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const opts = useMemo(
    () => [{ id: -1, name: 'All accounts', type: 'standard' } as Account, ...options],
    [options]
  );

  const label = useMemo(() => {
    if (value === null) return 'All accounts';
    const found = options.find((a) => a.id === value);
    return found?.name ?? 'Account';
  }, [options, value]);

  const handlePick = (id: number) => {
    onChange(id === -1 ? null : id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className={clsx('input h-10 w-full text-left flex items-center justify-between', className)}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={clsx(!label && 'text-neutral-500')}>{label}</span>
        <span className="opacity-60">▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 shadow"
        >
          {opts.map((a) => (
            <button
              key={a.id}
              className={clsx(
                'w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2',
                (value === a.id) || (a.id === -1 && value === null) ? 'font-medium' : ''
              )}
              onClick={() => handlePick(a.id)}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: a.id === -1 ? 'transparent' : (a.color || '#6b7280') }}
              />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
