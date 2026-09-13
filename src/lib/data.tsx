// One in-memory copy of the whole ledger (accounts, categories, every transaction).
// The blotter still pages server-side; everything derived (position numbers,
// share bars, usage counts, charts, open items) reads from here. A mutation
// anywhere calls `afterMutation()` and every consumer re-reads.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listAccounts, listCategories, searchTransactions } from './api';
import type { Account, Category, Transaction } from '../types';
import { errorMessage } from './errors';
import { emit } from './bus';
import { useBus } from '../hooks/useBus';

export type LedgerData = {
  accounts: Account[];
  categories: Category[];
  txAll: Transaction[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /* derived */
  accountById: Map<number, Account>;
  standardAccounts: Account[];
  people: Account[];
};

const Ctx = createContext<LedgerData | null>(null);

const PAGE = 1000;

async function fetchAllTransactions(): Promise<Transaction[]> {
  const all: Transaction[] = [];
  let offset = 0;
  for (;;) {
    const res = await searchTransactions({ tx_type: 'all', limit: PAGE, offset, sort_by: 'id', sort_dir: 'asc' });
    all.push(...res.items);
    offset += PAGE;
    if (offset >= res.total || res.items.length === 0) break;
  }
  return all;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txAll, setTxAll] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const [acc, cats, tx] = await Promise.all([listAccounts(), listCategories(), fetchAllTransactions()]);
      if (my !== seq.current) return;
      setAccounts(acc);
      setCategories(cats);
      setTxAll(tx);
      setError(null);
      setLoaded(true);
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useBus('data:changed', () => void refresh());

  const value = useMemo<LedgerData>(() => {
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    return {
      accounts,
      categories,
      txAll,
      loading,
      loaded,
      error,
      refresh,
      accountById,
      standardAccounts: accounts.filter((a) => a.type !== 'person'),
      people: accounts.filter((a) => a.type === 'person'),
    };
  }, [accounts, categories, txAll, loading, loaded, error, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): LedgerData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used inside <DataProvider>');
  return v;
}

/** Call after any write so the store and the blotter re-read. */
export function afterMutation() {
  emit('data:changed');
}
