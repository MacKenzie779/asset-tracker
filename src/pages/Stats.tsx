import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import clsx from 'clsx';
import {
  listAccounts,
  listTransactionsAll,
  searchTransactions,
} from '../lib/api';
import type { Account } from '../types';
import type { TxMini } from '../lib/api';
import Amount from '../components/Amount';
import PageContainer from '../components/PageContainer';
import Skeleton from '../components/Skeleton';
import { useToast } from '../components/Toast';
import type { LayoutOutletContext } from '../components/Layout';
import { useTheme } from '../hooks/useTheme';
import { chartTheme } from '../lib/theme';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { formatMoneyDE } from '../lib/number';
import { owedToYou, totalValue, youOwe } from '../lib/people';

// Recharts
import {
  ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip as RTooltip, Legend as RLegend,
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Brush,
} from 'recharts';

type TxExt = { id: number; date: string; amount: number; category?: string | null; description?: string | null; transfer_id?: number | null };
type GroupBy = 'monthly' | 'yearly';
type Range = '6m' | '12m' | '24m' | '36m' | 'ytd' | 'all';

// consistent colour (prefer account.color)
const FALLBACK_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#db2777', '#0891b2', '#ca8a04', '#7c3aed', '#ef4444'];
const colorFor = (idx: number, hex?: string | null) => hex || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];

// Internal bookkeeping categories that must not pollute spending analytics.
const EXCLUDED_CATEGORIES = new Set(['transfer', 'transfers', 'init', 'korrektur']);
const EXCLUDED_NOTE = 'Transfers and initial balances excluded';
const EXCLUDED_TITLE = 'Excluded categories: Transfer, Transfers, Init, Korrektur';

export default function Stats() {
  const { hidden } = useOutletContext<LayoutOutletContext>();
  const toast = useToast();
  const { resolved } = useTheme();
  const t = useMemo(() => chartTheme(resolved), [resolved]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txAll, setTxAll] = useState<TxMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [txCatItems, setTxCatItems] = useState<TxExt[]>([]);
  const [catLoading, setCatLoading] = useState(true);

  // controls
  const [groupBy, setGroupBy] = useState<GroupBy>('monthly');
  const [range, setRange] = useState<Range>('12m');
  const [showIndividualAccounts, setShowIndividualAccounts] = useState(false);

  // quick helper (month start/end)
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [acc, tx] = await Promise.all([
          listAccounts(),
          listTransactionsAll(),
        ]);
        setAccounts(acc);
        setTxAll(tx);
      } catch (e) {
        toast.error('Could not load statistics', { description: errorMessage(e) });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      setCatLoading(true);
      try {
        const pageSize = 1000;
        let offset = 0;
        const all: TxExt[] = [];
        while (true) {
          const res = await searchTransactions({
            tx_type: 'all', // fetch all to do both income and expenses
            limit: pageSize,
            offset,
            sort_by: 'id',
            sort_dir: 'asc',
          });
          const items = (res.items ?? []) as any[];
          all.push(...items.map(it => ({
            id: it.id,
            date: it.date,
            amount: it.amount,
            category: it.category,
            description: it.description,
            transfer_id: it.transfer_id ?? null,
          })));
          const total: number = (res as any).total ?? items.length;
          offset += pageSize;
          if (offset >= total) break;
        }
        setTxCatItems(all);
      } catch (e) {
        console.error('fetch categories failed', e);
        toast.error('Could not load category statistics', { description: errorMessage(e) });
        setTxCatItems([]);
      } finally {
        setCatLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =========================
     Derived values / helpers
     ========================= */

  // Net worth pie: every positive balance is an asset, including what people owe you
  const pieData = useMemo(() => {
    const rows = accounts.map((a, i) => {
      return { id: a.id, name: a.name, value: a.balance ?? 0, color: colorFor(i, a.color) };
    }).filter(r => r.value > 0.000001); // pie can't show negatives; we skip <=0 slices
    const total = rows.reduce((s,r)=>s+r.value,0);
    return { rows, total };
  }, [accounts]);

  // Balances with people
  const owed = useMemo(() => owedToYou(accounts), [accounts]);
  const owe = useMemo(() => youOwe(accounts), [accounts]);

  // Monthly net for current month (backend sums exclude transfers)
  const [monthNet, setMonthNet] = useState<number>(0);
  useEffect(() => {
    (async () => {
      const res = await searchTransactions({
        date_from: iso(firstOfMonth),
        date_to: iso(today),
        tx_type: 'all',
        limit: 1, offset: 0, sort_by: 'date', sort_dir: 'asc', // minimal page; sums are global
      });
      const net = (res.sum_income ?? 0) + (res.sum_expense ?? 0);
      setMonthNet(net);
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Build time series (monthly/yearly) for total net worth and each account
  const series = useMemo(() => {
    if (!accounts.length) return { keys: [] as string[], data: [] as any[] };

    // group boundary function
    const groupKey = (d: Date) =>
      groupBy === 'yearly' ? `${d.getFullYear()}` : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

    // range cutoff
    const firstDate = txAll.length ? parseISO(txAll[0].date) : today;
    const startAll = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const allKeys = enumerateGroups(startAll, today, groupBy);

    const cutoffKeys =
      range === 'all' ? allKeys :
      range === 'ytd' ? allKeys.filter(k => k.startsWith(`${today.getFullYear()}`)) :
      (() => {
          const n = range === '6m' ? 6 : range === '12m' ? 12 : range === '24m' ? 24 : range === '36m' ? 36 : 12;
          return allKeys.slice(-n);
      })();

    // Build cumulative balances per account per group end (last day of month / end of year)
    const accIds = accounts.map(a => a.id);
    // initialize running totals (by account)
    const run: Record<number, number> = {};
    accIds.forEach(id => { run[id] = 0; });

    // pre-bucket transactions by group key
    const buckets: Record<string, TxMini[]> = {};
    for (const tx of txAll) {
      const d = parseISO(tx.date);
      const k = groupKey(d);
      (buckets[k] ||= []).push(tx);
    }
    // ensure buckets are date asc (they already are in txAll asc, but safe)
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a,b) => a.date.localeCompare(b.date));
    }

    // accumulate through groups
    const rows: any[] = [];

    for (const key of allKeys) {
      const txs = buckets[key] || [];
      // apply all tx in this group
      for (const tx of txs) {
        run[tx.account_id] = (run[tx.account_id] || 0) + tx.amount;
      }

      // snapshot at group end
      const point: any = { key };

      // per-account
      for (const a of accounts) {
        point[`acc_${a.id}`] = run[a.id] || 0;
      }
      // total net worth (plain sum of balances)
      point.total = accounts.reduce((s, a) => s + (run[a.id] || 0), 0);

      rows.push(point);
    }

    // reduce to chosen range
    const byKey = new Map(rows.map(r => [r.key, r]));
    const filtered = cutoffKeys.map(k => byKey.get(k)!).filter(Boolean);

    return { keys: cutoffKeys, data: filtered };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, txAll, groupBy, range]);

  // Lines config for accounts
  const accountLines = useMemo(() => {
    return accounts.map((a, i) => ({
      id: a.id,
      key: `acc_${a.id}`,
      name: a.name,
      color: colorFor(i, a.color),
    }));
  }, [accounts]);

  const totalBalance = useMemo(() => totalValue(accounts), [accounts]);

  // Toggle visibility by account (affects lines & pie)
  const [hiddenAcc, setHiddenAcc] = useState<Set<number>>(new Set());
  const toggleAcc = (id: number) =>
    setHiddenAcc(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const isAccHidden = (id: number) => hiddenAcc.has(id);

  const pieRowsVisible = useMemo(
    () => pieData.rows.filter(r => !hiddenAcc.has(r.id)),
    [pieData.rows, hiddenAcc]
  );

  // ==== Categories & Exclusions ====
  const expensesByCategory = useMemo(() => {
    const sums = new Map<string, number>();
    for (const tx of txCatItems) {
      if (tx.transfer_id != null) continue; // transfer legs are not spending
      if (tx.amount >= 0) continue; // Only expenses
      const name = (tx.category ?? 'Uncategorized').toString();
      const lc = name.toLowerCase();
      if (EXCLUDED_CATEGORIES.has(lc)) continue;
      const v = Math.abs(tx.amount);
      if (v > 0) sums.set(name, (sums.get(name) ?? 0) + v);
    }
    const rows = Array.from(sums.entries())
      .map(([name, value], i) => ({ name, value, color: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { rows, total };
  }, [txCatItems]);

  const incomeByCategory = useMemo(() => {
    const sums = new Map<string, number>();
    for (const tx of txCatItems) {
      if (tx.transfer_id != null) continue; // transfer legs are not income
      if (tx.amount <= 0) continue; // Only income
      const name = (tx.category ?? 'Uncategorized').toString();
      const lc = name.toLowerCase();
      if (EXCLUDED_CATEGORIES.has(lc)) continue;
      const v = tx.amount;
      if (v > 0) sums.set(name, (sums.get(name) ?? 0) + v);
    }
    const rows = Array.from(sums.entries())
      .map(([name, value], i) => ({ name, value, color: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { rows, total };
  }, [txCatItems]);

  // Savings rate
  const totalIncome = incomeByCategory.total;
  const totalExpense = expensesByCategory.total;
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

  // Top 5 Expenses
  const topExpenses = useMemo(() => {
    return [...txCatItems]
      .filter(tx => tx.amount < 0 && tx.transfer_id == null && !EXCLUDED_CATEGORIES.has((tx.category ?? '').toLowerCase()))
      .sort((a, b) => a.amount - b.amount) // smaller negative value means larger expense
      .slice(0, 5);
  }, [txCatItems]);

  // Income vs Expenses over time (Bar Chart)
  const incExpSeries = useMemo(() => {
    const groupKey = (d: Date) =>
      groupBy === 'yearly' ? `${d.getFullYear()}` : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

    const firstDate = txCatItems.length ? parseISO(txCatItems[0].date) : today;
    const startAll = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const allKeys = enumerateGroups(startAll, today, groupBy);

    const cutoffKeys =
      range === 'all' ? allKeys :
      range === 'ytd' ? allKeys.filter(k => k.startsWith(`${today.getFullYear()}`)) :
      (() => {
        const n = range === '6m' ? 6 : range === '12m' ? 12 : range === '24m' ? 24 : range === '36m' ? 36 : 12;
        return allKeys.slice(-n);
      })();

    const buckets: Record<string, { income: number, expense: number }> = {};
    for (const k of allKeys) buckets[k] = { income: 0, expense: 0 };

    for (const tx of txCatItems) {
      if (tx.transfer_id != null) continue;
      const k = groupKey(parseISO(tx.date));
      if (!buckets[k]) continue;

      const lc = (tx.category ?? 'Uncategorized').toString().toLowerCase();
      if (EXCLUDED_CATEGORIES.has(lc)) continue;

      if (tx.amount > 0) buckets[k].income += tx.amount;
      else if (tx.amount < 0) buckets[k].expense += Math.abs(tx.amount);
    }

    return {
      keys: cutoffKeys,
      data: cutoffKeys.map(key => ({
        key,
        Income: buckets[key].income,
        Expense: buckets[key].expense,
      }))
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txCatItems, groupBy, range]);

  // Shared chart chrome (theme-aware)
  const axisProps = {
    tick: { fill: t.tick, fontSize: 12 },
    axisLine: { stroke: t.axis },
    tickLine: { stroke: t.axis },
  };
  const tooltipStyle = {
    contentStyle: t.tooltip,
    itemStyle: { color: t.text },
    labelStyle: { color: t.tick },
  };

  const kpiLoading = loading && accounts.length === 0;

  /* =========================
         UI
     ========================= */
  return (
    <PageContainer className="grid gap-6">
      {/* Top cards */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:grid-cols-5">
        <div className="card p-5">
          <p className="text-xs text-neutral-500">Total value</p>
          <div className="mt-1 text-3xl font-bold md:text-4xl">
            {kpiLoading ? <Skeleton className="mt-1 h-9 w-40" /> : <Amount value={totalBalance} hidden={hidden} />}
          </div>
          <p className="mt-1 text-xs text-neutral-500">Accounts plus balances with people</p>
        </div>

        <div className="card p-5">
          <p className="text-xs text-neutral-500">Owed to you</p>
          <div className="mt-1 text-3xl font-bold md:text-4xl">
            {kpiLoading ? <Skeleton className="mt-1 h-9 w-40" /> : (
              <Amount value={owed} hidden={hidden} colorBySign={false} className={owed > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''} />
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">What people still have to pay you</p>
        </div>

        <div className="card p-5">
          <p className="text-xs text-neutral-500">You owe</p>
          <div className="mt-1 text-3xl font-bold md:text-4xl">
            {kpiLoading ? <Skeleton className="mt-1 h-9 w-40" /> : (
              <Amount value={owe} hidden={hidden} colorBySign={false} className={owe > 0 ? 'text-rose-600 dark:text-rose-400' : ''} />
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">What you still have to pay people</p>
        </div>

        <div className="card p-5">
          <p className="text-xs text-neutral-500">Net this month</p>
          <div className="mt-1 text-3xl font-bold md:text-4xl">
            <Amount value={monthNet} hidden={hidden} colorBySign />
          </div>
          <p className="mt-1 text-xs text-neutral-500">Transfers excluded</p>
        </div>

        <div className="card p-5">
          <p className="text-xs text-neutral-500">Avg savings rate</p>
          <div
            className={clsx(
              'mt-1 text-3xl font-bold md:text-4xl',
              savingsRate >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            )}
          >
            {catLoading ? <Skeleton className="mt-1 h-9 w-28" /> : hidden ? '***' : `${savingsRate.toFixed(1).replace('.', ',')} %`}
          </div>
          <p className="mt-1 text-xs text-neutral-500">Overall (income vs expenses)</p>
        </div>
      </section>

      {/* Top Expenses */}
      {topExpenses.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 text-base font-semibold">Top expenses (all time)</h2>
          <div className="grid gap-2">
            {topExpenses.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-2 text-sm last:border-0 last:pb-0 dark:border-neutral-800">
                <div className="min-w-0">
                  <span className="font-medium tabular-nums">{formatDate(tx.date)}</span>
                  <span className="ml-2 text-neutral-500">{tx.category ?? 'Uncategorized'}</span>
                  {tx.description && <div className="mt-0.5 truncate text-xs text-neutral-400">{tx.description}</div>}
                </div>
                <div className="shrink-0 font-semibold">
                  <Amount value={tx.amount} hidden={hidden} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Split by account (Pie) */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Total value split by account</h2>
          {loading && <span className="text-xs text-neutral-500">Loading…</span>}
        </div>

        <div className="mt-3 w-full" style={{ height: 320 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={pieRowsVisible}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={110}
                stroke={t.surface}
                label={({ name, percent }: { name?: string; percent?: number }) =>
                  `${name ?? ''} ${Math.round((percent ?? 0) * 100)}%`
                }
              >
                {pieRowsVisible.map((r) => (
                  <Cell
                    key={r.id}
                    fill={r.color}
                    cursor="pointer"
                    onClick={() => toggleAcc(r.id)} // toggle by clicking a slice
                  />
                ))}
              </Pie>

              <RTooltip {...tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(v), n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Clickable legend chips (independent toggles for the pie) */}
        <div className="mt-3 flex flex-wrap gap-2">
          {pieData.rows.map((r) => {
            const isOff = isAccHidden(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleAcc(r.id)}
                aria-pressed={!isOff}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  isOff
                    ? 'opacity-50 ring-1 ring-neutral-400 hover:opacity-70'
                    : 'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700'
                )}
                title={isOff ? 'Show account' : 'Hide account'}
              >
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: r.color }} aria-hidden="true" />
                <span className="whitespace-nowrap">{r.name}</span>
              </button>
            );
          })}
        </div>

        {/* Quick actions */}
        {pieData.rows.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary h-7 px-2 text-xs"
              onClick={() => setHiddenAcc(new Set())}
            >
              Show all
            </button>
            <button
              type="button"
              className="btn btn-secondary h-7 px-2 text-xs"
              onClick={() => setHiddenAcc(new Set(pieData.rows.map(r => r.id)))}
            >
              Hide all
            </button>
          </div>
        )}

        {!loading && pieData.rows.length === 0 && (
          <p className="mt-2 text-sm text-neutral-500">Nothing to show yet.</p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Expenses by category (Pie) */}
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Expenses by category</h2>
            <span className="text-xs text-neutral-500" title={EXCLUDED_TITLE}>
              {catLoading ? 'Loading…' : EXCLUDED_NOTE}
            </span>
          </div>
          <div className="mt-3 w-full" style={{ height: 320 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={expensesByCategory.rows}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={110}
                  stroke={t.surface}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ''} ${Math.round((percent ?? 0) * 100)}%`
                  }
                >
                  {expensesByCategory.rows.map((r, idx) => (
                    <Cell key={idx} fill={r.color} />
                  ))}
                </Pie>
                <RTooltip {...tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(v), n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {!catLoading && expensesByCategory.rows.length === 0 && (
            <p className="mt-2 text-sm text-neutral-500">Nothing to show yet.</p>
          )}
        </div>

        {/* Income by category (Pie) */}
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Income by category</h2>
            <span className="text-xs text-neutral-500" title={EXCLUDED_TITLE}>
              {catLoading ? 'Loading…' : EXCLUDED_NOTE}
            </span>
          </div>
          <div className="mt-3 w-full" style={{ height: 320 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={incomeByCategory.rows}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={110}
                  stroke={t.surface}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ''} ${Math.round((percent ?? 0) * 100)}%`
                  }
                >
                  {incomeByCategory.rows.map((r, idx) => (
                    <Cell key={idx} fill={r.color} />
                  ))}
                </Pie>
                <RTooltip {...tooltipStyle} formatter={(v: any, n: any) => [fmtMoney(v), n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {!catLoading && incomeByCategory.rows.length === 0 && (
            <p className="mt-2 text-sm text-neutral-500">Nothing to show yet.</p>
          )}
        </div>
      </section>

      {/* Income vs Expenses over time */}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Income vs expenses</h2>
          <span className="text-xs text-neutral-500" title={EXCLUDED_TITLE}>{EXCLUDED_NOTE}</span>
        </div>
        <div className="w-full" style={{ height: 360 }}>
          <ResponsiveContainer>
            <BarChart data={incExpSeries.data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
              <XAxis dataKey="key" {...axisProps} />
              <YAxis tickFormatter={fmtMoneyShort} {...axisProps} />
              <RTooltip {...tooltipStyle} cursor={{ fill: t.cursor }} formatter={(v:any, n:any) => [fmtMoney(v), n]} labelFormatter={(l:any)=> l} />
              <RLegend wrapperStyle={{ color: t.text }} />
              <Bar dataKey="Income" fill={t.positive} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expense" fill={t.negative} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Net worth over time (Lines) */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Value over time</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-2 flex select-none items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showIndividualAccounts}
                onChange={e => setShowIndividualAccounts(e.target.checked)}
              />
              Show individual accounts
            </label>
            <select
              className="input w-auto"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              aria-label="Grouping"
              title="Grouping"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <select
              className="input w-auto"
              value={range}
              onChange={(e) => setRange(e.target.value as Range)}
              aria-label="Range"
              title="Range"
            >
              <option value="6m">Last 6m</option>
              <option value="12m">Last 12m</option>
              <option value="24m">Last 24m</option>
              <option value="36m">Last 36m</option>
              <option value="ytd">YTD</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        <div className="mt-3 w-full" style={{ height: 360 }}>
          <ResponsiveContainer>
            {showIndividualAccounts ? (
              <LineChart data={series.data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                <XAxis dataKey="key" {...axisProps} />
                <YAxis tickFormatter={fmtMoneyShort} {...axisProps} />
                <RTooltip
                  {...tooltipStyle}
                  cursor={{ stroke: t.axis }}
                  formatter={(v:any, n:any) => [fmtMoney(v), legendName(n, accounts)]}
                  labelFormatter={(l:any)=> l}
                />
                <RLegend
                  wrapperStyle={{ color: t.text }}
                  onClick={(entry: any) => {
                    const key = entry?.dataKey as string | undefined;
                    if (!key || key === 'total') return;
                    if (key.startsWith('acc_')) {
                      const id = Number(key.slice(4));
                      if (Number.isFinite(id)) toggleAcc(id);
                    }
                  }}
                />
                {accountLines.map((l) => (
                  <Line
                    key={l.id}
                    type="monotone"
                    dataKey={l.key}
                    name={l.name}
                    stroke={l.color}
                    strokeWidth={1.8}
                    dot={false}
                    hide={isAccHidden(l.id)}
                  />
                ))}
                {series.data.length > 20 && <Brush dataKey="key" height={20} stroke={t.axis} fill={t.surface} />}
              </LineChart>
            ) : (
              <AreaChart data={series.data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={t.accent} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={t.accent} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                <XAxis dataKey="key" {...axisProps} />
                <YAxis tickFormatter={fmtMoneyShort} {...axisProps} />
                <RTooltip
                  {...tooltipStyle}
                  cursor={{ stroke: t.axis }}
                  formatter={(v:any, n:any) => [fmtMoney(v), legendName(n, accounts)]}
                  labelFormatter={(l:any)=> l}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Total net worth"
                  stroke={t.accent}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorTotal)"
                />
                {series.data.length > 20 && <Brush dataKey="key" height={20} stroke={t.axis} fill={t.surface} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </section>
    </PageContainer>
  );
}

/* ========== helpers ========== */
function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(s: string) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, (m||1)-1, d||1);
}
function enumerateGroups(from: Date, to: Date, groupBy: 'monthly'|'yearly') {
  const out: string[] = [];
  if (groupBy === 'yearly') {
    let y = from.getFullYear();
    const yEnd = to.getFullYear();
    for (; y <= yEnd; y++) out.push(String(y));
  } else {
    let cur = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cur <= end) {
      out.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`);
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    }
  }
  return out;
}
// pretty money formatters (for tooltips/axis) — same de-DE / EUR convention as <Amount>
function fmtMoney(v: number) {
  return formatMoneyDE(v ?? 0, { maximumFractionDigits: 0 });
}
function fmtMoneyShort(v: number) {
  const n = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (n >= 1_000_000) return `${sign}${(n/1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000) return `${sign}${(n/1_000).toFixed(1).replace('.', ',')} k`;
  return `${sign}${Math.round(n)}`;
}
function legendName(key: string, accounts: Account[]) {
  if (key === 'total') return 'Total';
  if (key?.startsWith('acc_')) {
    const id = Number(key.slice(4));
    const a = accounts.find(x => x.id === id);
    return a?.name ?? key;
  }
  return key;
}
