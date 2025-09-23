import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutOutletContext } from '../components/Layout';
import type { Account, NewAccount } from '../types';
import { listAccounts, addAccount, updateAccount, deleteAccount } from '../lib/api';
import AccountCard from '../components/AccountCard';
import CreateAccountDialog from '../components/CreateAccountDialog';

function PlusIcon({ className='' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor">
      <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

export default function Accounts() {
  const { hidden } = useOutletContext<LayoutOutletContext>();
  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setItems(await listAccounts()); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const handleCreate = async (input: NewAccount) => { await addAccount(input); await refresh(); };
  const handleUpdate = async (id: number, patch: { name?: string; color?: string | null }) => {
    await updateAccount({ id, ...patch }); await refresh();
  };
  const handleDelete = async (id: number) => {
    if (!confirm('Delete this account and all its transactions?')) return;
    await deleteAccount(id); await refresh();
  };

  return (
    <div className="relative mx-auto max-w-6xl p-4">
      {/* Grid of account cards (no inline create form) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(a => (
          <AccountCard
            key={a.id}
            account={a}
            hidden={hidden}
            onSave={(patch) => handleUpdate(a.id, patch)}
            onDelete={() => handleDelete(a.id)}
          />
        ))}
      </div>

      {loading && <div className="mt-4 text-xs text-neutral-500">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="mt-6 text-sm text-neutral-500">No accounts yet.</div>
      )}

      {/* Floating "Create new account" button — bottom-right corner (like your Figma) */}
      <button
        type="button"
        onClick={() => setOpenCreate(true)}
        className="fixed bottom-6 right-6 btn btn-primary flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg"
        aria-label="Create new account"
      >
        <PlusIcon className="h-5 w-5" />
        <span className="hidden sm:inline">Create new account</span>
      </button>

      {/* Dialog */}
      <CreateAccountDialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
