import { useEffect, useState } from 'react';
import type { NewAccount } from '../types';

// --- same parser as in TransactionAddRow ---
function parseAmountString(s: string): number | null {
  if (s == null) return null;
  let t = s.trim().replace(/\s/g, '');
  if (t === '') return null;
  const hasC = t.includes(',');
  const hasD = t.includes('.');
  if (hasC && hasD) {
    const lastC = t.lastIndexOf(',');
    const lastD = t.lastIndexOf('.');
    t = lastC > lastD ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (hasC) {
    t = t.replace(',', '.');
  }
  if (/^[-+]?\d+[.]$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// de-DE pretty format without currency symbol
function formatDE(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

  // store as string so user can type EU format like "1.234,56"
  const [initialBalanceStr, setInitialBalanceStr] = useState<string>('');
  const parsedInit = parseAmountString(initialBalanceStr); // number | null

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setColor('#3b82f6');
      setAccountType('standard');
      setInitialBalanceStr('');
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
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
    } finally {
      setBusy(false);
    }
  };

  const amountInvalid = initialBalanceStr.trim() !== '' && parsedInit === null;

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

              {/* Initial balance — EU input */}
              <label className="col-span-12 flex flex-col gap-1">
                <span className="label">Initial balance</span>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  className={[
                    'input',
                    amountInvalid ? 'ring-1 ring-red-500/70 border-red-500/70 focus:ring-red-500/70 focus:border-red-500/70' : ''
                  ].join(' ')}
                  placeholder="0,00"
                  value={initialBalanceStr}
                  onChange={(e) => setInitialBalanceStr(e.target.value)}
                  onBlur={() => {
                    if (parsedInit !== null) setInitialBalanceStr(formatDE(parsedInit));
                  }}
                  title={amountInvalid ? 'Bitte Betrag wie 1.234,56 eingeben' : undefined}
                />
                <p className="text-xs text-neutral-500">
                  This will create an initial transaction
                </p>
                {amountInvalid && (
                  <p className="text-xs text-red-600">Wrong format. Example: 1.234,56</p>
                )}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={busy || !name.trim() || amountInvalid}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
