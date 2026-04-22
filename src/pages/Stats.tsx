import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  listAccounts,
  listTransactionsAll,
  searchTransactions,
} from '../lib/api';
import type { Account } from '../types';
import type { TxMini } from '../lib/api';
import Amount from '../components/Amount';
import type { LayoutOutletContext } from '../components/Layout';

// Recharts
import {
  ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip as RTooltip, Legend as RLegend,
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Brush,
} from 'recharts';

export default function Stats() {
  const { hidden } = useOutletContext<LayoutOutletContext>();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txAll, setTxAll] = useState<TxMini[]>([]);
  const [loading, setLoading] = useState(true);
  type TxExt = { id: number; date: string; amount: number; category?: string | null; description?: string | null };
  const [txCatItems, setTxCatItems] = useState<TxExt[]>([]);

  // controls
  const [groupBy, setGroupBy] = useState<'monthly' | 'yearly'>('monthly');
  const [range, setRange] = useState<'6m' | '12m' | '24m' | '36m' | 'ytd' | 'all'>('12m');
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
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
  (async () => {
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
          description: it.description 
        })));
        const total: number = (res as any).total ?? items.length;
        offset += pageSize;
        if (offset >= total) break;
      }
      setTxCatItems(all);
    } catch (e) {
      console.error('fetch categories failed', e);
      setTxCatItems([]);
    }
  })();
}, []);

  /* =========================
     Derived values / helpers
     ========================= */

  // consistent color (prefer account.color)
  const fallbackColors = ['#2563eb','#16a34a','#ea580c','#db2777','#0891b2','#ca8a04','#7c3aed','#ef4444'];
  const colorFor = (idx: number, hex?: string | null) => hex || fallbackColors[idx % fallbackColors.length];

  // Net worth pie (reimbursables inverted)
  const pieData = useMemo(() => {
    const rows = accounts.map((a, i) => {
      const adj = a.type === 'reimbursable' ? - (a.balance ?? 0) : (a.balance ?? 0);
      return { id: a.id, name: a.name, value: adj, color: colorFor(i, a.color) };
    }).filter(r => r.value > 0.000001); // pie can't show negatives; we skip <=0 slices
    const total = rows.reduce((s,r)=>s+r.value,0);
    return { rows, total };
  }, [accounts]);

  // To be reimbursed (sum of negative balances on reimb accounts, shown positive)
  const toBeReimbursed = useMemo(() => {
    return accounts
      .filter(a => a.type === 'reimbursable')
      .reduce((sum, a) => sum + (a.balance < 0 ? -a.balance : 0), 0);
  }, [accounts]);

  // Monthly net for current month (backend sums exclude transfers if you applied the earlier tweak)
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

  // --- Build time series (monthly/yearly) for:
  // total net worth (reimb inverted) and each account (also inverted for consistency)
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
    for (const t of txAll) {
      const d = parseISO(t.date);
      const k = groupKey(d);
      (buckets[k] ||= []).push(t);
    }
    // ensure buckets are date asc (they already are in txAll asc, but safe)
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a,b) => a.date.localeCompare(b.date));
    }

    // accumulate through groups
    const rows: any[] = [];
    let seenKeys: string[] = [];

    for (const key of allKeys) {
      const txs = buckets[key] || [];
      // apply all tx in this group
      for (const t of txs) {
        run[t.account_id] = (run[t.account_id] || 0) + t.amount;
      }

      // snapshot at group end
      const point: any = { key };

      // per-account (reimb inverted)
      for (const a of accounts) {
        const bal = run[a.id] || 0;
        point[`acc_${a.id}`] = a.type === 'reimbursable' ? -bal : bal;
      }
      // total net worth (sum of adjusted balances)
      point.total = accounts.reduce((s, a) => {
        const bal = run[a.id] || 0;
        return s + (a.type === 'reimbursable' ? -bal : bal);
      }, 0);

      rows.push(point);
      seenKeys.push(key);
    }

    // reduce to chosen range
    const byKey = new Map(rows.map(r => [r.key, r]));
    const filtered = cutoffKeys.map(k => byKey.get(k)!).filter(Boolean);

    return { keys: cutoffKeys, data: filtered };
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

  const totalBalance = useMemo(() => {
    return accounts.reduce((sum, a) => {
      const v = Number.isFinite(a.balance) ? a.balance : 0;
      return sum + (a.type === 'reimbursable' ? -v : v);
    }, 0);
  }, [accounts]);

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
  const excludedCategories = useMemo(() => new Set(['transfer', 'transfers', 'init', 'korrektur']), []);

  const expensesByCategory = useMemo(() => {
    const sums = new Map<string, number>();
    for (const t of txCatItems) {
      if (t.amount >= 0) continue; // Only expenses
      const name = (t.category ?? 'Uncategorized').toString();
      const lc = name.toLowerCase();
      if (excludedCategories.has(lc)) continue;
      const v = Math.abs(t.amount);
      if (v > 0) sums.set(name, (sums.get(name) ?? 0) + v);
    }
    const rows = Array.from(sums.entries())
      .map(([name, value], i) => ({ name, value, color: fallbackColors[i % fallbackColors.length] }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { rows, total };
  }, [txCatItems, excludedCategories, fallbackColors]);

  const incomeByCategory = useMemo(() => {
    const sums = new Map<string, number>();
    for (const t of txCatItems) {
      if (t.amount <= 0) continue; // Only income
      const name = (t.category ?? 'Uncategorized').toString();
      const lc = name.toLowerCase();
      if (excludedCategories.has(lc)) continue;
      const v = t.amount;
      if (v > 0) sums.set(name, (sums.get(name) ?? 0) + v);
    }
    const rows = Array.from(sums.entries())
      .map(([name, value], i) => ({ name, value, color: fallbackColors[i % fallbackColors.length] }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { rows, total };
  }, [txCatItems, excludedCategories, fallbackColors]);

  // Savings rate
  const totalIncome = incomeByCategory.total;
  const totalExpense = expensesByCategory.total;
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

  // Top 5 Expenses
  const topExpenses = useMemo(() => {
    return [...txCatItems]
      .filter(t => t.amount < 0 && !excludedCategories.has((t.category ?? '').toLowerCase()))
      .sort((a, b) => a.amount - b.amount) // smaller negative value means larger expense
      .slice(0, 5);
  }, [txCatItems, excludedCategories]);

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

    for (const t of txCatItems) {
      const k = groupKey(parseISO(t.date));
      if (!buckets[k]) continue;

      const lc = (t.category ?? 'Uncategorized').toString().toLowerCase();
      if (excludedCategories.has(lc)) continue;

      if (t.amount > 0) buckets[k].income += t.amount;
      else if (t.amount < 0) buckets[k].expense += Math.abs(t.amount);
    }

    return {
      keys: cutoffKeys,
      data: cutoffKeys.map(key => ({
        key,
        Income: buckets[key].income,
        Expense: buckets[key].expense,
      }))
    };
  }, [txCatItems, groupBy, range, excludedCategories]);

  /* =========================
         UI
     ========================= */
  return (
    <div className="mx-auto w-full max-w={[1680]}px px-6 py-4 grid gap-6">
      {/* Top cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card p-5">
          <p className="text-xs text-neutral-500">Total value</p>
          <div className="mt-1 text-3xl md:text-4xl font-bold">
            <Amount value={totalBalance} hidden={hidden} />
          </div>
          <p className="text-xs text-neutral-500 mt-1">Reimbursables counted as receivables</p>
        </div>

        <div className="card p-5">
          <p className="text-xs text-neutral-500">To be reimbursed</p>
          <div className="mt-1 text-3xl md:text-4xl font-bold">
            <Amount value={toBeReimbursed} hidden={hidden} />
          </div>
        </div>

        <div className="card p-5">
          <p className="text-xs text-neutral-500">Net this month</p>
          <div className="mt-1 text-3xl md:text-4xl font-bold">
            <Amount value={monthNet} hidden={hidden} colorBySign />
          </div>
          <p className="text-xs text-neutral-500 mt-1">Transfers excluded</p>
        </div>

        <div className="card p-5">
          <p className="text-xs text-neutral-500">Avg Savings Rate</p>
          <div className="mt-1 text-3xl md:text-4xl font-bold text-green-600 dark:text-green-500">
            {hidden ? '***' : `${savingsRate.toFixed(1)}%`}
          </div>
          <p className="text-xs text-neutral-500 mt-1">Overall (Income vs Expenses)</p>
        </div>
      </section>

      {/* Top Expenses */}
      {topExpenses.length > 0 && (
        <section className="card p-5">
          <h2 className="text-base font-semibold mb-3">Top Expenses (All time)</h2>
          <div className="grid gap-2">
            {topExpenses.map((t, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm border-b border-neutral-200 dark:border-neutral-800 pb-2 last:border-0 last:pb-0">
                <div>
                  <span className="font-medium">{t.date}</span>
                  <span className="text-neutral-500 ml-2">{t.category ?? 'Uncategorized'}</span>
                  {t.description && <div className="text-xs text-neutral-400 mt-0.5">{t.description}</div>}
                </div>
                <div className="font-semibold text-red-600 dark:text-red-500">
                  <Amount value={t.amount} hidden={hidden} />
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
          label={({ name, percent }: { name?: string; percent?: number }) =>
            `${name ?? ''} ${Math.round((percent ?? 0) * 100)}%`
          }
        >
          {pieRowsVisible.map((r) => (
            <Cell
              key={r.id}
              fill={r.color}
              cursor="pointer"
              onClick={() => toggleAcc(r.id)} // <-- toggle by clicking a slice
            />
          ))}
        </Pie>

        <RTooltip formatter={(v: any, n: any) => [fmtMoney(v), n]} />
        {/* Remove the default Legend to avoid confusion; we render our own clickable chips below */}
      </PieChart>
    </ResponsiveContainer>
  </div>

  {/* Clickable legend chips (independent toggles for the pie) */}
  <div className="mt-3 flex flex-wrap gap-2">
    {pieData.rows.map((r) => {
      const hidden = isAccHidden(r.id);
      return (
        <button
          key={r.id}
          onClick={() => toggleAcc(r.id)}
          className={[
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm transition",
            hidden
              ? "opacity-50 ring-1 ring-neutral-400 hover:opacity-70"
              : "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          ].join(' ')}
          title={hidden ? "Show account" : "Hide account"}
        >
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: r.color }}
          />
          <span className="whitespace-nowrap">{r.name}</span>
        </button>
      );
    })}
  </div>

  {/* Optional quick actions */}
  {pieData.rows.length > 0 && (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      <button
        className="btn-secondary px-2 py-1"
        onClick={() => {
          // show all: clear the hidden set
          setHiddenAcc(new Set());
        }}
      >
        Show all
      </button>
      <button
        className="btn-secondary px-2 py-1"
        onClick={() => {
          // hide all accounts that currently appear in the pie
          setHiddenAcc(new Set(pieData.rows.map(r => r.id)));
        }}
      >
        Hide all
      </button>
    </div>
  )}

  {pieData.rows.length === 0 && (
    <p className="text-sm text-neutral-500 mt-2">Nothing to show yet.</p>
  )}
</section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Expenses by category (Pie) */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Expenses by category</h2>
            <span className="text-xs text-neutral-500">Excluded cats hidden</span>
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
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ''} ${Math.round((percent ?? 0) * 100)}%`
                  }
                >
                  {expensesByCategory.rows.map((r, idx) => (
                    <Cell key={idx} fill={r.color} />
                  ))}
                </Pie>
                <RTooltip formatter={(v: any, n: any) => [fmtMoney(v), n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {expensesByCategory.rows.length === 0 && (
            <p className="text-sm text-neutral-500 mt-2">Nothing to show yet.</p>
          )}
        </div>

        {/* Income by category (Pie) */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Income by category</h2>
            <span className="text-xs text-neutral-500">Excluded cats hidden</span>
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
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ''} ${Math.round((percent ?? 0) * 100)}%`
                  }
                >
                  {incomeByCategory.rows.map((r, idx) => (
                    <Cell key={idx} fill={r.color} />
                  ))}
                </Pie>
                <RTooltip formatter={(v: any, n: any) => [fmtMoney(v), n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {incomeByCategory.rows.length === 0 && (
            <p className="text-sm text-neutral-500 mt-2">Nothing to show yet.</p>
          )}
        </div>
      </section>

      {/* Income vs Expenses over time */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-base font-semibold">Income vs Expenses</h2>
          <span className="text-xs text-neutral-500">Excluded cats hidden</span>
        </div>
        <div className="w-full" style={{ height: 360 }}>
          <ResponsiveContainer>
            <BarChart data={incExpSeries.data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="key" />
              <YAxis tickFormatter={fmtMoneyShort} />
              <RTooltip formatter={(v:any, n:any) => [fmtMoney(v), n]} labelFormatter={(l:any)=> l} />
              <RLegend />
              <Bar dataKey="Income" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expense" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Net worth over time (Lines) */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Value over time</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm select-none mr-2">
              <input 
                type="checkbox" 
                checked={showIndividualAccounts}
                onChange={e => setShowIndividualAccounts(e.target.checked)}
              />
              Show individual accounts
            </label>
            <select
              className="input"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as any)}
              title="Grouping"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <select
              className="input"
              value={range}
              onChange={(e) => setRange(e.target.value as any)}
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
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="key" />
                <YAxis tickFormatter={fmtMoneyShort} />
                <RTooltip
                  formatter={(v:any, n:any) => [fmtMoney(v), legendName(n, accounts)]}
                  labelFormatter={(l:any)=> l}
                />
                <RLegend
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
                {series.data.length > 20 && <Brush dataKey="key" height={20} />}
              </LineChart>
            ) : (
              <AreaChart data={series.data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#111827" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#111827" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="key" />
                <YAxis tickFormatter={fmtMoneyShort} />
                <RTooltip
                  formatter={(v:any, n:any) => [fmtMoney(v), legendName(n, accounts)]}
                  labelFormatter={(l:any)=> l}
                />
                <Area 
                  type="monotone" 
                  dataKey="total" 
                  name="Total Net Worth" 
                  stroke="#111827" 
                  fillOpacity={1} 
                  fill="url(#colorTotal)" 
                />
                {series.data.length > 20 && <Brush dataKey="key" height={20} />}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </section>
    </div>
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
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth()+1, 0);
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
// pretty money formatters (for tooltips/axis)
function fmtMoney(v: number) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v ?? 0);
  } catch { return String(Math.round(v ?? 0)); }
}
function fmtMoneyShort(v: number) {
  const n = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (n >= 1_000_000) return `${sign}${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${sign}${(n/1_000).toFixed(1)}k`;
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
