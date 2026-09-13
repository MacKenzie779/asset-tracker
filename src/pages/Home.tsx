import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { open as openWithSystem } from '@tauri-apps/plugin-shell';
import {
  addTransaction,
  addTransfer,
  deleteTransaction,
  listAccounts,
  listTransactions,
  updateTransaction,
} from '../lib/api';
import type { Account, Transaction, NewTransaction, NewTransfer, OpenDatabaseResult, UpdateTransaction } from '../types';
import { errorMessage } from '../lib/errors';
import { basename, dirname } from '../lib/path';
import { owedToYou, totalValue, youOwe } from '../lib/people';
import { useMutation } from '../hooks/useMutation';
import Amount from '../components/Amount';
import EmptyState from '../components/EmptyState';
import PageContainer from '../components/PageContainer';
import Skeleton from '../components/Skeleton';
import TransactionsTable from '../components/TransactionsTable';
import TransactionAddRow from '../components/TransactionAddRow';
import AccountsList from '../components/AccountsList';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { IconInbox } from '../components/icons';
import type { LayoutOutletContext } from '../components/Layout';

const RECENT_LIMIT = 12;
const UPGRADE_NOTICE_KEY = 'db_upgrade_notice';

export default function Home() {
  const { hidden } = useOutletContext<LayoutOutletContext>();
  const mutate = useMutation();
  const toast = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tx, setTx] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // deletion modal state for transactions
  const [confirmTxId, setConfirmTxId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, t] = await Promise.all([listAccounts(), listTransactions(RECENT_LIMIT)]);
      setAccounts(acc);
      // keep backend order (newest-first) here; the table reverses once so newest is at the bottom
      setTx(t);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // One-time notice after the database file was upgraded to a newer schema.
  const noticeShown = useRef(false);
  useEffect(() => {
    if (noticeShown.current) return;
    noticeShown.current = true;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(UPGRADE_NOTICE_KEY);
      sessionStorage.removeItem(UPGRADE_NOTICE_KEY);
    } catch {}
    if (!raw) return;
    try {
      const info = JSON.parse(raw) as OpenDatabaseResult;
      const backup = info.backup_path;
      toast.info('Your database was upgraded to the new format', {
        description: backup
          ? `Reimbursable accounts are now “people” with a natural sign. A copy of the old file was saved as ${basename(backup)}.`
          : 'Reimbursable accounts are now “people” with a natural sign.',
        duration: null,
        actions: backup
          ? [{ label: 'Show backup', onClick: () => openWithSystem(dirname(backup)).catch(() => {}) }]
          : undefined,
      });
    } catch {}
  }, [toast]);

  const total = useMemo(() => totalValue(accounts), [accounts]);
  const owed = useMemo(() => owedToYou(accounts), [accounts]);
  const owe = useMemo(() => youOwe(accounts), [accounts]);

  // The add row reports its own outcome (one toast per batch).
  const handleAddTx = async (input: NewTransaction) => {
    await addTransaction(input);
    await refresh();
  };
  const handleTransfer = async (input: NewTransfer) => {
    await addTransfer(input);
    await refresh();
  };

  const handleUpdateTx = async (patch: UpdateTransaction) => {
    await mutate(() => updateTransaction(patch), {
      success: 'Transaction updated',
      error: 'Could not update transaction',
    });
    await refresh();
  };

  const confirmDeleteTx = async () => {
    if (confirmTxId == null) return;
    const id = confirmTxId;
    const row = tx.find((t) => t.id === id);
    setConfirmTxId(null);
    try {
      await mutate(() => deleteTransaction(id), {
        success: row?.transfer_id != null ? 'Transfer deleted (both sides)' : 'Transaction deleted',
        error: 'Could not delete transaction',
      });
      await refresh();
    } catch {
      // reported by the toast
    }
  };

  const firstLoad = loading && accounts.length === 0 && tx.length === 0;
  const pendingRow = confirmTxId != null ? tx.find((t) => t.id === confirmTxId) : undefined;

  return (
    <PageContainer>
      {/* Top stats */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <KpiCard label="Total value" hint="All accounts and people, net" loading={firstLoad}>
          <Amount value={total} hidden={hidden} />
        </KpiCard>
        <KpiCard label="Owed to you" hint="What people still have to pay you" loading={firstLoad}>
          <Amount value={owed} hidden={hidden} colorBySign={false} className={owed > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''} />
        </KpiCard>
        <KpiCard label="You owe" hint="What you still have to pay people" loading={firstLoad}>
          <Amount value={owe} hidden={hidden} colorBySign={false} className={owe > 0 ? 'text-rose-600 dark:text-rose-400' : ''} />
        </KpiCard>
      </section>

      {error && (
        <div
          role="alert"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <span>Could not load your data: {error}</span>
          <button type="button" className="btn" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}

      {/* Main area: transactions + accounts rail (side by side from xl, stacked below) */}
      <section className="mt-6 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_clamp(240px,16vw,340px)] xl:gap-6 2xl:grid-cols-[minmax(0,1fr)_clamp(280px,18vw,380px)]">
        {/* Left: transactions */}
        <div className="min-w-0">
          <div className="card">
            <div className="flex items-center justify-between border-b border-neutral-200/50 p-3 dark:border-neutral-800/50">
              <h2 className="text-base font-semibold">Last transactions</h2>
              <div className="flex items-center gap-3 text-xs text-neutral-500">
                {loading && !firstLoad && <span>Refreshing…</span>}
                <Link to="/transactions" className="hover:underline">
                  View all
                </Link>
              </div>
            </div>

            {/* Only the table can scroll horizontally if it must */}
            <div className="overflow-x-auto">
              <TransactionsTable
                items={tx}
                accounts={accounts}
                hidden={hidden}
                onDelete={(id) => setConfirmTxId(id)}
                onUpdate={handleUpdateTx}
                newestLast
                loading={loading}
                emptyMessage={
                  <EmptyState
                    compact
                    icon={IconInbox}
                    title="No transactions yet"
                    description={
                      accounts.length === 0
                        ? 'Create an account first, then add your first transaction below.'
                        : 'Add your first transaction below.'
                    }
                  />
                }
              />
            </div>

            <div className="border-t border-neutral-200/50 dark:border-neutral-800/50">
              <TransactionAddRow accounts={accounts} onAdd={handleAddTx} onTransfer={handleTransfer} />
            </div>
          </div>
        </div>

        {/* Right: accounts overview + Manage button */}
        <div className="min-w-0">
          <div className="card">
            <div className="border-b border-neutral-200/50 p-3 dark:border-neutral-800/50">
              <h2 className="text-base font-semibold">Accounts overview</h2>
            </div>
            {firstLoad ? (
              <div className="space-y-3 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <AccountsList items={accounts} hidden={hidden} />
            )}
            <div className="border-t border-neutral-200/50 p-3 dark:border-neutral-800/50">
              <Link to="/accounts" className="btn btn-primary w-full">
                Manage accounts
              </Link>
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirmTxId !== null}
        title={pendingRow?.transfer_id != null ? 'Delete transfer?' : 'Delete transaction?'}
        description={
          pendingRow?.transfer_id != null
            ? 'Both sides of this transfer will be removed. This action cannot be undone.'
            : 'This action cannot be undone.'
        }
        confirmText="Delete"
        variant="danger"
        onCancel={() => setConfirmTxId(null)}
        onConfirm={confirmDeleteTx}
      />
    </PageContainer>
  );
}

function KpiCard({
  label,
  hint,
  loading,
  children,
}: {
  label: string;
  hint?: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs text-neutral-500">{label}</p>
      <div className="mt-1 text-3xl font-bold md:text-4xl">
        {loading ? <Skeleton className="mt-1 h-9 w-44" /> : children}
      </div>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}
