import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

export type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
};

export default function BasicSelect({
  options,
  value,
  onChange,
  placeholder = 'Select',
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

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className={clsx('input h-10 w-full text-left flex items-center justify-between', className)}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={clsx(!selected && 'text-neutral-500')}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="opacity-60">▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 shadow"
        >
          {options.map((o) => (
            <button
              key={o.value}
              className={clsx(
                'w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800',
                o.value === value && 'font-medium'
              )}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
