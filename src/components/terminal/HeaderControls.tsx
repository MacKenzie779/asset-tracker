import clsx from 'clsx';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '../../hooks/useTheme';
import type { Lang } from '../../lib/i18n';
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

const THEMES: { value: ThemePreference; labelKey: 'theme.light' | 'theme.system' | 'theme.dark'; Icon: () => JSX.Element }[] = [
  { value: 'light', labelKey: 'theme.light', Icon: Sun },
  { value: 'system', labelKey: 'theme.system', Icon: Display },
  { value: 'dark', labelKey: 'theme.dark', Icon: Moon },
];

const LANGS: { value: Lang; short: string; labelKey: 'lang.en' | 'lang.de' }[] = [
  { value: 'en', short: 'EN', labelKey: 'lang.en' },
  { value: 'de', short: 'DE', labelKey: 'lang.de' },
];

export function LanguageControl() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="t-seg-group" role="radiogroup" aria-label={t('lang.aria')}>
      {LANGS.map(({ value, short, labelKey }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={lang === value}
          title={t(labelKey)}
          className={clsx('t-seg t-seg--text', lang === value && 'is-active')}
          onClick={() => setLang(value)}
        >
          <span aria-hidden="true">{short}</span>
          <span className="t-sr">{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

export function ThemeControl() {
  const { preference, setPreference } = useTheme();
  const { t } = useI18n();
  return (
    <div className="t-seg-group" role="radiogroup" aria-label={t('theme.aria')}>
      {THEMES.map(({ value, labelKey, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          title={t(labelKey)}
          className={clsx('t-seg', preference === value && 'is-active')}
          onClick={() => setPreference(value)}
        >
          <Icon />
          <span className="t-sr">{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

export function PrivacyControl({ hidden, onChange }: { hidden: boolean; onChange: (hidden: boolean) => void }) {
  const { t } = useI18n();
  return (
    <div className="t-seg-group" role="radiogroup" aria-label={t('privacy.aria')}>
      <button type="button" role="radio" aria-checked={!hidden} title={t('privacy.show')} className={clsx('t-seg', !hidden && 'is-active')} onClick={() => onChange(false)}>
        <Eye />
        <span className="t-sr">{t('privacy.visible')}</span>
      </button>
      <button type="button" role="radio" aria-checked={hidden} title={t('privacy.mask')} className={clsx('t-seg', hidden && 'is-active')} onClick={() => onChange(true)}>
        <EyeOff />
        <span className="t-sr">{t('privacy.masked')}</span>
      </button>
    </div>
  );
}
