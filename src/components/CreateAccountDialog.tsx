import { useEffect, useRef, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import type { AccountType, NewAccount } from '../types';
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
  const [accountType, setAccountType] = useState<AccountType>('standard');

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

  const isPerson = accountType === 'person';
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
    <Modal open={open} onClose={close} title={isPerson ? 'Add a person' : 'Create new account'} size="lg" initialFocus={nameRef}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-12 gap-3">
          {/* Type */}
          <div className="col-span-12">
            <span className="label">Type</span>
            <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
              <TypeOption
                checked={!isPerson}
                onSelect={() => setAccountType('standard')}
                title="Account"
                description="Your own money: bank, cash, savings."
              />
              <TypeOption
                checked={isPerson}
                onSelect={() => setAccountType('person')}
                title="Person"
                description="Someone you settle up with: lent, borrowed, paid for each other."
              />
            </div>
          </div>

          {/* Name */}
          <label className="col-span-8 flex flex-col gap-1">
            <span className="label">Name</span>
            <input
              ref={nameRef}
              className="input"
              placeholder={isPerson ? 'e.g. Anna' : 'e.g. Checking account'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {/* Color */}
          <label className="col-span-4 flex flex-col gap-1">
            <span className="label">Color</span>
            <input
              type="color"
              className="h-[42px] w-full cursor-pointer rounded-xl border border-neutral-300 bg-transparent p-1 dark:border-neutral-700"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="Color"
            />
          </label>

          {/* Initial balance — EU input */}
          <label className="col-span-12 flex flex-col gap-1">
            <span className="label">{isPerson ? 'Current balance' : 'Initial balance'}</span>
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
            <p className="text-xs text-neutral-500">
              {isPerson
                ? 'Positive if they already owe you, negative if you owe them. Recorded as an initial entry.'
                : 'This will create an initial transaction.'}
            </p>
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
            {busy ? 'Creating…' : isPerson ? 'Add person' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TypeOption({
  checked,
  onSelect,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={clsx(
        'rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        checked
          ? 'border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
          : 'border-neutral-300/60 hover:bg-neutral-100 dark:border-neutral-700/60 dark:hover:bg-neutral-800'
      )}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{description}</div>
    </button>
  );
}
