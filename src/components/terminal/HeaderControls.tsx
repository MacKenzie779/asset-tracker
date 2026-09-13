import clsx from 'clsx';
import { useTheme } from '../../hooks/useTheme';
import type { ThemePreference } from '../../lib/theme';

const ICON = { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function Sun() {
  return (
    <svg {...ICON}>
      <circle cx="8" cy="8" r="2.9" />
      <path d="M8 1.2v1.5M8 13.3v1.5M1.2 8h1.5M13.3 8h1.5M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
    </svg>
  );
}
function Display() {
  return (
    <svg {...ICON}>
      <rect x="1.6" y="2.6" width="12.8" height="8.8" rx="1.2" />
      <path d="M6.2 13.6h3.6" />
    </svg>
  );
}
function Moon() {
  return (
    <svg {...ICON}>
      <path d="M12.9 9.9A5.7 5.7 0 0 1 6.1 3.1a5.85 5.85 0 1 0 6.8 6.8z" />
    </svg>
  );
}
function Eye() {
  return (
    <svg {...ICON}>
      <path d="M1.5 8S4.2 3.9 8 3.9 14.5 8 14.5 8s-2.7 4.1-6.5 4.1S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.85" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg {...ICON}>
      <path d="M6.3 4.2A6.6 6.6 0 0 1 8 4c3.8 0 6.5 4 6.5 4a12 12 0 0 1-1.9 2.3M4 5.1A12.4 12.4 0 0 0 1.5 8S4.2 12 8 12a6.7 6.7 0 0 0 2-.3" />
      <path d="M6.7 6.7a1.85 1.85 0 0 0 2.6 2.6" />
      <path d="M2.9 13.1 13.1 2.9" />
    </svg>
  );
}

const THEMES: { value: ThemePreference; label: string; Icon: () => JSX.Element }[] = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'System theme', Icon: Display },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

export function ThemeControl() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="t-seg-group" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          title={label}
          className={clsx('t-seg', preference === value && 'is-active')}
          onClick={() => setPreference(value)}
        >
          <Icon />
          <span className="t-sr">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function PrivacyControl({ hidden, onChange }: { hidden: boolean; onChange: (hidden: boolean) => void }) {
  return (
    <div className="t-seg-group" role="radiogroup" aria-label="Amount visibility">
      <button type="button" role="radio" aria-checked={!hidden} title="Show amounts (H)" className={clsx('t-seg', !hidden && 'is-active')} onClick={() => onChange(false)}>
        <Eye />
        <span className="t-sr">Values visible</span>
      </button>
      <button type="button" role="radio" aria-checked={hidden} title="Mask amounts (H)" className={clsx('t-seg', hidden && 'is-active')} onClick={() => onChange(true)}>
        <EyeOff />
        <span className="t-sr">Values masked</span>
      </button>
    </div>
  );
}
