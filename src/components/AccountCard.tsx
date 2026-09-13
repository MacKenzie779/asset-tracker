import { useEffect, useState } from 'react';
import Amount from './Amount';
import IconButton from './IconButton';
import PersonBalance from './PersonBalance';
import { IconCheck, IconPencil, IconTrash, IconUser, IconX } from './icons';
import type { Account } from '../types';

const DEFAULT_COLOR = '#9ca3af';

export default function AccountCard({
  account,
  hidden,
  onSave,
  onDelete,
}: {
  account: Account;
  hidden: boolean;
  /** Should throw on failure; the page reports the error. */
  onSave: (patch: { name?: string; color?: string | null }) => Promise<void>;
  onDelete: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [color, setColor] = useState<string>(account.color ?? DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);
  const isPerson = account.type === 'person';

  // Pick up fresh values after a refresh while not editing.
  useEffect(() => {
    if (editing) return;
    setName(account.name);
    setColor(account.color ?? DEFAULT_COLOR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.name, account.color]);

  const cancel = () => {
    setEditing(false);
    setName(account.name);
    setColor(account.color ?? DEFAULT_COLOR);
  };

  const commit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await onSave({ name: n, color });
      setEditing(false);
    } catch {
      // the page shows the error; stay in edit mode
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      {/* Header row: color dot + name (+ person badge), actions on the right */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-1 items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
          {editing ? (
            <input
              className="input h-9 w-full"
              value={name}
              aria-label={isPerson ? 'Person name' : 'Account name'}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-medium truncate">{account.name}</div>
              {isPerson && (
                <span
                  className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-sky-100 px-1.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                  title="Person: someone you settle up with"
                >
                  <IconUser className="h-3 w-3" />
                  Person
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <input
                type="color"
                title="Pick color"
                aria-label="Account color"
                className="h-8 w-8 rounded bg-transparent cursor-pointer"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <IconButton label="Save" onClick={() => void commit()} disabled={busy || !name.trim()}>
                <IconCheck />
              </IconButton>
              <IconButton label="Cancel" onClick={cancel} disabled={busy}>
                <IconX />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton label="Edit" onClick={() => setEditing(true)}>
                <IconPencil />
              </IconButton>
              <IconButton label="Delete" tone="danger" onClick={() => void onDelete()}>
                <IconTrash />
              </IconButton>
            </>
          )}
        </div>
      </div>

      {/* Balance */}
      <div className="mt-4">
        {isPerson ? (
          <PersonBalance balance={account.balance} hidden={hidden} size="lg" />
        ) : (
          <div className="text-2xl font-semibold">
            <Amount value={account.balance} hidden={hidden} colorBySign />
          </div>
        )}
      </div>
    </div>
  );
}
