import clsx from 'clsx';
import { useTheme } from '../hooks/useTheme';
import type { ThemePreference } from '../lib/theme';
import { IconMonitor, IconMoon, IconSun } from './icons';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'system', label: 'System', icon: IconMonitor },
  { value: 'dark', label: 'Dark', icon: IconMoon },
];

/** Segmented Light / System / Dark control. */
export default function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  const move = (delta: number) => {
    const idx = OPTIONS.findIndex((o) => o.value === preference);
    const next = OPTIONS[(idx + delta + OPTIONS.length) % OPTIONS.length];
    setPreference(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-xl border border-neutral-300/50 dark:border-neutral-700/50 p-0.5',
        className
      )}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const checked = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={`${label} theme`}
            onClick={() => setPreference(value)}
            className={clsx(
              'inline-flex h-8 w-8 items-center justify-center rounded-lg transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              checked
                ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white'
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
