// ⌘K: navigation, actions, and transaction shorthand ("out 21,50 lebensmittel aldi").
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import AppVersion from '../AppVersion';
import { useOverlayOpen } from '../Modal';
import { useToast } from '../Toast';
import { addTransaction } from '../../lib/api';
import { emit, type QuickEntryPrefill } from '../../lib/bus';
import { afterMutation, useData } from '../../lib/data';
import { errorMessage } from '../../lib/errors';
import { readExportConfig } from '../../lib/exportConfig';
import { formatAbs, parseDecimal } from '../../lib/number';
import { todayDE, parseDateDEToISO } from '../../lib/format';
import { useShell } from '../../lib/shell';
import { useI18n } from '../../hooks/useI18n';
import { setLang } from '../../lib/i18n';
import { setThemePreference } from '../../lib/theme';
import { formatKeys } from '../../lib/shortcuts';
import type { Account, Category } from '../../types';

type Kind = 'NEW' | 'GO' | 'RUN' | 'DOC';
type Item = {
  id: string;
  kind: Kind;
  label: string;
  hint?: string;
  keywords?: string;
  /** Tab completion text. */
  completion?: string;
  run: () => void | Promise<void>;
  /** ⇧⏎ alternative (e.g. edit the parsed transaction in quick entry instead of committing it). */
  alt?: () => void;
};

export const LAST_ACCOUNT_KEY = 'assettracker.lastAccount';

export function readLastAccount(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_ACCOUNT_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

const mod = (k: string) => formatKeys(`Mod+${k}`).join('');

export default function CommandPalette({ onLock }: { onLock: () => Promise<void> }) {
  const shell = useShell();
  const open = shell.paletteOpen;
  const nav = useNavigate();
  const toast = useToast();
  const data = useData();
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useOverlayOpen(open);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHl(0);
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  const close = shell.closePalette;
  const go = (path: string) => { nav(path); close(); };

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const q = query.trim();
    const out: Item[] = [];

    // --- transaction shorthand ---
    const parsed = parseShorthand(q, data.categories, data.accounts);
    if (parsed) {
      const acc = parsed.account ?? defaultAccount(data.accounts);
      const dirLabel = parsed.direction === 'in' ? t('type.income') : parsed.direction === 'trf' ? t('type.transfer') : t('type.expense');
      const parts = [dirLabel, `${formatAbs(parsed.amount)} €`];
      if (parsed.category) parts.push(parsed.category);
      else parts.push(t('palette.pickCategory'));
      if (parsed.direction !== 'trf') parts.push(acc ? acc.name : t('palette.pickAccount'));
      if (parsed.notes) parts.push(`“${parsed.notes}”`);
      const prefill: QuickEntryPrefill = {
        direction: parsed.direction,
        amount: parsed.amount,
        category: parsed.category ?? undefined,
        notes: parsed.notes || undefined,
        accountId: acc?.id,
        focus: !parsed.category ? 'category' : !acc ? 'account' : 'amount',
      };
      const toQuickEntry = () => { nav('/'); emit('quick-entry:prefill', prefill); close(); };
      const complete = parsed.direction !== 'trf' && parsed.category && acc;
      out.push({
        id: 'new',
        kind: 'NEW',
        label: parts.join(' · '),
        hint: complete ? '⏎' : t('palette.toQuickEntry'),
        completion: parsed.completion,
        run: async () => {
          if (!complete || !acc) { toQuickEntry(); return; }
          try {
            const sign = parsed.direction === 'in' ? 1 : -1;
            await addTransaction({
              account_id: acc.id,
              date: parseDateDEToISO(todayDE())!,
              amount: sign * parsed.amount,
              category: parsed.category,
              description: parsed.notes || null,
            });
            toast.success(t(parsed.direction === 'in' ? 'commit.income' : 'commit.expense'), { description: `${formatAbs(parsed.amount)} € · ${parsed.category} · ${acc.name}` });
            afterMutation();
            close();
          } catch (e) {
            toast.error(t('commit.failed'), { description: errorMessage(e) });
          }
        },
        alt: toQuickEntry,
      });
    }

    // --- GO: filters that match the query ---
    if (q) {
      const ql = q.toLowerCase();
      data.categories
        .filter((c) => c.name.toLowerCase().includes(ql))
        .slice(0, 4)
        .forEach((c) =>
          out.push({ id: `cat-${c.id}`, kind: 'GO', label: t('palette.filterCategory', { name: c.name }), completion: c.name,
            run: () => { nav('/'); emit('blotter:filter', { query: c.name }); close(); } })
        );
      data.accounts
        .filter((a) => a.name.toLowerCase().includes(ql))
        .slice(0, 4)
        .forEach((a) =>
          out.push({ id: `acc-${a.id}`, kind: 'GO', label: t(a.type === 'person' ? 'palette.filterPerson' : 'palette.filterAccount', { name: a.name }), completion: a.name,
            run: () => { nav('/'); emit('blotter:filter', { accountId: a.id }); close(); } })
        );
    }

    // --- static commands ---
    const cfg = readExportConfig();
    const statics: Item[] = [
      { id: 'go-terminal', kind: 'GO', label: t('palette.goTerminal'), hint: mod('1'), keywords: t('palette.goTerminal.kw'), run: () => go('/') },
      { id: 'go-stats', kind: 'GO', label: t('palette.goStats'), hint: mod('2'), keywords: t('palette.goStats.kw'), run: () => go('/stats') },
      { id: 'run-new', kind: 'RUN', label: t('palette.newTx'), hint: mod('N'), keywords: t('palette.newTx.kw'), run: () => { nav('/'); emit('focus:quick-entry'); close(); } },
      ...data.people
        .filter((p) => Math.abs(p.balance) > 0.005)
        .map<Item>((p) => ({
          id: `settle-${p.id}`, kind: 'RUN', keywords: t('palette.settleWith.kw'),
          label: t('palette.settleWith', { name: p.name, amount: formatAbs(p.balance) }), hint: mod('S'),
          run: () => { shell.openSettle(p.id); close(); },
        })),
      ...data.people.map<Item>((p) => ({
        id: `stmt-${p.id}`, kind: 'RUN', keywords: t('palette.statementFor.kw'),
        label: t('palette.statementFor', { name: p.name }),
        run: () => { shell.openSettle(p.id); close(); },
      })),
      { id: 'run-export', kind: 'RUN', label: t('palette.exportAs', { fmt: cfg.format.toUpperCase() }), hint: mod('E'), keywords: t('palette.exportAs.kw'), run: () => { nav('/'); emit('export'); close(); } },
      { id: 'go-accounts', kind: 'GO', label: t('palette.goAccounts'), hint: mod(','), keywords: t('palette.goAccounts.kw'), run: () => { nav('/'); shell.requestLedger('accounts'); close(); } },
      { id: 'go-categories', kind: 'GO', label: t('palette.goCategories'), keywords: t('palette.goCategories.kw'), run: () => { nav('/'); shell.requestLedger('categories'); close(); } },
      { id: 'go-ledger', kind: 'GO', label: t('palette.goLedger'), keywords: t('palette.goLedger.kw'), run: () => { nav('/'); shell.requestLedger('ledger'); close(); } },
      { id: 'run-clear', kind: 'RUN', label: t('palette.clearFilters'), keywords: t('palette.clearFilters.kw'), run: () => { nav('/'); emit('blotter:filter', { clear: true }); close(); } },
      { id: 'run-undo', kind: 'RUN', label: t('palette.undo'), hint: mod('Z'), keywords: t('palette.undo.kw'), run: () => { emit('undo'); close(); } },
      { id: 'run-hide', kind: 'RUN', label: shell.hidden ? t('palette.showAmounts') : t('palette.maskAmounts'), hint: 'H', keywords: t('palette.hide.kw'), run: () => { shell.toggleHidden(); close(); } },
      { id: 'theme-light', kind: 'RUN', label: t('palette.themeLight'), keywords: t('palette.theme.kw'), run: () => { setThemePreference('light'); close(); } },
      { id: 'theme-system', kind: 'RUN', label: t('palette.themeSystem'), keywords: t('palette.theme.kw'), run: () => { setThemePreference('system'); close(); } },
      { id: 'theme-dark', kind: 'RUN', label: t('palette.themeDark'), keywords: t('palette.theme.kw'), run: () => { setThemePreference('dark'); close(); } },
      { id: 'lang-en', kind: 'RUN', label: t('palette.langEn'), keywords: t('palette.lang.kw'), run: () => { setLang('en'); close(); } },
      { id: 'lang-de', kind: 'RUN', label: t('palette.langDe'), keywords: t('palette.lang.kw'), run: () => { setLang('de'); close(); } },
      { id: 'run-lock', kind: 'RUN', label: t('palette.lock'), hint: mod('⇧L'), keywords: t('palette.lock.kw'), run: async () => { close(); await onLock(); } },
      { id: 'doc-keys', kind: 'DOC', label: t('palette.shortcuts'), hint: '?', keywords: t('palette.shortcuts.kw'), run: () => { close(); shell.setHelpOpen(true); } },
    ];

    if (!q) {
      const defaults = ['run-new', ...data.people.filter((p) => Math.abs(p.balance) > 0.005).slice(0, 2).map((p) => `settle-${p.id}`), 'run-export', 'go-stats', 'go-accounts', 'doc-keys'];
      return [...out, ...statics.filter((s) => defaults.includes(s.id))];
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (i: Item) => `${i.label} ${i.keywords ?? ''} ${i.kind}`.toLowerCase();
    const matched = statics.filter((i) => words.every((w) => hay(i).includes(w)));
    return [...out, ...matched].slice(0, 12);
  }, [open, query, data, nav, close, shell, toast, onLock, t]);

  useEffect(() => setHl(0), [query]);

  if (!open) return null;

  const run = (item: Item | undefined, alt = false) => {
    if (!item) return;
    if (alt && item.alt) item.alt();
    else void item.run();
  };

  return (
    <div className="t-scrim t-scrim--top" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="t-palette" role="dialog" aria-modal="true" aria-label={t('palette.aria')}>
        <div className="t-pal-input">
          <span className="p" aria-hidden="true">›</span>
          <input
            ref={inputRef}
            value={query}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.commandAria')}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); close(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, items.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(items[hl], e.shiftKey); }
              else if (e.key === 'Tab') {
                const c = items[hl]?.completion;
                if (c) { e.preventDefault(); setQuery((q) => completeQuery(q, c)); }
              }
            }}
          />
        </div>
        <div className="t-pal-list" role="listbox" aria-label={t('palette.results')}>
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={idx === hl}
              className={clsx('t-pal-row', idx === hl && 'is-hl')}
              onMouseEnter={() => setHl(idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => run(item, e.shiftKey)}
            >
              <span className={clsx('t-badge', item.kind === 'NEW' && 'is-new')}>{item.kind}</span>
              <span className="l">{item.label}</span>
              {item.hint && <span className="k">{item.hint}</span>}
            </button>
          ))}
          {items.length === 0 && <div className="t-menu-empty" style={{ padding: '10px 13px' }}>{t('palette.noMatch')}</div>}
        </div>
        <div className="t-pal-foot">
          <span>{t('palette.footMove')}</span>
          <span>{t('palette.footComplete')}</span>
          <span>{t('palette.footEdit')}</span>
          <span>{t('palette.footClose')}</span>
          <span style={{ marginLeft: 'auto' }}><AppVersion /></span>
        </div>
      </div>
    </div>
  );
}

/* ---------- shorthand parsing ---------- */

type Parsed = {
  direction: 'in' | 'out' | 'trf';
  amount: number;
  category: string | null;
  account: Account | null;
  notes: string;
  /** Category name to complete the query with (Tab). */
  completion?: string;
};

// Both languages' keywords are always accepted, so a shorthand a user has in
// their fingers keeps working after a language switch.
const DIR: Record<string, 'in' | 'out' | 'trf'> = {
  in: 'in', income: 'in', '+': 'in', ein: 'in', einnahme: 'in',
  out: 'out', expense: 'out', '-': 'out', aus: 'out', ausgabe: 'out',
  trf: 'trf', transfer: 'trf', umb: 'trf', umbuchung: 'trf',
};

/** `[in|out|trf] <amount> [category…] [@account | account…] [notes…]` */
export function parseShorthand(q: string, categories: Category[], accounts: Account[]): Parsed | null {
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let direction: 'in' | 'out' | 'trf' = 'out';
  let i = 0;
  const d = DIR[tokens[0].toLowerCase()];
  if (d) { direction = d; i = 1; }
  const amtTok = tokens[i];
  if (!amtTok || !/^[-+]?\d{1,3}([.,]?\d{3})*([.,]\d{1,2})?$|^[-+]?\d+([.,]\d{1,2})?$/.test(amtTok)) return null;
  const amount = parseDecimal(amtTok);
  if (amount === null || Math.abs(amount) < 0.005) return null;
  if (!d && amtTok.startsWith('+')) direction = 'in';
  if (!d && amtTok.startsWith('-')) direction = 'out';
  i += 1;

  const rest = tokens.slice(i);
  let category: string | null = null;
  let completion: string | undefined;
  let consumed = 0;
  // longest phrase (up to 3 tokens) that matches a category by prefix or inclusion
  for (let k = Math.min(3, rest.length); k >= 1; k--) {
    const phrase = rest.slice(0, k).join(' ').toLowerCase();
    const exact = categories.find((c) => c.name.toLowerCase() === phrase);
    const prefix = categories.find((c) => c.name.toLowerCase().startsWith(phrase));
    const incl = categories.find((c) => c.name.toLowerCase().includes(phrase));
    const hit = exact ?? prefix ?? incl;
    if (hit) { category = hit.name; completion = hit.name; consumed = k; break; }
  }
  let after = rest.slice(consumed);

  let account: Account | null = null;
  const at = after.findIndex((t) => t.startsWith('@') && t.length > 1);
  if (at >= 0) {
    const name = after[at].slice(1).toLowerCase();
    account = accounts.find((a) => a.name.toLowerCase().startsWith(name)) ?? accounts.find((a) => a.name.toLowerCase().includes(name)) ?? null;
    after = after.filter((_, idx) => idx !== at);
  } else if (after.length > 0) {
    for (let k = Math.min(3, after.length); k >= 1; k--) {
      const phrase = after.slice(0, k).join(' ').toLowerCase();
      const hit = accounts.find((a) => a.name.toLowerCase() === phrase) ?? accounts.find((a) => a.name.toLowerCase().startsWith(phrase));
      if (hit) { account = hit; after = after.slice(k); break; }
    }
  }
  return { direction, amount: Math.abs(amount), category, account, notes: after.join(' '), completion };
}

function defaultAccount(accounts: Account[]): Account | null {
  const last = readLastAccount();
  const std = accounts.filter((a) => a.type !== 'person');
  return (last != null ? std.find((a) => a.id === last) : undefined) ?? std[0] ?? null;
}

/** Replace the category phrase in the query with the completion (best effort: after the amount token). */
function completeQuery(q: string, completion: string): string {
  const tokens = q.split(/\s+/).filter(Boolean);
  let i = 0;
  if (DIR[tokens[0]?.toLowerCase() ?? '']) i = 1;
  if (!tokens[i]) return `${q.trim()} ${completion} `;
  const head = tokens.slice(0, i + 1);
  return `${head.join(' ')} ${completion} `;
}
