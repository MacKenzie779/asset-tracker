import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import {
  listAccounts,
  searchTransactions,
  deleteTransaction,
  updateTransaction,
  exportTransactionsXlsx,
  exportTransactionsPdf,
  // NEW:
  exportReimbursableReportXlsx,
  exportReimbursableReportPdf,
} from '../lib/api';

import type {
  Account,
  Transaction,
  UpdateTransaction,
  TransactionSearch,
  TransactionSearchResult,
  TxTypeFilter,
  TxSortBy,
  TxSortDir,
} from '../types';

import Amount from '../components/Amount';
import ConfirmDialog from '../components/ConfirmDialog';
import BasicSelect from '../components/BasicSelect';
import AccountSelectTx from './transactions/AccountSelectTx';
import TransactionTableTx from '../components/TransactionTableTx';

type OutletCtx = { hidden: boolean };

const PAGE_SIZE = 18;

/* ---------- helpers ---------- */
function ymd(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function firstDayOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function firstDayOfYear(d = new Date()) { return new Date(d.getFullYear(), 0, 1); }

function useDebounced<T>(value: T, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/* ---------- hooks ---------- */
function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { listAccounts().then(setAccounts).catch(console.error); }, []);
  return accounts;
}

function useSearch() {
  const [filters, setFilters] = useState<TransactionSearch>({
    limit: PAGE_SIZE,
    offset: -1,             // ask server for LAST PAGE initially
    tx_type: 'all',
    account_id: null,
    sort_by: 'date',
    sort_dir: 'asc',
  });

  const update = (patch: Partial<TransactionSearch>) =>
    setFilters(prev => {
      const next = { ...prev, ...patch };
      // core filter/sort changes → jump to first page
      if (
        'date_from' in patch ||
        'date_to' in patch ||
        'account_id' in patch ||
        'tx_type' in patch ||
        'sort_by' in patch ||
        'sort_dir' in patch
      ) {
        next.offset = 0;
      }
      return next;
    });

  return [filters, update, setFilters] as const;
}

/* ---------- page ---------- */
export default function Transactions() {
  const ALL_EXPORT_COLS = [
    { key: 'date',        label: 'Date' },
    { key: 'account',     label: 'Account' },
    { key: 'category',    label: 'Category' },
    { key: 'description', label: 'Notes' },
    { key: 'amount',      label: 'Value' },
  ] as const;

  const [exportCols, setExportCols] = useState<string[]>(
    ALL_EXPORT_COLS.map(c => c.key) // default: all
  );
  const toggleExportCol = (key: string) =>
    setExportCols(cols => cols.includes(key) ? cols.filter(k => k !== key) : [...cols, key]);

  const [exportFmt, setExportFmt] = useState<'xlsx' | 'pdf'>('xlsx');
  const [exportOkPath, setExportOkPath] = useState<string | null>(null);

  const { hidden } = useOutletContext<OutletCtx>();
  const accounts = useAccounts();

  const [filters, updateFilters, setFilters] = useSearch();

  const [rawQuery, setRawQuery] = useState('');
  const query = useDebounced(rawQuery, 250);

  const [type, setType] = useState<TxTypeFilter>('all');

  const [timeSpan, setTimeSpan] =
    useState<'all' | 'this_month' | 'last_month' | 'this_year' | 'custom'>('all');
  const [pendingCustom, setPendingCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TransactionSearchResult>({
    items: [],
    total: 0,
    offset: 0,            // server-computed effective offset
    sum_income: 0,
    sum_expense: 0,
  });

  const [confirmTxId, setConfirmTxId] = useState<number | null>(null);

  // prevent races between overlapping fetches
  const reqSeqRef = useRef(0);

  // pull out primitives to stabilize deps
  const { limit, offset, sort_by, sort_dir, account_id, date_from, date_to } = filters;

  const page = useMemo(
    () => Math.floor((data.offset ?? 0) / (limit ?? PAGE_SIZE)) + 1,
    [data.offset, limit]
  );
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data.total ?? 0) / (limit ?? PAGE_SIZE))),
    [data.total, limit]
  );

  /* ----- current selected account (for reimbursable export button state) ----- */
  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === (account_id ?? -1)) ?? null,
    [accounts, account_id]
  );
  const isReimbursableSelected = selectedAccount?.type === 'reimbursable';
  const selectedBalance = selectedAccount?.balance ?? 0;

  /* ----- main fetch ----- */
  useEffect(() => {
    const mySeq = ++reqSeqRef.current;
    setLoading(true);

    const payload: TransactionSearch = {
      limit, offset, sort_by, sort_dir, account_id, date_from, date_to,
      query: query.trim() || undefined,
      tx_type: type,
    };

    searchTransactions(payload)
      .then((res) => {
        if (mySeq !== reqSeqRef.current) return; // stale
        setData(res);
      })
      .catch(console.error)
      .finally(() => {
        if (mySeq === reqSeqRef.current) setLoading(false);
      });
  }, [limit, offset, sort_by, sort_dir, account_id, date_from, date_to, type, query]);

  const refresh = async () => {
    const mySeq = ++reqSeqRef.current;
    setLoading(true);
    const fresh = await searchTransactions({
      limit, offset, sort_by, sort_dir, account_id, date_from, date_to,
      query: query.trim() || undefined,
      tx_type: type,
    });
    if (mySeq === reqSeqRef.current) {
      setData(fresh);
      setLoading(false);
    }
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

  // --- Time span handling (no effect; explicit handlers) ---
  const handleTimeSpanChange = (v: 'all' | 'this_month' | 'last_month' | 'this_year' | 'custom') => {
    setTimeSpan(v);
    const now = new Date();
    if (v === 'all') {
      // Clear date bounds and ask server for LAST PAGE again
      setFilters(prev => ({ ...prev, date_from: null, date_to: null, offset: -1 }));
    } else if (v === 'this_month') {
      updateFilters({ date_from: ymd(firstDayOfMonth(now)), date_to: ymd(now) });
    } else if (v === 'last_month') {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      updateFilters({ date_from: ymd(firstDayOfMonth(prevMonth)), date_to: ymd(lastDayOfMonth(prevMonth)) });
    } else if (v === 'this_year') {
      updateFilters({ date_from: ymd(firstDayOfYear(now)), date_to: ymd(now) });
    } else {
      // 'custom' → show inputs; do nothing until Apply
    }
  };

  // Header click → toggle / set sort (server-side)
  const handleHeaderSort = (by: TxSortBy) => {
    setFilters(prev => {
      const nextDir: TxSortDir =
        prev.sort_by === by ? (prev.sort_dir === 'asc' ? 'desc' : 'asc') : 'asc';
      return { ...prev, sort_by: by, sort_dir: nextDir, offset: 0 };
    });
  };

  // --- Export (XLSX / PDF) + success modal ---
  const handleExport = async () => {
    if (exportCols.length === 0) {
      alert('Please choose at least one column to export.');
      return;
    }
    setLoading(true);
    try {
      const common = {
        limit, offset, sort_by, sort_dir, account_id, date_from, date_to,
        query: query.trim() || undefined,
        tx_type: type,
      };
      const path =
        exportFmt === 'pdf'
          ? await exportTransactionsPdf(common, exportCols)
          : await exportTransactionsXlsx(common, exportCols);

      setExportOkPath(path); // open success modal
    } catch (e) {
      console.error(e);
      alert('Export failed. See console for details.');
    } finally {
      setLoading(false);
    }
  };

  // --- NEW: Export reimbursable report (only when filtered to reimbursable account) ---
  const handleExportReimbursable = async () => {
    if (!account_id || !isReimbursableSelected) {
      alert('Filter to a reimbursable account first.');
      return;
    }
    if (exportCols.length === 0) {
      alert('Please choose at least one column to export.');
      return;
    }
    setLoading(true);
    try {
      // We pass current filters; the backend will enforce reimbursable mode and ignore date/query for the slice.
      const common = {
        limit, offset, sort_by, sort_dir, account_id, date_from, date_to,
        query: query.trim() || undefined,
        tx_type: type,
      };
      const path =
        exportFmt === 'pdf'
          ? await exportReimbursableReportPdf(common, exportCols)
          : await exportReimbursableReportXlsx(common, exportCols);

      setExportOkPath(path);
    } catch (e) {
      console.error(e);
      alert('Reimbursable export failed. See console for details.');
    } finally {
      setLoading(false);
    }
  };

  const reimbursableDisabled = !account_id || !isReimbursableSelected;

  return (
    <div className="px-3 sm:px-4 md:px-6 pt-4 grid gap-6 2xl:grid-cols-[minmax(1280px,1fr)_minmax(60px,480px)]">
      {/* Left column */}
      <div className="card">
        {/* Filters */}
        <div className="p-4 border-b border-neutral-200/50 dark:border-neutral-800/50 grid gap-3 sm:grid-cols-12 items-center">
          {/* Search */}
          <div className="sm:col-span-5">
            <div className="relative">
              <input
                className="input h-10 w-full"
                style={{ paddingLeft: '2.25rem' }}
                placeholder="Search category, notes"
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
              />
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
          </div>

          {/* Time span */}
          <div className="sm:col-span-3">
            <BasicSelect
              options={[
                { value: 'all', label: 'All time' },
                { value: 'this_month', label: 'This month' },
                { value: 'last_month', label: 'Last month' },
                { value: 'this_year', label: 'This year' },
                { value: 'custom', label: 'Custom…' },
              ]}
              value={timeSpan}
              onChange={(v) => handleTimeSpanChange(v as any)}
              placeholder="Time span"
              className="w-full"
            />
          </div>

          {/* Account */}
          <div className="sm:col-span-2">
            <AccountSelectTx
              options={accounts}
              value={account_id ?? null}
              onChange={(v) => updateFilters({ account_id: v })}
              className="w-full"
            />
          </div>

          {/* Type */}
          <div className="sm:col-span-2">
            <BasicSelect
              options={[
                { value: 'all', label: 'All types' },
                { value: 'income', label: 'Income' },
                { value: 'expense', label: 'Expense' },
              ]}
              value={type}
              onChange={(v) => setType(v as TxTypeFilter)}
              placeholder="Type"
              className="w-full"
            />
          </div>

          {/* Custom date range (Apply) */}
          {timeSpan === 'custom' && (
            <>
              <div className="sm:col-span-3">
                <input
                  type="date"
                  className="input h-10 w-full"
                  value={pendingCustom.from}
                  onChange={(e) => setPendingCustom(p => ({ ...p, from: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-3">
                <input
                  type="date"
                  className="input h-10 w-full"
                  value={pendingCustom.to}
                  onChange={(e) => setPendingCustom(p => ({ ...p, to: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button
                  className="btn h-10 px-3"
                  onClick={() => {
                    updateFilters({
                      date_from: pendingCustom.from || null,
                      date_to: pendingCustom.to || null,
                    });
                  }}
                >
                  Apply
                </button>
                <button
                  className="btn h-10 px-3"
                  onClick={() => {
                    setPendingCustom({ from: '', to: '' });
                    setTimeSpan('all');
                    // Clear bounds and go to LAST page again
                    setFilters(prev => ({ ...prev, date_from: null, date_to: null, offset: -1 }));
                  }}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>

        {/* Table (server order; header controls sorting) */}
        <div className="overflow-auto">
          <TransactionTableTx
            items={data.items as Transaction[]}
            accounts={accounts}
            hidden={hidden}
            onDelete={id => setConfirmTxId(id)}
            onUpdate={handleUpdateTx}
            sortBy={(sort_by ?? 'date') as TxSortBy}
            sortDir={(sort_dir ?? 'asc') as TxSortDir}
            onRequestSort={handleHeaderSort}
          />
        </div>

        {/* Summary */}
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
              disabled={data.offset <= 0 || loading}
              onClick={() =>
                setFilters(prev => {
                  const next = Math.max(0, data.offset - (prev.limit ?? PAGE_SIZE));
                  return (prev.offset ?? 0) === next ? prev : { ...prev, offset: next };
                })
              }
            >
              Prev
            </button>
            <button
              className="btn h-8 px-3"
              disabled={data.offset + (limit ?? PAGE_SIZE) >= (data.total ?? 0) || loading}
              onClick={() =>
                setFilters(prev => {
                  const next = data.offset + (prev.limit ?? PAGE_SIZE);
                  return (prev.offset ?? 0) === next ? prev : { ...prev, offset: next };
                })
              }
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Right column: Export */}
      <div className="card p-4">
        <h2 className="text-base font-semibold mb-2">Export</h2>
        <p className="text-sm text-neutral-500 mb-3">Exports your current filtered result.</p>

        <div className="space-y-2 text-sm">
          <div className="font-medium">Export as</div>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="exportfmt"
              checked={exportFmt === 'xlsx'}
              onChange={() => setExportFmt('xlsx')}
            />
            <span>Excel (.xlsx)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="exportfmt"
              checked={exportFmt === 'pdf'}
              onChange={() => setExportFmt('pdf')}
            />
            <span>PDF (.pdf)</span>
          </label>
        </div>

        <div className="mt-3 space-y-2 text-sm">
          <div className="font-medium">Choose columns</div>
          <div className="grid gap-1">
            {ALL_EXPORT_COLS.map(col => (
              <label key={col.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={exportCols.includes(col.key)}
                  onChange={() => toggleExportCol(col.key)}
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>
        </div>

        <button className="btn btn-primary w-full mt-4" onClick={handleExport} disabled={loading}>
          Export
        </button>

        {/* NEW: reimbursable button */}
        <button
          className="btn w-full mt-2"
          onClick={handleExportReimbursable}
          disabled={loading || reimbursableDisabled}
          title={
            reimbursableDisabled
              ? 'Filter to a reimbursable account to enable'
              : undefined
          }
        >
          Export reimbursable report
        </button>

        <div className="text-xs text-neutral-500 mt-2">
          File will be saved into your Downloads folder with a timestamped name.
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmTxId !== null}
        title="Delete transaction?"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onCancel={() => setConfirmTxId(null)}
        onConfirm={async () => {
          const id = confirmTxId!;
          setConfirmTxId(null);
          await deleteTransaction(id);
          await refresh();
        }}
      />

      {/* Export success modal (single OK button) */}
      <ConfirmDialog
        open={exportOkPath !== null}
        title="Export successful"
        description={`Saved to:\n${exportOkPath ?? ''}`}
        confirmText="OK"
        onConfirm={() => setExportOkPath(null)}
        onCancel={() => setExportOkPath(null)}
      />
    </div>
  );
}
