// Aggregates for the POSITION block and the Stats tab, all derived from the
// in-memory transaction list. Windows (confirmed in the handoff's open
// questions): net worth = monthly closing balance, flows = monthly sums
// excluding transfers, category spend = trailing 90 days, savings rate =
// (income - expenses) / income.
import type { Account, Transaction } from '../types';
import { toISODate } from './format';
import { t as translate } from './i18n';

/** Bookkeeping categories that are not spending or income. Same set the old Stats page used. */
export const EXCLUDED_CATEGORIES = new Set(['transfer', 'transfers', 'init', 'korrektur']);

export function isFlow(tx: Pick<Transaction, 'transfer_id' | 'category'>): boolean {
  if (tx.transfer_id != null) return false;
  return !EXCLUDED_CATEGORIES.has((tx.category ?? '').toLowerCase());
}

export const monthKey = (iso: string) => iso.slice(0, 7);

/** The last `n` month keys ('YYYY-MM'), oldest first, ending with the current month. */
export function lastMonthKeys(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function monthEndISO(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return toISODate(new Date(y, m, 0));
}

/** Total closing balance (sum of every account) at the end of each month. */
export function netWorthSeries(txAll: Transaction[], months: string[]): number[] {
  return runningSeries(txAll, months, () => true);
}

/** Closing balance of one account at the end of each month. */
export function accountSeries(txAll: Transaction[], accountId: number, months: string[]): number[] {
  return runningSeries(txAll, months, (t) => t.account_id === accountId);
}

function runningSeries(txAll: Transaction[], months: string[], pick: (t: Transaction) => boolean): number[] {
  if (months.length === 0) return [];
  const sorted = txAll.filter(pick).map((t) => ({ d: t.date, a: t.amount })).sort((a, b) => a.d.localeCompare(b.d));
  const out: number[] = [];
  let run = 0;
  let i = 0;
  for (const key of months) {
    const end = monthEndISO(key);
    while (i < sorted.length && sorted[i].d <= end) {
      run += sorted[i].a;
      i++;
    }
    out.push(run);
  }
  return out;
}

export type MonthFlow = { key: string; income: number; expense: number };

/** Income and expense per month (transfers and bookkeeping categories excluded). expense is positive. */
export function flowSeries(txAll: Transaction[], months: string[]): MonthFlow[] {
  const idx = new Map(months.map((k, i) => [k, i]));
  const rows: MonthFlow[] = months.map((key) => ({ key, income: 0, expense: 0 }));
  for (const t of txAll) {
    if (!isFlow(t)) continue;
    const i = idx.get(monthKey(t.date));
    if (i === undefined) continue;
    if (t.amount > 0) rows[i].income += t.amount;
    else if (t.amount < 0) rows[i].expense += -t.amount;
  }
  return rows;
}

/** (income - expense) / income in percent; null when there is no income. */
export function savingsRate(income: number, expense: number): number | null {
  if (income <= 0.005) return null;
  return ((income - expense) / income) * 100;
}

/** Net of this calendar month's flows. */
export function netThisMonth(txAll: Transaction[], now = new Date()): number {
  const key = lastMonthKeys(1, now)[0];
  let net = 0;
  for (const t of txAll) if (isFlow(t) && monthKey(t.date) === key) net += t.amount;
  return net;
}

export function sumsAllTime(txAll: Transaction[]): { income: number; expense: number; count: number } {
  let income = 0;
  let expense = 0;
  for (const t of txAll) {
    if (!isFlow(t)) continue;
    if (t.amount > 0) income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, count: txAll.length };
}

export type CategorySpend = { name: string; value: number; count: number; share: number };

/** Expenses by category since `sinceISO` (inclusive; null = all time), largest first. `value` is positive. */
export function categorySpend(txAll: Transaction[], sinceISO: string | null): CategorySpend[] {
  const sums = new Map<string, { value: number; count: number }>();
  for (const t of txAll) {
    if (!isFlow(t) || t.amount >= 0) continue;
    if (sinceISO && t.date < sinceISO) continue;
    const name = t.category || translate('stats.uncategorized');
    const cur = sums.get(name) ?? { value: 0, count: 0 };
    cur.value += -t.amount;
    cur.count += 1;
    sums.set(name, cur);
  }
  const rows = Array.from(sums, ([name, v]) => ({ name, value: v.value, count: v.count, share: 0 })).sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  for (const r of rows) r.share = total > 0 ? r.value / total : 0;
  return rows;
}

export function topExpenses(txAll: Transaction[], n = 5): Transaction[] {
  return txAll.filter((t) => isFlow(t) && t.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, n);
}

export type AllocationRow = { id: number; name: string; color: string; value: number; share: number; isPerson: boolean };

const FALLBACK = '#6b7280';

/** Positive balances (accounts, and people who owe you) as shares of the positive total. */
export function allocation(accounts: Account[]): AllocationRow[] {
  const rows = accounts
    .filter((a) => a.balance > 0.005)
    .map((a) => ({
      id: a.id,
      name: a.type === 'person' ? translate('stats.personOpen', { name: a.name }) : a.name,
      color: a.color || FALLBACK,
      value: a.balance,
      share: 0,
      isPerson: a.type === 'person',
    }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  for (const r of rows) r.share = total > 0 ? r.value / total : 0;
  return rows;
}

export function countByAccount(txAll: Transaction[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of txAll) m.set(t.account_id, (m.get(t.account_id) ?? 0) + 1);
  return m;
}

export type CategoryUse = { used: number; net: number };

/** Usage count and plain net per category name (case-insensitive key). */
export function categoryUsage(txAll: Transaction[]): Map<string, CategoryUse> {
  const m = new Map<string, CategoryUse>();
  for (const t of txAll) {
    const key = (t.category ?? '').toLowerCase();
    if (!key) continue;
    const cur = m.get(key) ?? { used: 0, net: 0 };
    cur.used += 1;
    cur.net += t.amount;
    m.set(key, cur);
  }
  return m;
}

/** Percent change from first to last point; null when the first point is ~0. */
export function pctChange(series: number[]): number | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (Math.abs(first) < 0.005) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

export function daysAgoISO(days: number, now = new Date()): string {
  return toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}
