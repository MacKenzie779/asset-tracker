import { useState } from 'react';
import Amount from './Amount';
import type { Account } from '../types';

export default function AccountCard({
  account,
  hidden,
  onSave,
  onDelete,
}: {
  account: Account;
  hidden: boolean;
  onSave: (patch: { name?: string; color?: string | null }) => Promise<void>;
  onDelete: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [color, setColor] = useState<string>(account.color ?? '#9ca3af');
  const [busy, setBusy] = useState(false);

    const commit = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
        const res = await onSave({ name: n, color });
        // onSave may or may not return a value; success if it didn't throw
        setEditing(false);
    } catch (e: any) {
        console.error('update failed:', e);
        alert('Saving failed. Please try again.\n' + (e?.message ?? ''));
    } finally {
        setBusy(false);
    }
    };


  return (
    <div className="card p-4">
      {/* Header row: color dot + name, actions on the right */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          {editing ? (
            <input
              className="input h-9 w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => (e.key === 'Enter' ? void commit() : undefined)}
              autoFocus
            />
          ) : (
            <div className="font-medium truncate">{account.name}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <input
                type="color"
                title="Pick color"
                className="h-9 w-9 rounded bg-transparent cursor-pointer"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <button className="btn btn-primary" onClick={commit} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setEditing(false);
                  setName(account.name);
                  setColor(account.color ?? '#9ca3af');
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn" onClick={() => onDelete()}>Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Balance number big under the header (aligns with Figma emphasis) */}
      <div className="mt-4 text-2xl font-semibold">
        <Amount value={account.balance} hidden={hidden} />
      </div>
    </div>
  );
}
