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
  LineChart, Line, XAxis, YAxis, CartesianGrid, Brush,
} from 'recharts';

export default function Stats() {
  const { hidden } = useOutletContext<LayoutOutletContext>();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txAll, setTxAll] = useState<TxMini[]>([]);
  const [loading, setLoading] = useState(true);
  type TxForCat = { amount: number; category?: string | null };
  const [txCatItems, setTxCatItems] = useState<TxForCat[]>([]);

  // controls
  const [groupBy, setGroupBy] = useState<'monthly' | 'yearly'>('monthly');
  const [range, setRange] = useState<'12m' | '24m' | 'all'>('12m');

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
      const all: TxForCat[] = [];
      while (true) {
        const res = await searchTransactions({
          tx_type: 'expense', // only expenses
          limit: pageSize,
          offset,
          sort_by: 'id',
          sort_dir: 'asc',
        });
        const items = (res.items ?? []) as any[];
        all.push(...items.map(it => ({ amount: it.amount, category: it.category })));
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
      range === 'all'
        ? allKeys
        : (() => {
            const n = range === '12m' ? 12 : 24;
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

  // ==== NEW: Expenses by category (Transfer, Init excluded) ====
const expensesByCategory = useMemo(() => {
  const sums = new Map<string, number>();
  for (const t of txCatItems) {
    const name = (t.category ?? 'Uncategorized').toString();
    const lc = name.toLowerCase();
    if (lc === 'transfer' || lc === 'transfers' || lc === 'init') continue; // special buckets out
    const v = Math.abs(t.amount ?? 0);
    if (v > 0) sums.set(name, (sums.get(name) ?? 0) + v);
  }
  const rows = Array.from(sums.entries())
    .map(([name, value], i) => ({ name, value, color: fallbackColors[i % fallbackColors.length] }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return { rows, total };
}, [txCatItems]);

  /* =========================
         UI
     ========================= */
  return (
    <div className="mx-auto w-full max-w={[1680]}px px-6 py-4 grid gap-6">
      {/* Top cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
      </section>

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
                  <Cell key={r.id} fill={r.color} />
                ))}
              </Pie>

              <RTooltip formatter={(v: any, n: any) => [fmtMoney(v), n]} />
              <RLegend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {pieData.rows.length === 0 && (
          <p className="text-sm text-neutral-500 mt-2">Nothing to show yet.</p>
        )}
      </section>

      {/* ==== NEW: Expenses by category (Pie) ==== */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Expenses by category</h2>
          <span className="text-xs text-neutral-500">Transfers excluded</span>
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
              <RLegend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {expensesByCategory.rows.length === 0 && (
          <p className="text-sm text-neutral-500 mt-2">Nothing to show yet.</p>
        )}
      </section>

      {/* Net worth over time (Lines) */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Value over time</h2>
          <div className="flex gap-2">
            <select
              className="input h-9"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as any)}
              title="Grouping"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <select
              className="input h-9"
              value={range}
              onChange={(e) => setRange(e.target.value as any)}
              title="Range"
            >
              <option value="12m">Last 12</option>
              <option value="24m">Last 24</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        <div className="mt-3 w-full" style={{ height: 360 }}>
          <ResponsiveContainer>
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
                  // Expect dataKey of form 'acc_<id>' or 'total'
                  const key = entry?.dataKey as string | undefined;
                  if (!key) return;
                  if (key === 'total') return; // keep Total always visible (optional)
                  if (key.startsWith('acc_')) {
                    const id = Number(key.slice(4));
                    if (Number.isFinite(id)) toggleAcc(id);
                  }
                }}
              />
              {/* Total line */}
              <Line type="monotone" dataKey="total" name="Total" stroke="#111827" strokeWidth={2} dot={false} />
              {/* Per-account lines */}
              {accountLines.map((l) => (
                <Line
                  key={l.id}
                  type="monotone"
                  dataKey={l.key}
                  name={l.name}
                  stroke={l.color}
                  strokeWidth={1.8}
                  dot={false}
                  hide={isAccHidden(l.id)}   // <-- toggle visibility
                />
              ))}

              {series.data.length > 20 && <Brush dataKey="key" height={20} />}
            </LineChart>
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
