// The Terminal tab: blotter (left) + ledger column (right). Owns the server-side
// search state, the row selection, and the one-step undo for commits and deletes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Blotter, { type BlotterFilters, type TimeSpan } from '../components/terminal/Blotter';
import Ledger from '../components/terminal/Ledger';
import { useToast } from '../components/Toast';
import { addTransaction, addTransfer, deleteTransaction, searchTransactions, updateTransaction } from '../lib/api';
import { afterMutation, useData } from '../lib/data';
import { errorMessage } from '../lib/errors';
import { toISODate, todayDE } from '../lib/format';
import { formatAbs } from '../lib/number';
import { useShell } from '../lib/shell';
import type { Shortcut } from '../lib/shortcuts';
import { useBus } from '../hooks/useBus';
import { useI18n } from '../hooks/useI18n';
import { useShortcuts } from '../hooks/useShortcuts';
import { emit } from '../lib/bus';
import type {
  NewTransaction, NewTransfer, Transaction, TransactionSearch, TransactionSearchResult, UpdateTransaction,
} from '../types';

export type CommitStep = { kind: 'tx'; input: NewTransaction } | { kind: 'transfer'; input: NewTransfer };
export type CommitPlan = { label: string; description?: string; steps: CommitStep[] };

type UndoEntry = { kind: 'commit'; ids: number[] } | { kind: 'delete'; rows: Transaction[] };

const DEFAULT_LIMIT = 22;
const EMPTY: TransactionSearchResult = { items: [], total: 0, offset: 0, sum_income: 0, sum_expense: 0, sum_init: 0, sum_transfer: 0 };
const DEFAULT_FILTERS: BlotterFilters = {
  rawQuery: '', timeSpan: 'all', customFrom: '', customTo: '', accountId: null, type: 'all', sortBy: 'date', sortDir: 'asc',
};

function useDebounced<T>(value: T, delay = 250) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setD(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return d;
}

function rangeFor(span: TimeSpan, from: string, to: string): { date_from: string | null; date_to: string | null } {
  const now = new Date();
  const first = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const last = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
  switch (span) {
    case 'this_month': return { date_from: toISODate(first(now)), date_to: toISODate(now) };
    case 'last_month': {
      const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { date_from: toISODate(first(p)), date_to: toISODate(last(p)) };
    }
    case 'this_year': return { date_from: toISODate(new Date(now.getFullYear(), 0, 1)), date_to: toISODate(now) };
    case 'custom': return { date_from: from || null, date_to: to || null };
    default: return { date_from: null, date_to: null };
  }
}

export default function Terminal() {
  const data = useData();
  const toast = useToast();
  const shell = useShell();
  const { t } = useI18n();

  const [filters, setFiltersState] = useState<BlotterFilters>(DEFAULT_FILTERS);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(-1); // -1 = last page
  const query = useDebounced(filters.rawQuery, 250);

  const [result, setResult] = useState<TransactionSearchResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newId, setNewId] = useState<number | null>(null);
  const undoRef = useRef<UndoEntry | null>(null);

  const range = useMemo(() => rangeFor(filters.timeSpan, filters.customFrom, filters.customTo), [filters.timeSpan, filters.customFrom, filters.customTo]);
  const payload = useMemo<TransactionSearch>(
    () => ({
      limit, offset,
      sort_by: filters.sortBy, sort_dir: filters.sortDir,
      account_id: filters.accountId, date_from: range.date_from, date_to: range.date_to,
      query: query.trim() || undefined, tx_type: filters.type,
    }),
    [limit, offset, filters.sortBy, filters.sortDir, filters.accountId, range, query, filters.type]
  );
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const fetchNow = useCallback(async (p: TransactionSearch) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await searchTransactions(p);
      if (my !== seq.current) return;
      setResult(res);
      setError(null);
      // Pages are aligned to the newest end: the last page is always full and the
      // partial page (if any) is the oldest one. The server aligns from the start,
      // so a "last page" request is re-anchored once the total is known.
      const lim = p.limit ?? DEFAULT_LIMIT;
      if ((p.offset ?? -1) < 0 && res.total > lim && res.offset !== res.total - lim) setOffset(res.total - lim);
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void fetchNow(payload); }, [payload, fetchNow]);
  useBus('data:changed', () => void fetchNow(payloadRef.current));

  // Keep the selection only while the row is still in the result.
  useEffect(() => {
    if (loading) return;
    if (selectedId != null && !result.items.some((t) => t.id === selectedId)) setSelectedId(null);
    if (editingId != null && !result.items.some((t) => t.id === editingId)) setEditingId(null);
  }, [result, loading, selectedId, editingId]);

  const setFilters = useCallback((patch: Partial<BlotterFilters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    const resets: (keyof BlotterFilters)[] = ['timeSpan', 'customFrom', 'customTo', 'accountId', 'type', 'sortBy', 'sortDir'];
    if (resets.some((k) => k in patch)) setOffset(0);
  }, []);
  const clearFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
    setOffset(-1);
  }, []);
  useBus('blotter:filter', (p) => {
    if (p.clear) { clearFilters(); return; }
    const patch: Partial<BlotterFilters> = {};
    if (p.query !== undefined) patch.rawQuery = p.query;
    if (p.accountId !== undefined) patch.accountId = p.accountId;
    setFilters(patch);
  });

  const totalPages = Math.max(1, Math.ceil((result.total ?? 0) / limit));
  const page = Math.max(1, totalPages - Math.ceil(Math.max(0, result.total - result.offset) / limit) + 1);
  const goToPage = useCallback((p: number) => {
    const clamped = Math.max(1, Math.min(totalPages, p));
    setOffset(Math.max(0, result.total - limit * (totalPages - clamped + 1)));
  }, [limit, totalPages, result.total]);
  const onLimitChange = useCallback((n: number) => {
    if (n === limit) return;
    const atLast = result.offset + result.items.length >= result.total;
    setLimit(n);
    setOffset(atLast ? -1 : Math.max(0, result.offset));
  }, [limit, result]);

  /* ----- writes ----- */
  const commit = useCallback(async (plan: CommitPlan) => {
    const ids: number[] = [];
    for (const s of plan.steps) {
      if (s.kind === 'tx') ids.push(await addTransaction(s.input));
      else ids.push((await addTransfer(s.input)).from_id);
    }
    undoRef.current = { kind: 'commit', ids };
    setNewId(ids[0] ?? null);
    setOffset(-1);
    toast.success(plan.label, { description: plan.description });
    afterMutation();
  }, [toast]);

  const update = useCallback(async (patch: UpdateTransaction) => {
    try {
      await updateTransaction(patch);
      toast.success(t('tx.updated'));
      afterMutation();
    } catch (e) {
      toast.error(t('tx.updateFailed'), { description: errorMessage(e) });
      throw e;
    }
  }, [toast, t]);

  const undo = useCallback(async () => {
    const u = undoRef.current;
    if (!u) { toast.info(t('undo.nothing')); return; }
    undoRef.current = null;
    try {
      if (u.kind === 'commit') {
        for (const id of u.ids) await deleteTransaction(id);
        toast.success(t('undo.commitUndone'));
      } else if (u.rows.length >= 2) {
        const from = u.rows.find((r) => r.amount < 0) ?? u.rows[0];
        const to = u.rows.find((r) => r.id !== from.id) ?? u.rows[1];
        await addTransfer({
          from_account_id: from.account_id, to_account_id: to.account_id, date: from.date,
          amount: Math.abs(from.amount), description: from.description ?? null, category: from.category ?? null,
        });
        toast.success(t('undo.transferRestored'));
      } else {
        const r = u.rows[0];
        await addTransaction({ account_id: r.account_id, date: r.date, amount: r.amount, description: r.description ?? null, category: r.category ?? null });
        toast.success(t('undo.txRestored'));
      }
      afterMutation();
    } catch (e) {
      toast.error(t('undo.failed'), { description: errorMessage(e) });
    }
  }, [toast, t]);
  useBus('undo', () => void undo());

  const remove = useCallback(async (id: number) => {
    const row = result.items.find((t) => t.id === id) ?? data.txAll.find((t) => t.id === id);
    if (!row) return;
    const rows = row.transfer_id != null ? data.txAll.filter((t) => t.transfer_id === row.transfer_id) : [];
    try {
      await deleteTransaction(id);
    } catch (e) {
      toast.error(t('tx.deleteFailed'), { description: errorMessage(e) });
      return;
    }
    undoRef.current = { kind: 'delete', rows: rows.length >= 2 ? rows : [row] };
    const idx = result.items.findIndex((t) => t.id === id);
    const next = result.items[idx + 1] ?? result.items[idx - 1];
    setSelectedId(next?.id ?? null);
    setEditingId(null);
    toast.success(row.transfer_id != null ? t('tx.transferDeleted') : t('tx.deleted'), {
      description: `${row.category ?? '—'} · ${formatAbs(row.amount)} €`,
      actions: [{ label: t('action.undo'), onClick: () => undo() }],
    });
    afterMutation();
  }, [result.items, data.txAll, toast, undo, t]);

  const duplicate = useCallback((row: Transaction) => {
    emit('quick-entry:prefill', {
      direction: row.amount >= 0 ? 'in' : 'out',
      date: todayDE(),
      category: row.category ?? '',
      notes: row.description ?? '',
      amount: Math.abs(row.amount),
      accountId: row.account_id,
      focus: 'amount',
    });
  }, []);

  /* ----- row keyboard map (silent while typing or while an overlay is open) ----- */
  const shortcuts = useMemo<Shortcut[]>(() => {
    const move = (delta: number) => {
      const items = result.items;
      if (items.length === 0) return;
      const idx = items.findIndex((t) => t.id === selectedId);
      const next = idx < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, idx + delta));
      setSelectedId(items[next].id);
    };
    return [
      { id: 'down', keys: 'J', description: t('sc.rowDown'), match: (e) => e.key === 'j' || e.key === 'ArrowDown', run: () => move(1) },
      { id: 'up', keys: 'K', description: t('sc.rowUp'), match: (e) => e.key === 'k' || e.key === 'ArrowUp', run: () => move(-1) },
      { id: 'edit', keys: 'Enter', description: t('sc.rowEdit'), when: () => selectedId != null && editingId == null, match: (e) => e.key === 'Enter', run: () => setEditingId(selectedId) },
      { id: 'delete', keys: 'Backspace', description: t('sc.rowDelete'), when: () => selectedId != null && editingId == null, match: (e) => e.key === 'Backspace' || e.key === 'Delete', run: () => { if (selectedId != null) void remove(selectedId); } },
      { id: 'esc', keys: 'Esc', description: t('sc.rowEsc'), when: () => selectedId != null && editingId == null, match: (e) => e.key === 'Escape', run: () => setSelectedId(null) },
    ];
  }, [result.items, selectedId, editingId, remove, t]);
  useShortcuts(shortcuts);

  const filterAccount = filters.accountId != null ? data.accountById.get(filters.accountId) ?? null : null;
  const exportPayload = useMemo<TransactionSearch>(() => ({ ...payload, limit: undefined, offset: undefined }), [payload]);

  return (
    <div className="t-terminal">
      <Blotter
        filters={filters}
        onFilters={setFilters}
        onClear={clearFilters}
        result={result}
        loading={loading}
        error={error}
        onRetry={() => void fetchNow(payloadRef.current)}
        limit={limit}
        onLimitChange={onLimitChange}
        page={page}
        totalPages={totalPages}
        onPage={goToPage}
        selectedId={selectedId}
        onSelect={setSelectedId}
        editingId={editingId}
        onEdit={setEditingId}
        newId={newId}
        onUpdate={update}
        onDelete={(id) => void remove(id)}
        onDuplicate={duplicate}
        onCommit={commit}
        hidden={shell.hidden}
      />
      <Ledger exportPayload={exportPayload} exportTotal={result.total} filterAccount={filterAccount} />
    </div>
  );
}
