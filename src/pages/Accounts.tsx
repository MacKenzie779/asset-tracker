import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutOutletContext } from '../components/Layout';
import type { Account, NewAccount } from '../types';
import { listAccounts, addAccount, updateAccount, deleteAccount } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useMutation } from '../hooks/useMutation';
import { useToast } from '../components/Toast';
import AccountCard from '../components/AccountCard';
import CreateAccountDialog from '../components/CreateAccountDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import IconButton from '../components/IconButton';
import PageContainer from '../components/PageContainer';
import Skeleton from '../components/Skeleton';
import { IconArrowDown, IconArrowUp, IconPlus, IconUser, IconWallet } from '../components/icons';

type SortBy = 'name' | 'balance';

export default function Accounts() {
  const { hidden } = useOutletContext<LayoutOutletContext>();
  const toast = useToast();
  const mutate = useMutation();

  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // dialogs
  const [openCreate, setOpenCreate] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // sorting
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listAccounts());
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

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'balance') cmp = a.balance - b.balance;
      else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [items, sortBy, sortDir]);

  const own = useMemo(() => sorted.filter((a) => a.type !== 'person'), [sorted]);
  const people = useMemo(() => sorted.filter((a) => a.type === 'person'), [sorted]);

  const handleCreate = async (input: NewAccount) => {
    await mutate(() => addAccount(input), {
      success: input.account_type === 'person' ? 'Person added' : 'Account created',
      error: 'Could not create account',
    });
    await refresh();
  };

  const handleUpdate = async (id: number, patch: { name?: string; color?: string | null }) => {
    await mutate(() => updateAccount({ id, ...patch }), {
      success: 'Account updated',
      error: 'Could not update account',
    });
    await refresh();
  };

  const confirmDelete = async () => {
    if (confirmId == null) return;
    const id = confirmId;
    setConfirmId(null);
    try {
      await deleteAccount(id); // rejected by the backend while transactions exist
      toast.success('Account deleted');
      await refresh();
    } catch (e) {
      setDeleteError(errorMessage(e, 'Unable to delete this account because it still has transactions.'));
    }
  };

  const firstLoad = loading && items.length === 0;
  const countLabel = firstLoad
    ? 'Loading…'
    : [
        `${own.length} account${own.length === 1 ? '' : 's'}`,
        people.length > 0 ? `${people.length} ${people.length === 1 ? 'person' : 'people'}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

  const renderGrid = (list: Account[]) => (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((a) => (
        <AccountCard
          key={a.id}
          account={a}
          hidden={hidden}
          onSave={(patch) => handleUpdate(a.id, patch)}
          onDelete={() => setConfirmId(a.id)}
        />
      ))}
    </div>
  );

  return (
    <PageContainer className="pb-24">
      {/* Toolbar: count + sorting */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-neutral-500">{countLabel}</div>
        <div className="flex items-center gap-2">
          <label htmlFor="accounts-sort" className="label">
            Sort by
          </label>
          <select
            id="accounts-sort"
            className="input w-auto"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="name">Name</option>
            <option value="balance">Balance</option>
          </select>
          <IconButton
            label={sortDir === 'asc' ? 'Ascending (switch to descending)' : 'Descending (switch to ascending)'}
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          >
            {sortDir === 'asc' ? <IconArrowUp /> : <IconArrowDown />}
          </IconButton>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <span>Could not load accounts: {error}</span>
          <button type="button" className="btn" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}

      {firstLoad ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-6 h-8 w-40" />
            </div>
          ))}
        </div>
      ) : items.length === 0 && !error ? (
        <div className="card">
          <EmptyState
            icon={IconWallet}
            title="No accounts yet"
            description="Create an account to start tracking your transactions."
            action={{ label: 'Create account', onClick: () => setOpenCreate(true) }}
          />
        </div>
      ) : (
        <div className="space-y-8">
          {own.length > 0 && (
            <section>
              {people.length > 0 && (
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  <IconWallet className="h-4 w-4" /> Your accounts
                </h2>
              )}
              {renderGrid(own)}
            </section>
          )}
          {people.length > 0 && (
            <section>
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                <IconUser className="h-4 w-4" /> People
              </h2>
              <p className="mb-3 text-xs text-neutral-500">
                People you settle up with. A positive balance means they owe you, a negative one that you owe them.
              </p>
              {renderGrid(people)}
            </section>
          )}
        </div>
      )}

      {/* Floating "Create" button */}
      <button
        type="button"
        onClick={() => setOpenCreate(true)}
        className="btn btn-primary fixed bottom-6 right-6 rounded-2xl px-4 py-3 shadow-lg"
        aria-label="Create account or add a person"
      >
        <IconPlus className="h-5 w-5" strokeWidth={2} />
        <span className="hidden sm:inline">New account or person</span>
      </button>

      <CreateAccountDialog open={openCreate} onClose={() => setOpenCreate(false)} onCreate={handleCreate} />

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete account?"
        description="You can delete an account only if it has no transactions."
        confirmText="Delete"
        variant="danger"
        onCancel={() => setConfirmId(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={deleteError !== null}
        variant="alert"
        title="Cannot delete account"
        description={deleteError ?? ''}
        onConfirm={() => setDeleteError(null)}
      />
    </PageContainer>
  );
}
