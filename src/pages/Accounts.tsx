import { useEffect, useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutOutletContext } from '../components/Layout';
import type { Account, NewAccount } from '../types';
import { listAccounts, addAccount, updateAccount, deleteAccount } from '../lib/api';
import AccountCard from '../components/AccountCard';
import CreateAccountDialog from '../components/CreateAccountDialog';
import ConfirmDialog from '../components/ConfirmDialog';

function PlusIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor">
      <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconArrowUp() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M12 5l-7 7h14L12 5z" strokeWidth="1.8" />
    </svg>
  );
}
function IconArrowDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M12 19l7-7H5l7 7z" strokeWidth="1.8" />
    </svg>
  );
}

export default function Accounts() {
  const { hidden } = useOutletContext<LayoutOutletContext>();
  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // dialogs
  const [openCreate, setOpenCreate] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  // sorting
  const [sortBy, setSortBy] = useState<'name' | 'balance' | 'type'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  async function refresh() {
    setLoading(true);
    try {
      setItems(await listAccounts());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (sortBy) {
        case 'balance':
          va = a.balance;
          vb = b.balance;
          break;
        case 'type':
          va = a.type;
          vb = b.type;
          break;
        default:
          va = a.name.toLowerCase();
          vb = b.name.toLowerCase();
      }
      let cmp = 0;
      if (va < vb) cmp = -1;
      else if (va > vb) cmp = 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [items, sortBy, sortDir]);

  const handleCreate = async (input: NewAccount) => {
    await addAccount(input);
    setOpenCreate(false);
    await refresh();
  };

  const handleUpdate = async (id: number, patch: { name?: string; color?: string | null }) => {
    await updateAccount({ id, ...patch });
    await refresh();
  };

  const requestDelete = (id: number) => setConfirmId(id);
  const confirmDelete = async () => {
    if (confirmId == null) return;
    await deleteAccount(confirmId);
    setConfirmId(null);
    await refresh();
  };

  return (
    <div className="relative mx-auto max-w-[1580px] p-4">
      {/* Toolbar: count + sorting */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-neutral-500">{items.length} accounts</div>
        <div className="flex items-center gap-2">
          <label className="label">Sort by</label>
          <select
            className="input"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'balance' | 'type')}
          >
            <option value="name">Name</option>
            <option value="balance">Balance</option>
            <option value="type">Type</option>
          </select>
          <button
            type="button"
            className="icon-btn"
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            aria-label="Toggle sort direction"
          >
            {sortDir === 'asc' ? <IconArrowUp /> : <IconArrowDown />}
          </button>
        </div>
      </div>

      {/* Grid of account cards (matches your Figma) */}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {sortedItems.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            hidden={hidden}
            onSave={(patch) => handleUpdate(a.id, patch)}
            onDelete={() => requestDelete(a.id)} // opens pretty confirm dialog
          />
        ))}
      </div>

      {loading && <div className="mt-4 text-xs text-neutral-500">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="mt-6 text-sm text-neutral-500">No accounts yet.</div>
      )}

      {/* Floating "Create new account" button — bottom-right (Figma style) */}
      <button
        type="button"
        onClick={() => setOpenCreate(true)}
        className="fixed bottom-6 right-6 btn btn-primary flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg"
        aria-label="Create new account"
      >
        <PlusIcon className="h-5 w-5" />
        <span className="hidden sm:inline">Create new account</span>
      </button>

      {/* Create dialog (supports type + initial balance) */}
      <CreateAccountDialog open={openCreate} onClose={() => setOpenCreate(false)} onCreate={handleCreate} />

      {/* Delete confirm dialog (styled, respects Cancel) */}
      <ConfirmDialog
        open={confirmId !== null}
        title="Delete account?"
        description="You can delete an account only if it has no transactions."
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onCancel={() => setConfirmId(null)}
        onConfirm={async () => {
          if (confirmId == null) return;
          try {
            await deleteAccount(confirmId);      // will throw if transactions exist
            setConfirmId(null);
            await refresh();
          } catch (e: any) {
            setConfirmId(null);
            const msg =
              typeof e === 'string' ? e :
              e?.message ?? 'Unable to delete this account because it still has transactions.';
            setErrorMsg(msg);
          }
        }}
      />

      <ConfirmDialog
        open={errorMsg !== null}
        title="Cannot delete account"
        description={errorMsg ?? ''}
        confirmText="OK"
        onCancel={() => setErrorMsg(null)}
        onConfirm={() => setErrorMsg(null)}
      />
    </div>
  );
}
