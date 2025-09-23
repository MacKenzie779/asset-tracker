import { useEffect, useState } from 'react';
import type { NewAccount } from '../types';

export default function CreateAccountDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: NewAccount) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [accountType, setAccountType] = useState<'standard' | 'reimbursable'>('standard');
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setColor('#3b82f6');
      setAccountType('standard');
      setInitialBalance(0);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await onCreate({
        name: n,
        color,
        account_type: accountType,
        initial_balance: Number.isFinite(initialBalance) ? initialBalance : 0,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* dialog */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 shadow-xl">
          <div className="p-5 space-y-4">
            <h3 className="text-base font-semibold">Create new account</h3>

            <div className="grid grid-cols-12 gap-3">
              {/* Name */}
              <label className="col-span-12 flex flex-col gap-1">
                <span className="label">Name</span>
                <input
                  className="input"
                  placeholder="Account name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>

              {/* Color */}
              <div className="col-span-6 flex items-center gap-2">
                <span className="label">Color</span>
                <input
                  type="color"
                  className="h-9 w-14 rounded bg-transparent cursor-pointer"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  title="Account color"
                />
              </div>

              {/* Type */}
              <label className="col-span-6 flex flex-col gap-1">
                <span className="label">Type</span>
                <select
                  className="input"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as 'standard' | 'reimbursable')}
                >
                  <option value="standard">Standard</option>
                  <option value="reimbursable">Reimbursable</option>
                </select>
              </label>

              {/* Initial balance */}
              <label className="col-span-12 flex flex-col gap-1">
                <span className="label">Initial balance</span>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(parseFloat(e.target.value))}
                  placeholder="0.00"
                />
                <p className="text-xs text-neutral-500">
                  This will create an initial transaction. Positive values credit the account; negative values debit it.
                </p>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
