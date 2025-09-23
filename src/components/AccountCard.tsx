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
      await onSave({ name: n, color });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      {/* Header row: color dot + name (+ reimbursable icon), actions on the right */}
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
            <div className="flex items-center gap-1 min-w-0">
              <div className="font-medium truncate">{account.name}</div>
              {account.type === 'reimbursable' && (
                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      title="Reimbursable account" aria-label="Reimbursable">
                  <IconRefresh className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
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
              <IconButton label="Save" onClick={commit} disabled={busy}>
                <IconCheck />
              </IconButton>
              <IconButton
                label="Cancel"
                onClick={() => {
                  setEditing(false);
                  setName(account.name);
                  setColor(account.color ?? '#9ca3af');
                }}
              >
                <IconX />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton label="Edit" onClick={() => setEditing(true)}>
                <IconPencil />
              </IconButton>
              <IconButton label="Delete" onClick={() => onDelete()}>
                <IconTrash />
              </IconButton>
            </>
          )}
        </div>
      </div>

      {/* Balance big under header; color by sign */}
      <div className="mt-4 text-2xl font-semibold">
        <Amount value={account.balance} hidden={hidden} colorBySign />
      </div>
    </div>
  );
}

/* ---------- tiny icon-button helper ---------- */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/* ---------- inline icons ---------- */
function IconPencil() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M12 20h9" strokeWidth="1.8" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" strokeWidth="1.8" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M3 6h18" strokeWidth="1.8" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeWidth="1.8" />
      <path d="M10 11v6M14 11v6" strokeWidth="1.8" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" strokeWidth="1.8" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M20 6 9 17l-5-5" strokeWidth="1.8" />
    </svg>
  );
}
function IconX() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M18 6 6 18M6 6l12 12" strokeWidth="1.8" />
    </svg>
  );
}
function IconRefresh({ className='' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeWidth="1.8" />
      <path d="M20 4v6h-6" strokeWidth="1.8" />
    </svg>
  );
}
