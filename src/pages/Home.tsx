import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { addTransaction, listAccounts, listTransactions, deleteTransaction } from '../lib/api';
import type { Account, Transaction, NewTransaction } from '../types';
import Amount from '../components/Amount';
import TransactionsTable from '../components/TransactionsTable';
import TransactionAddRow from '../components/TransactionAddRow';
import AccountsList from '../components/AccountsList';
import type { LayoutOutletContext } from '../components/Layout';

export default function Home() {
  const { hidden } = useOutletContext<LayoutOutletContext>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tx, setTx] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [acc, t] = await Promise.all([
        listAccounts(),
        listTransactions(12),
      ]);
      setAccounts(acc);
      setTx(t);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  const totalBalance = useMemo(
    () => accounts.reduce((s, a) => s + (Number.isFinite(a.balance) ? a.balance : 0), 0),
    [accounts]
  );

  const handleAddTx = async (input: NewTransaction) => {
    await addTransaction(input);
    await refresh();
  };
  const handleDeleteTx = async (id: number) => {
    if (!confirm('Delete this transaction?')) return;
    await deleteTransaction(id);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      {/* Top stats strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Total balance</p>
          <div className="mt-1 text-2xl font-semibold">
            <Amount value={totalBalance} hidden={hidden} />
          </div>
        </div>
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Accounts</p>
          <div className="mt-1 text-2xl font-semibold">{accounts.length}</div>
        </div>
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Recent transactions</p>
          <div className="mt-1 text-2xl font-semibold">{tx.length}</div>
        </div>
      </section>

      {/* Main two-column: left (transactions + add), right (accounts) */}
      <section className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: 2 columns wide */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="p-3 border-b border-neutral-200/50 dark:border-neutral-800/50 flex items-center justify-between">
              <h2 className="text-base font-semibold">Transactions</h2>
              {loading && <span className="text-xs text-neutral-500">Loading…</span>}
            </div>
            {/* One-line add row */}
            <TransactionAddRow accounts={accounts} onAdd={handleAddTx} />
            {/* Table */}
            <div className="overflow-auto">
              <TransactionsTable items={tx} hidden={hidden} onDelete={handleDeleteTx} />
            </div>
          </div>
        </div>

        {/* Right: accounts list */}
        <div className="lg:col-span-1">
          <div className="card">
            <div className="p-3 border-b border-neutral-200/50 dark:border-neutral-800/50">
              <h2 className="text-base font-semibold">Accounts</h2>
            </div>
            <AccountsList items={accounts} hidden={hidden} />
          </div>
        </div>
      </section>
    </div>
  );
}
