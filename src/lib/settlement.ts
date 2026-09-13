// Open items with a person, mirroring the backend's settlement statement
// (`compute_settlement_slice` + oldest-first matching with partials in
// src-tauri/src/main.rs) so the settle sheet and the exported statement agree.
import type { Transaction } from '../types';

export type OpenItem = {
  tx: Transaction;
  /** Still outstanding for this item, positive. */
  remaining: number;
  /** The item's full amount, positive. */
  original: number;
};

export type OpenItems = {
  /** true: they owe you (working sign flips so open items are negative). */
  theyOwe: boolean;
  items: OpenItem[];
  total: number;
};

const EPS = 1e-9;

export function computeOpenItems(personTx: Transaction[], balance: number): OpenItems {
  const oldestFirst = [...personTx].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const theyOwe = balance > -EPS;
  const signed = oldestFirst.map((t) => ({ tx: t, amount: theyOwe ? -t.amount : t.amount }));

  // Running balance to find the last moment nothing was open.
  let running = 0;
  let lastNonNeg = -1;
  let carry = 0;
  signed.forEach((s, i) => {
    running += s.amount;
    if (running >= 0) {
      lastNonNeg = i;
      carry = running;
    }
  });
  const slice = signed.slice(lastNonNeg + 1);

  const open: OpenItem[] = [];
  let pre = Math.max(carry, 0);
  for (const s of slice) {
    if (s.amount < 0) {
      let rem = Math.max(-s.amount, 0);
      if (pre > 0) {
        const apply = Math.min(pre, rem);
        rem -= apply;
        pre -= apply;
      }
      if (rem > EPS) open.push({ tx: s.tx, remaining: rem, original: Math.max(-s.amount, 0) });
    } else if (s.amount > 0) {
      let payoff = s.amount;
      while (payoff > EPS) {
        const front = open[0];
        if (front) {
          const apply = Math.min(payoff, front.remaining);
          front.remaining -= apply;
          payoff -= apply;
          if (front.remaining <= EPS) open.shift();
        } else {
          pre += payoff;
          break;
        }
      }
    }
  }
  const total = open.reduce((s, o) => s + o.remaining, 0);
  return { theyOwe, items: open, total };
}

/** Oldest items first until `target` is reached; the crossing item is included partially. */
export function selectByTarget(items: OpenItem[], target: number): Map<number, number> {
  const out = new Map<number, number>();
  let left = target;
  for (const o of items) {
    if (left <= EPS) break;
    const take = Math.min(o.remaining, left);
    out.set(o.tx.id, take);
    left -= take;
  }
  return out;
}
