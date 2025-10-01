import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  addTransaction,
  deleteTransaction,
  listAccounts,
  listTransactions,
  updateTransaction,
} from '../lib/api';
import type {
  Account,
  Transaction,
  NewTransaction,
  UpdateTransaction,
} from '../types';
import Amount from '../components/Amount';
import TransactionsTable from '../components/TransactionsTable';
import TransactionAddRow from '../components/TransactionAddRow';
import AccountsList from '../components/AccountsList';
import ConfirmDialog from '../components/ConfirmDialog';
import type { LayoutOutletContext } from '../components/Layout';

export default function Home() {
  const { hidden } = useOutletContext<LayoutOutletContext>();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tx, setTx] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // deletion modal state for transactions
  const [confirmTxId, setConfirmTxId] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [acc, t] = await Promise.all([listAccounts(), listTransactions(12)]);
      setAccounts(acc);
      // keep backend order (newest-first) here; the table will reverse once so newest is at the bottom
      setTx(t);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  const totalBalance = useMemo(() => {
    return accounts.reduce((sum, a) => {
      const v = Number.isFinite(a.balance) ? a.balance : 0;
      return sum + (a.type === 'reimbursable' ? -v : v);
    }, 0);
  }, [accounts]);


  // NEW: Sum of negative balances (as positive) for all reimbursable accounts.
  // Shows how much you're currently owed.
  const toBeReimbursed = useMemo(() => {
    return accounts
      .filter(a => a.type === 'reimbursable')
      .reduce((sum, a) => sum + (a.balance < 0 ? -a.balance : 0), 0);
  }, [accounts]);

  const handleAddTx = async (input: NewTransaction) => {
    await addTransaction(input);
    await refresh();
  };

  const requestDeleteTx = (id: number) => setConfirmTxId(id);
  const confirmDeleteTx = async () => {
    if (confirmTxId == null) return;
    await deleteTransaction(confirmTxId);
    setConfirmTxId(null);
    await refresh();
  };

  const handleUpdateTx = async (patch: UpdateTransaction) => {
    await updateTransaction(patch);
    await refresh();
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] px-6 py-4">
      {/* Top stats */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-5">
          <p className="text-xs text-neutral-500">Total value</p>
          <div className="mt-1 text-3xl md:text-4xl font-bold">
            <Amount value={totalBalance} hidden={hidden} />
          </div>
        </div>

        {/* REPLACED: Biggest Expense → To be reimbursed */}
        <div className="card p-5">
          <p className="text-xs text-neutral-500">To be reimbursed</p>
          <div className="mt-1 text-3xl md:text-4xl font-bold">
            <Amount value={toBeReimbursed} hidden={hidden} />
          </div>
        </div>
      </section>

      {/* Main area; you set this width already */}
      <section className="mt-6 grid items-start gap-6 grid-cols-1 
      lg:grid-cols-[minmax(640px,1fr)_minmax(300px,420px)]
      xl:grid-cols-[minmax(900px,1fr)_minmax(320px,480px)]
      2xl:grid-cols-[minmax(1200px,1fr)_minmax(60px,480px)]">
        {/* Left: transactions */}
        <div>
          <div className="card">
            <div className="p-3 border-b border-neutral-200/50 dark:border-neutral-800/50 flex items-center justify-between">
              <h2 className="text-base font-semibold">Last transactions</h2>
              {loading && <span className="text-xs text-neutral-500">Loading…</span>}
            </div>

            {/* Table (shows newest at the BOTTOM via internal reverse) */}
            <div className="overflow-auto">
              <TransactionsTable
                items={tx}
                accounts={accounts}
                hidden={hidden}
                onDelete={requestDeleteTx}    // open project dialog
                onUpdate={handleUpdateTx}
              />
            </div>

            {/* Add row at the bottom */}
            <div className="border-t border-neutral-200/50 dark:border-neutral-800/50">
              <TransactionAddRow accounts={accounts} onAdd={handleAddTx} />
            </div>
          </div>
        </div>

        {/* Right: accounts overview + Manage button */}
        <div>
          <div className="card">
            <div className="p-3 border-b border-neutral-200/50 dark:border-neutral-800/50">
              <h2 className="text-base font-semibold">Accounts overview</h2>
            </div>
            <AccountsList items={accounts} hidden={hidden} />
            <div className="p-3 border-t border-neutral-200/50 dark:border-neutral-800/50">
              <Link to="/accounts" className="btn btn-primary w-full">
                Manage accounts
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pretty confirm dialog for transaction delete */}
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
