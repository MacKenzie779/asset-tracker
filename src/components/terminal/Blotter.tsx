// Blotter column: header (search, dropdowns), quick entry,
// column header, the scrolling rows, the summary line, and the pagination bar.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import BlotterRow from './BlotterRow';
import DateField from './DateField';
import Dropdown from './Dropdown';
import Money from './Money';
import QuickEntry from './QuickEntry';
import { useData } from '../../lib/data';
import { useBus } from '../../hooks/useBus';
import { useI18n } from '../../hooks/useI18n';
import type { TKey } from '../../lib/i18n';
import type { CommitPlan } from '../../pages/Terminal';
import type { Transaction, TransactionSearchResult, TxSortBy, TxTypeFilter, UpdateTransaction } from '../../types';

export type TimeSpan = 'all' | 'this_month' | 'last_month' | 'this_year' | 'custom';
export type BlotterFilters = {
  rawQuery: string;
  timeSpan: TimeSpan;
  customFrom: string;
  customTo: string;
  accountId: number | null;
  type: TxTypeFilter;
  sortBy: TxSortBy;
  sortDir: 'asc' | 'desc';
};

type Props = {
  filters: BlotterFilters;
  onFilters: (patch: Partial<BlotterFilters>) => void;
  onClear: () => void;
  result: TransactionSearchResult;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  limit: number;
  onLimitChange: (n: number) => void;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  editingId: number | null;
  onEdit: (id: number | null) => void;
  newId: number | null;
  onUpdate: (patch: UpdateTransaction) => Promise<void>;
  onDelete: (id: number) => void;
  onDuplicate: (row: Transaction) => void;
  onCommit: (plan: CommitPlan) => Promise<void>;
  hidden: boolean;
};

const TYPES: TxTypeFilter[] = ['all', 'income', 'expense', 'transfer'];
const SPANS: TimeSpan[] = ['all', 'this_month', 'last_month', 'this_year', 'custom'];
const COLS: { key: TxSortBy; cls: string }[] = [
  { key: 'date', cls: 'c-date' }, { key: 'category', cls: 'c-cat' }, { key: 'description', cls: 'c-notes' },
  { key: 'amount', cls: 'c-val' }, { key: 'account', cls: 'c-acc' },
];
const ROW_H = 27;

export default function Blotter(p: Props) {
  const { filters, onFilters, result, hidden } = p;
  const data = useData();
  const { t, tn } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  useBus('focus:search', () => { searchRef.current?.focus(); searchRef.current?.select(); });

  // Page size follows the height of the rows region so the table always fills it.
  const onLimitRef = useRef(p.onLimitChange);
  onLimitRef.current = p.onLimitChange;
  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    let timer: number | null = null;
    const measure = () => {
      const n = Math.max(5, Math.min(80, Math.floor(el.clientHeight / ROW_H)));
      onLimitRef.current(n);
    };
    const ro = new ResizeObserver(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(measure, 150);
    });
    ro.observe(el);
    measure();
    return () => { ro.disconnect(); if (timer != null) window.clearTimeout(timer); };
  }, []);

  // Keep the selected row in view when moving with the keyboard.
  useEffect(() => {
    if (p.selectedId == null) return;
    rowsRef.current?.querySelector<HTMLElement>(`[data-id="${p.selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [p.selectedId]);

  const [pendingCustom, setPendingCustom] = useState({ from: filters.customFrom, to: filters.customTo });
  useEffect(() => setPendingCustom({ from: filters.customFrom, to: filters.customTo }), [filters.customFrom, filters.customTo]);

  const accountOptions = useMemo(
    () => [{ value: 'all', label: t('blotter.allAccounts'), color: null }, ...data.accounts.map((a) => ({ value: String(a.id), label: a.name, color: a.color ?? '#6b7280' }))],
    [data.accounts, t]
  );

  const isAllAccounts = filters.accountId == null;
  const income = result.sum_income ?? 0;
  const expense = result.sum_expense ?? 0;
  const transfer = isAllAccounts ? 0 : result.sum_transfer ?? 0;
  const saldo = income + expense + (result.sum_init ?? 0) + transfer;
  const hasFilters = filters.rawQuery.trim() !== '' || filters.timeSpan !== 'all' || filters.accountId != null || filters.type !== 'all';
  const showSkeleton = p.loading && result.items.length === 0;
  const showEmpty = !p.loading && !p.error && result.items.length === 0;

  const pageItems = useMemo<(number | '…')[]>(() => {
    const total = p.totalPages, cur = p.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const items: (number | '…')[] = [1];
    const left = Math.max(2, cur - 1), right = Math.min(total - 1, cur + 1);
    if (left > 2) items.push('…');
    for (let i = left; i <= right; i++) items.push(i);
    if (right < total - 1) items.push('…');
    items.push(total);
    return items;
  }, [p.page, p.totalPages]);

  const sort = (by: TxSortBy) =>
    onFilters({ sortBy: by, sortDir: filters.sortBy === by ? (filters.sortDir === 'asc' ? 'desc' : 'asc') : 'asc' });

  return (
    <section className="t-blotter" aria-label={t('blotter.aria')}>
      <div className="t-bhead">
        <span className="t-title">{t('blotter.title')}</span>
        <input
          ref={searchRef}
          type="text"
          role="searchbox"
          className="t-search"
          placeholder={t('blotter.searchPlaceholder')}
          aria-label={t('blotter.searchAria')}
          value={filters.rawQuery}
          onChange={(e) => onFilters({ rawQuery: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); if (filters.rawQuery) onFilters({ rawQuery: '' }); else searchRef.current?.blur(); } }}
        />
        {filters.timeSpan === 'custom' && (
          <>
            <DateField className="t-datefield--mini" ariaLabel={t('blotter.fromDate')} value={pendingCustom.from} max={pendingCustom.to || undefined} onChange={(v) => setPendingCustom((c) => ({ ...c, from: v }))} />
            <DateField className="t-datefield--mini" ariaLabel={t('blotter.toDate')} value={pendingCustom.to} min={pendingCustom.from || undefined} onChange={(v) => setPendingCustom((c) => ({ ...c, to: v }))} />
            <button type="button" className="t-btn t-btn--primary t-btn--sm" style={{ padding: '3px 7px' }} onClick={() => onFilters({ customFrom: pendingCustom.from, customTo: pendingCustom.to })}>
              {t('blotter.apply')}
            </button>
          </>
        )}
        <Dropdown
          options={SPANS.map((v) => ({ value: v, label: t(`span.${v}` as TKey) }))}
          value={filters.timeSpan}
          onChange={(v) => onFilters({ timeSpan: v as TimeSpan, ...(v !== 'custom' ? { customFrom: '', customTo: '' } : {}) })}
          ariaLabel={t('blotter.timeSpan')}
          isSet={filters.timeSpan !== 'all'}
        />
        <Dropdown
          options={accountOptions}
          value={filters.accountId == null ? 'all' : String(filters.accountId)}
          onChange={(v) => onFilters({ accountId: v === 'all' ? null : Number(v) })}
          ariaLabel={t('blotter.account')}
          isSet={filters.accountId != null}
        />
        <Dropdown
          options={TYPES.map((v) => ({ value: v, label: t(`type.${v}` as TKey) }))}
          value={filters.type}
          onChange={(v) => onFilters({ type: v as TxTypeFilter })}
          ariaLabel={t('blotter.type')}
          isSet={filters.type !== 'all'}
        />
      </div>

      {p.error && (
        <div className="t-errbar" role="alert">
          <span className="t-truncate">{t('blotter.loadError', { msg: p.error })}</span>
          <button type="button" onClick={p.onRetry}>{t('action.retry')}</button>
        </div>
      )}

      <QuickEntry onCommit={p.onCommit} />

      <div className="t-grid t-colhead" role="row">
        {COLS.map((c) => {
          const active = filters.sortBy === c.key;
          const label = t(`col.${c.key}` as TKey);
          return (
            <span key={c.key} className={c.cls} role="columnheader" aria-sort={active ? (filters.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" className={clsx(active && 'is-active')} onClick={() => sort(c.key)} title={t('blotter.sortBy', { col: label.toLowerCase() })}>
                {label}{active ? (filters.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </span>
          );
        })}
        <span className="c-act" />
      </div>

      <div ref={rowsRef} className="t-rows" role="grid" aria-busy={p.loading || undefined} aria-label={t('blotter.rowsAria')}>
        {result.items.map((row) => (
          <BlotterRow
            key={row.id}
            row={row}
            hidden={hidden}
            selected={p.selectedId === row.id}
            editing={p.editingId === row.id}
            isNew={p.newId === row.id}
            onSelect={() => p.onSelect(row.id)}
            onStartEdit={() => { p.onSelect(row.id); p.onEdit(row.id); }}
            onCancelEdit={() => p.onEdit(null)}
            onSave={async (patch) => { await p.onUpdate(patch); p.onEdit(null); }}
            onDelete={() => p.onDelete(row.id)}
            onDuplicate={() => p.onDuplicate(row)}
          />
        ))}
        {showSkeleton && Array.from({ length: Math.min(p.limit, 12) }, (_, i) => (
          <div key={`sk-${i}`} className="t-grid t-skel" aria-hidden="true">
            <span /><span /><span style={{ width: '60%' }} /><span /><span /><span />
          </div>
        ))}
        {showEmpty && (
          <div className="t-empty">
            <span>{hasFilters ? t('blotter.emptyFiltered') : t('blotter.empty')}</span>
            {hasFilters && <button type="button" onClick={p.onClear}>{t('blotter.clearFilters')}</button>}
          </div>
        )}
      </div>

      <div className="t-grid t-summary" aria-label={t('blotter.summaryAria')}>
        <span className="c-date">{t('blotter.summary')}</span>
        <span className="c-cat">{tn('blotter.rowCount', result.total)}</span>
        <span className="c-notes">
          <span>{t('blotter.in')} <Money value={income} hidden={hidden} sign="none" tone="pos" /></span>
          <span>{t('blotter.out')} <Money value={expense} hidden={hidden} sign="neg" tone="neg" /></span>
          {!isAllAccounts && Math.abs(transfer) > 0.005 && <span>{t('blotter.trf')} <Money value={transfer} hidden={hidden} sign="always" tone="sign" /></span>}
        </span>
        <span className="c-val"><Money value={saldo} hidden={hidden} sign="neg" tone="none" /></span>
        <span className="c-acc">{isAllAccounts ? t('blotter.saldoOfFilter') : t('blotter.balanceChange')}</span>
        <span className="c-act" />
      </div>

      <nav className="t-pager" aria-label={t('pager.aria')}>
        <span aria-live="polite">{t('pager.page', { page: p.page, total: p.totalPages })}{p.loading && result.items.length > 0 ? ` · ${t('pager.loading')}` : ''}</span>
        <div className="t-spacer" />
        <button type="button" disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}>{t('pager.prev')}</button>
        {pageItems.map((it, idx) =>
          it === '…' ? (
            <span key={`d-${idx}`}>…</span>
          ) : (
            <button key={it} type="button" className={clsx(it === p.page && 'is-current')} aria-current={it === p.page ? 'page' : undefined} disabled={it === p.page} onClick={() => p.onPage(it)}>
              {it}
            </button>
          )
        )}
        <button type="button" disabled={p.page >= p.totalPages} onClick={() => p.onPage(p.page + 1)}>{t('pager.next')}</button>
      </nav>
    </section>
  );
}
