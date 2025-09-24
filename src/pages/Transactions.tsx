// src/pages/Transactions.tsx
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import {
  listAccounts,
  searchTransactions,
  deleteTransaction,
  updateTransaction,
  exportTransactionsXlsx,
} from '../lib/api';

import type {
  Account,
  Transaction,
  UpdateTransaction,
  TransactionSearch,
  TransactionSearchResult,
  TxTypeFilter,
} from '../types';

import TransactionsTable from '../components/TransactionsTable';
import Amount from '../components/Amount';
import ConfirmDialog from '../components/ConfirmDialog';

type OutletCtx = { hidden: boolean };

const PAGE_SIZE = 15;

/* ---- date helpers ---- */
function ymd(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function firstDayOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function firstDayOfYear(d = new Date()) { return new Date(d.getFullYear(), 0, 1); }

/* ---- hooks ---- */
function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { listAccounts().then(setAccounts).catch(console.error); }, []);
  return accounts;
}

function useSearch() {
  const [filters, setFilters] = useState<TransactionSearch>({
    limit: PAGE_SIZE,
    offset: 0,
    tx_type: 'all',
    account_id: null, // default "All accounts"
  });
  const update = (patch: Partial<TransactionSearch>) =>
    setFilters(prev => ({ ...prev, ...patch, offset: 0 }));
  return [filters, update, setFilters] as const;
}

/* ---- page ---- */
export default function Transactions() {
  const { hidden } = useOutletContext<OutletCtx>();
  const accounts = useAccounts();

  const [filters, updateFilters, setFilters] = useSearch();

  const [query, setQuery] = useState('');
  const [type, setType] = useState<TxTypeFilter>('all');

  const [timeSpan, setTimeSpan] = useState<'all' | 'this_month' | 'last_month' | 'this_year' | 'custom'>('all');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TransactionSearchResult>({
    items: [],
    total: 0,
    sum_income: 0,
    sum_expense: 0,
  });

  const [confirmTxId, setConfirmTxId] = useState<number | null>(null);

  const page = useMemo(
    () => Math.floor((filters.offset ?? 0) / (filters.limit ?? PAGE_SIZE)) + 1,
    [filters.offset, filters.limit]
  );
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data.total ?? 0) / (filters.limit ?? PAGE_SIZE))),
    [data.total, filters.limit]
  );

  // react to timeSpan preset
  useEffect(() => {
    const now = new Date();
    if (timeSpan === 'all') {
      updateFilters({ date_from: null, date_to: null });
    } else if (timeSpan === 'this_month') {
      updateFilters({ date_from: ymd(firstDayOfMonth(now)), date_to: ymd(now) });
    } else if (timeSpan === 'last_month') {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      updateFilters({ date_from: ymd(firstDayOfMonth(prev)), date_to: ymd(lastDayOfMonth(prev)) });
    } else if (timeSpan === 'this_year') {
      updateFilters({ date_from: ymd(firstDayOfYear(now)), date_to: ymd(now) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSpan]);

  // custom range → filters
  useEffect(() => {
    if (timeSpan === 'custom') {
      updateFilters({ date_from: customFrom || null, date_to: customTo || null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFrom, customTo]);

  useEffect(() => {
    setLoading(true);
    const f: TransactionSearch = {
      ...filters,
      query: query.trim() || undefined,
      tx_type: type,
    };
    searchTransactions(f)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters, type, query]);

  const refresh = async () => {
    const fresh = await searchTransactions({
      ...filters,
      query: query.trim() || undefined,
      tx_type: type,
    });
    setData(fresh);
  };

  const handleUpdateTx = async (patch: UpdateTransaction) => {
    await updateTransaction(patch);
    await refresh();
  };

  const requestDeleteTx = (id: number) => setConfirmTxId(id);
  const confirmDeleteTx = async () => {
    const id = confirmTxId!;
    setConfirmTxId(null);
    await deleteTransaction(id);
    await refresh();
  };

  const sumSaldo = (data.sum_income ?? 0) + (data.sum_expense ?? 0);

  const handleExport = async () => {
    const path = await exportTransactionsXlsx(
      { ...filters, query: query.trim() || undefined, tx_type: type },
      ['date', 'account', 'category', 'description', 'amount']
    );
    alert(`Exported to: ${path}`);
  };

  /* ---- UI ---- */
  return (
    <div className="px-3 sm:px-4 md:px-6 pt-4 grid gap-6 2xl:grid-cols-[minmax(1280px,1fr)_minmax(60px,480px)]">
      {/* Left column: Filters + Table + Summary + Pagination */}
      <div className="card">
        {/* Filters */}
        <div className="p-4 border-b border-neutral-200/50 dark:border-neutral-800/50 grid gap-3 sm:grid-cols-12 items-center">
          {/* Search input with icon (no overlap) */}
          <div className="sm:col-span-5">
            <div className="relative">
              <input
                className="input h-10 w-full"
                style={{ paddingLeft: '2.25rem' }} // ensure space regardless of .input defaults
                placeholder="Search category, notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
          </div>

          {/* Time span */}
          <div className="sm:col-span-3">
            <select
              className="input h-10 w-full"
              value={timeSpan}
              onChange={(e) => setTimeSpan(e.target.value as any)}
            >
              <option value="all">All time</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="this_year">This year</option>
              <option value="custom">Custom…</option>
            </select>
          </div>

          {/* Account select — explicit "All accounts" default */}
          <div className="sm:col-span-2">
            <select
              className="input h-10 w-full"
              value={filters.account_id ?? 'all'}
              onChange={(e) => {
                const v = e.target.value;
                updateFilters({ account_id: v === 'all' ? null : Number(v) });
              }}
            >
              <option value="all">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Type */}
          <div className="sm:col-span-2">
            <select
              className="input h-10 w-full"
              value={type}
              onChange={(e) => setType(e.target.value as TxTypeFilter)}
            >
              <option value="all">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          {/* Custom date range pickers */}
          {timeSpan === 'custom' && (
            <>
              <div className="sm:col-span-3">
                <input
                  type="date"
                  className="input h-10 w-full"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  placeholder="From"
                />
              </div>
              <div className="sm:col-span-3">
                <input
                  type="date"
                  className="input h-10 w-full"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  placeholder="To"
                />
              </div>
            </>
          )}
        </div>

        {/* Transactions table */}
        <div className="overflow-auto">
          <TransactionsTable
            items={data.items as Transaction[]}
            accounts={accounts}
            hidden={hidden}
            onDelete={requestDeleteTx}
            onUpdate={handleUpdateTx}
          />
        </div>

        {/* Summary line */}
        <div className="p-4 border-t border-neutral-200/50 dark:border-neutral-800/50">
          <div className="flex flex-wrap gap-4 justify-end text-sm">
            <div className="flex items-center gap-2">
              <span className="text-neutral-500">Total income</span>
              <Amount value={data.sum_income || 0} hidden={hidden} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-neutral-500">Total expenses</span>
              <Amount value={data.sum_expense || 0} hidden={hidden} />
            </div>
            <div className="flex items-center gap-2 font-medium">
              <span className="text-neutral-500">Saldo</span>
              <Amount value={(data.sum_income ?? 0) + (data.sum_expense ?? 0)} hidden={hidden} />
            </div>
          </div>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-neutral-200/50 dark:border-neutral-800/50 flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            {data.total} result{data.total === 1 ? '' : 's'} • Page {page} / {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              className="btn h-8 px-3"
              disabled={!filters.offset || loading}
              onClick={() =>
                setFilters(prev => ({
                  ...prev,
                  offset: Math.max(0, (prev.offset ?? 0) - (prev.limit ?? PAGE_SIZE)),
                }))
              }
            >
              Prev
            </button>
            <button
              className="btn h-8 px-3"
              disabled={(filters.offset ?? 0) + (filters.limit ?? PAGE_SIZE) >= (data.total ?? 0) || loading}
              onClick={() =>
                setFilters(prev => ({
                  ...prev,
                  offset: (prev.offset ?? 0) + (prev.limit ?? PAGE_SIZE),
                }))
              }
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Right column: Export card */}
      <div className="card p-4">
        <h2 className="text-base font-semibold mb-2">Export</h2>
        <p className="text-sm text-neutral-500 mb-3">Exports your current filtered result.</p>

        <div className="space-y-2 text-sm">
          <div className="font-medium">Export as</div>
          <label className="flex items-center gap-2">
            <input type="radio" name="exportfmt" defaultChecked readOnly />
            <span>Excel (.xlsx)</span>
          </label>
          <label className="flex items-center gap-2 opacity-50">
            <input type="radio" name="exportfmt" disabled readOnly />
            <span>PDF (coming soon)</span>
          </label>
        </div>

        <div className="mt-3 space-y-2 text-sm">
          <div className="font-medium">Choose columns</div>
          <div className="text-neutral-500">Date, Account, Category, Notes, Value</div>
        </div>

        <button className="btn btn-primary w-full mt-4" onClick={handleExport} disabled={loading}>
          Export
        </button>

        <div className="text-xs text-neutral-500 mt-2">
          File will be saved into your Downloads folder with a timestamped name.
        </div>
      </div>

      <ConfirmDialog
        open={confirmTxId !== null}
        title="Delete transaction?"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onCancel={() => setConfirmTxId(null)}
        onConfirm={confirmDeleteTx}
      />
    </div>
  );
}
