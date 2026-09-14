// Date field in the app's dd.mm.yyyy convention with an anchored calendar
// popover, so dates are picked in the terminal skin instead of the browser's
// own <input type="date"> chrome. Value in/out is ISO 'YYYY-MM-DD' ('' = unset).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useAnchoredMenu } from '../../hooks/useAnchoredMenu';
import { useI18n } from '../../hooks/useI18n';
import { monthShort, weekdaysShort } from '../../lib/i18n';
import { formatDate } from '../../lib/format';

type Props = {
  /** ISO 'YYYY-MM-DD', or '' when unset. */
  value: string;
  onChange: (iso: string) => void;
  ariaLabel: string;
  /** Inclusive ISO bounds; days outside them cannot be picked. */
  min?: string;
  max?: string;
  className?: string;
  /** Flag the field from the host's own validation (e.g. a blank required date). */
  invalid?: boolean;
  inputRef?: MutableRefObject<HTMLInputElement | null>;
  /** Keys the field does not use itself (⏎ to commit, Esc to cancel) go to the host. */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
};

const CAL_W = 196;

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(+d) ? null : d;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
};

/** Accepts dd.mm.yyyy plus the shorthands a terminal user types: 1.1.25, 01012025, 1-1-2025. */
function parseTyped(s: string): string | null {
  const m = /^(\d{1,2})[.\-/ ]?(\d{1,2})[.\-/ ]?(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const dd = +m[1], mm = +m[2];
  const yyyy = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return isoOf(d);
}

export default function DateField({ value, onChange, ariaLabel, min, max, className, invalid, inputRef: hostRef, onKeyDown }: Props) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setInput = (el: HTMLInputElement | null) => { inputRef.current = el; if (hostRef) hostRef.current = el; };
  const popRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => (value ? formatDate(value) : ''));
  const [cursor, setCursor] = useState(() => dateOf(value) ?? new Date());
  const gridId = useId();
  const pos = useAnchoredMenu(open, wrapRef, 260);

  const todayISO = isoOf(new Date());
  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const typed = parseTyped(text);
  const badText = text.trim() !== '' && (typed == null || !inRange(typed));
  const showInvalid = badText || !!invalid;

  useEffect(() => { setText(value ? formatDate(value) : ''); }, [value]);

  // Start the calendar on the selected day (today when unset) each time it opens.
  useEffect(() => {
    if (open) setCursor(dateOf(value) ?? new Date());
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Roving focus: the cursor day is the calendar's only tab stop.
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>('[data-cursor="1"]')?.focus();
  }, [open, cursor, pos]);

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // grid starts on Monday
    return Array.from({ length: 42 }, (_, i) => addDays(first, i - lead));
  }, [cursor]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) inputRef.current?.focus();
  };

  const pick = (d: Date) => {
    const iso = isoOf(d);
    if (!inRange(iso)) return;
    onChange(iso);
    setText(formatDate(iso));
    close();
  };

  const onText = (s: string) => {
    setText(s);
    if (s.trim() === '') { onChange(''); return; }
    const iso = parseTyped(s);
    if (iso && inRange(iso)) onChange(iso);
  };

  // Leave the field showing a real date: normalise what parses, revert what does not.
  const onBlur = () => {
    if (typed && inRange(typed)) setText(formatDate(typed));
    else setText(value ? formatDate(value) : '');
  };

  const inputKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
    else onKeyDown?.(e);
  };

  const gridKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) { e.preventDefault(); setCursor((c) => addDays(c, step[e.key])); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const n = e.key === 'PageUp' ? -1 : 1;
      setCursor((c) => addMonths(c, e.shiftKey ? n * 12 : n));
    } else if (e.key === 'Home') { e.preventDefault(); setCursor((c) => new Date(c.getFullYear(), c.getMonth(), 1)); }
    else if (e.key === 'End') { e.preventDefault(); setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 0)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(cursor); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { close(false); }
  };

  const left = pos ? Math.max(8, Math.min(pos.left, window.innerWidth - 8 - CAL_W)) : 0;

  return (
    <>
      <div ref={wrapRef} className={clsx('t-datefield', showInvalid && 'is-invalid', open && 'is-open', className)}>
        <input
          ref={setInput}
          type="text"
          inputMode="numeric"
          className="t-datefield-in"
          placeholder={t('date.placeholder')}
          aria-label={ariaLabel}
          aria-invalid={showInvalid || undefined}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onBlur={onBlur}
          onKeyDown={inputKeys}
        />
        <button
          type="button"
          className="t-datefield-btn"
          aria-label={t('date.openCalendar', { label: ariaLabel })}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? gridId : undefined}
          onClick={() => (open ? close() : setOpen(true))}
        >
          ▾
        </button>
      </div>
      {open && pos && createPortal(
        <div ref={popRef} className="t-cal" style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left, width: CAL_W }}>
          <div className="t-cal-head">
            <button type="button" className="t-cal-nav" aria-label={t('date.prevMonth')} onClick={() => setCursor((c) => addMonths(c, -1))}>‹</button>
            <span className="t-cal-title" aria-live="polite">{monthShort(cursor.getMonth() + 1)} {cursor.getFullYear()}</span>
            <button type="button" className="t-cal-nav" aria-label={t('date.nextMonth')} onClick={() => setCursor((c) => addMonths(c, 1))}>›</button>
          </div>
          <div className="t-cal-wd" aria-hidden="true">
            {weekdaysShort().map((w) => <span key={w}>{w}</span>)}
          </div>
          <div id={gridId} role="grid" aria-label={ariaLabel} className="t-cal-grid" onKeyDown={gridKeys}>
            {days.map((d) => {
              const iso = isoOf(d);
              const isCursor = iso === isoOf(cursor);
              const disabled = !inRange(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  data-cursor={isCursor ? '1' : undefined}
                  tabIndex={isCursor ? 0 : -1}
                  disabled={disabled}
                  aria-selected={iso === value}
                  aria-label={formatDate(iso)}
                  className={clsx(
                    't-cal-day',
                    d.getMonth() !== cursor.getMonth() && 'is-out',
                    iso === todayISO && 'is-today',
                    iso === value && 'is-selected'
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="t-cal-foot">
            <button type="button" className="t-btn--text" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(new Date())} disabled={!inRange(todayISO)}>
              {t('date.today')}
            </button>
            <div className="t-spacer" />
            <button type="button" className="t-btn--text" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); setText(''); close(); }}>
              {t('date.clear')}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
