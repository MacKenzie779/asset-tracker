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
  const [query, setQuery] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useOverlayOpen(open);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHl(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
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
      const dirLabel = parsed.direction === 'in' ? 'Income' : parsed.direction === 'trf' ? 'Transfer' : 'Expense';
      const parts = [dirLabel, `${formatAbs(parsed.amount)} €`];
      if (parsed.category) parts.push(parsed.category);
      else parts.push('pick a category…');
      if (parsed.direction !== 'trf') parts.push(acc ? acc.name : 'pick an account…');
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
        hint: complete ? '⏎' : '⏎ → quick entry',
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
            toast.success(`${dirLabel} committed`, { description: `${formatAbs(parsed.amount)} € · ${parsed.category} · ${acc.name}` });
            afterMutation();
            close();
          } catch (e) {
            toast.error('Could not commit', { description: errorMessage(e) });
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
          out.push({ id: `cat-${c.id}`, kind: 'GO', label: `Filter blotter → category ${c.name}`, completion: c.name,
            run: () => { nav('/'); emit('blotter:filter', { query: c.name }); close(); } })
        );
      data.accounts
        .filter((a) => a.name.toLowerCase().includes(ql))
        .slice(0, 4)
        .forEach((a) =>
          out.push({ id: `acc-${a.id}`, kind: 'GO', label: `Filter blotter → ${a.type === 'person' ? 'person' : 'account'} ${a.name}`, completion: a.name,
            run: () => { nav('/'); emit('blotter:filter', { accountId: a.id }); close(); } })
        );
    }

    // --- static commands ---
    const cfg = readExportConfig();
    const statics: Item[] = [
      { id: 'go-terminal', kind: 'GO', label: 'Terminal', hint: mod('1'), keywords: 'blotter ledger home transactions', run: () => go('/') },
      { id: 'go-stats', kind: 'GO', label: 'Stats', hint: mod('2'), keywords: 'charts statistics analytics', run: () => go('/stats') },
      { id: 'run-new', kind: 'RUN', label: 'New transaction', hint: mod('N'), keywords: 'add quick entry commit', run: () => { nav('/'); emit('focus:quick-entry'); close(); } },
      ...data.people
        .filter((p) => Math.abs(p.balance) > 0.005)
        .map<Item>((p) => ({
          id: `settle-${p.id}`, kind: 'RUN', keywords: 'settle up pay balance person',
          label: `Settle up with ${p.name} — ${formatAbs(p.balance)} €`, hint: mod('S'),
          run: () => { shell.openSettle(p.id); close(); },
        })),
      ...data.people.map<Item>((p) => ({
        id: `stmt-${p.id}`, kind: 'RUN', keywords: 'statement settlement export pdf xlsx person',
        label: `Settlement statement for ${p.name}…`,
        run: () => { shell.openSettle(p.id); close(); },
      })),
      { id: 'run-export', kind: 'RUN', label: `Export filtered result as ${cfg.format.toUpperCase()}`, hint: mod('E'), keywords: 'export xlsx pdf download', run: () => { nav('/'); emit('export'); close(); } },
      { id: 'go-accounts', kind: 'GO', label: 'Ledger column → ACCOUNTS', hint: mod(','), keywords: 'manage accounts people add rename delete', run: () => { nav('/'); shell.requestLedger('accounts'); close(); } },
      { id: 'go-categories', kind: 'GO', label: 'Ledger column → CATEGORIES', keywords: 'manage categories add rename delete', run: () => { nav('/'); shell.requestLedger('categories'); close(); } },
      { id: 'go-ledger', kind: 'GO', label: 'Ledger column → LEDGER', keywords: 'position accounts people export', run: () => { nav('/'); shell.requestLedger('ledger'); close(); } },
      { id: 'run-clear', kind: 'RUN', label: 'Clear blotter filters', keywords: 'reset filter search all', run: () => { nav('/'); emit('blotter:filter', { clear: true }); close(); } },
      { id: 'run-undo', kind: 'RUN', label: 'Undo last commit or delete', hint: mod('Z'), keywords: 'undo revert', run: () => { emit('undo'); close(); } },
      { id: 'run-hide', kind: 'RUN', label: shell.hidden ? 'Show amounts' : 'Mask amounts', hint: 'H', keywords: 'privacy hide values eye', run: () => { shell.toggleHidden(); close(); } },
      { id: 'theme-light', kind: 'RUN', label: 'Theme: light', keywords: 'theme appearance', run: () => { setThemePreference('light'); close(); } },
      { id: 'theme-system', kind: 'RUN', label: 'Theme: system', keywords: 'theme appearance', run: () => { setThemePreference('system'); close(); } },
      { id: 'theme-dark', kind: 'RUN', label: 'Theme: dark', keywords: 'theme appearance', run: () => { setThemePreference('dark'); close(); } },
      { id: 'run-lock', kind: 'RUN', label: 'Lock database', hint: mod('⇧L'), keywords: 'lock logout close', run: async () => { close(); await onLock(); } },
      { id: 'doc-keys', kind: 'DOC', label: 'Keyboard shortcuts', hint: '?', keywords: 'help keys', run: () => { close(); shell.setHelpOpen(true); } },
    ];

    if (!q) {
      const defaults = ['run-new', ...data.people.filter((p) => Math.abs(p.balance) > 0.005).slice(0, 2).map((p) => `settle-${p.id}`), 'run-export', 'go-stats', 'go-accounts', 'doc-keys'];
      return [...out, ...statics.filter((s) => defaults.includes(s.id))];
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (i: Item) => `${i.label} ${i.keywords ?? ''} ${i.kind}`.toLowerCase();
    const matched = statics.filter((i) => words.every((w) => hay(i).includes(w)));
    return [...out, ...matched].slice(0, 12);
  }, [open, query, data, nav, close, shell, toast, onLock]);

  useEffect(() => setHl(0), [query]);

  if (!open) return null;

  const run = (item: Item | undefined, alt = false) => {
    if (!item) return;
    if (alt && item.alt) item.alt();
    else void item.run();
  };

  return (
    <div className="t-scrim t-scrim--top" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="t-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="t-pal-input">
          <span className="p" aria-hidden="true">›</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="type a command, or: out 21,50 lebensmittel aldi"
            aria-label="Command"
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
        <div className="t-pal-list" role="listbox" aria-label="Results">
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
          {items.length === 0 && <div className="t-menu-empty" style={{ padding: '10px 13px' }}>No command matches. Try “out 12,50 lebensmittel”.</div>}
        </div>
        <div className="t-pal-foot">
          <span>↑↓ MOVE</span>
          <span>⇥ COMPLETE</span>
          <span>⇧⏎ EDIT IN QUICK ENTRY</span>
          <span>ESC CLOSE</span>
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

const DIR: Record<string, 'in' | 'out' | 'trf'> = {
  in: 'in', income: 'in', '+': 'in', out: 'out', expense: 'out', '-': 'out', trf: 'trf', transfer: 'trf',
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
