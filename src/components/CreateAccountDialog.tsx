import { useEffect, useRef, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import type { NewAccount } from '../types';
import { formatDecimalDE, parseDecimal } from '../lib/number';
import Modal from './Modal';

export default function CreateAccountDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  /** Should throw on failure; the page reports the error. */
  onCreate: (input: NewAccount) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [accountType, setAccountType] = useState<'standard' | 'reimbursable'>('standard');

  // stored as a string so the user can type EU format like "1.234,56"
  const [initialBalanceStr, setInitialBalanceStr] = useState<string>('');
  const parsedInit = parseDecimal(initialBalanceStr); // number | null

  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setColor('#3b82f6');
      setAccountType('standard');
      setInitialBalanceStr('');
      setBusy(false);
    }
  }, [open]);

  const amountInvalid = initialBalanceStr.trim() !== '' && parsedInit === null;
  const canSubmit = !busy && !!name.trim() && !amountInvalid;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    const n = name.trim();
    // allow empty -> 0
    const value = initialBalanceStr.trim() === '' ? 0 : parsedInit;
    if (value === null) return; // invalid amount
    setBusy(true);
    try {
      await onCreate({
        name: n,
        color,
        account_type: accountType,
        initial_balance: value,
      });
      onClose();
    } catch {
      // the page shows the error; keep the form open with its values
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Create new account" size="lg" initialFocus={nameRef}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-12 gap-3">
          {/* Name */}
          <label className="col-span-12 flex flex-col gap-1">
            <span className="label">Name</span>
            <input
              ref={nameRef}
              className="input"
              placeholder="Account name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {/* Color */}
          <label className="col-span-6 flex items-center gap-2">
            <span className="label">Color</span>
            <input
              type="color"
              className="h-9 w-14 cursor-pointer rounded bg-transparent"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="Account color"
            />
          </label>

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

          {/* Initial balance — EU input */}
          <label className="col-span-12 flex flex-col gap-1">
            <span className="label">Initial balance</span>
            <input
              type="text"
              inputMode="decimal"
              className={clsx('input', amountInvalid && 'input-invalid')}
              placeholder="0,00"
              value={initialBalanceStr}
              onChange={(e) => setInitialBalanceStr(e.target.value)}
              onBlur={() => {
                if (parsedInit !== null) setInitialBalanceStr(formatDecimalDE(parsedInit, { grouping: true }));
              }}
              aria-invalid={amountInvalid || undefined}
              title={amountInvalid ? 'Enter an amount like 1.234,56' : undefined}
            />
            <p className="text-xs text-neutral-500">This will create an initial transaction</p>
            {amountInvalid && (
              <p className="text-xs text-rose-600 dark:text-rose-400">Wrong format. Example: 1.234,56</p>
            )}
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
