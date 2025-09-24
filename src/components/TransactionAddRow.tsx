import { useMemo, useState } from 'react';
import type { Account, NewTransaction } from '../types';
import { todayDE, parseDateDEToISO } from '../lib/format';

// Local, robust EU/US decimal parser. Returns null if it can't parse.
function parseAmountString(s: string): number | null {
  if (s == null) return null;
  let t = s.trim().replace(/\s/g, '');
  if (t === '') return null;

  const hasComma = t.includes(',');
  const hasDot = t.includes('.');

  if (hasComma && hasDot) {
    const lastComma = t.lastIndexOf(',');
    const lastDot = t.lastIndexOf('.');
    if (lastComma > lastDot) {
      // "1.234,56" -> "1234.56"
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      // "1,234.56" -> "1234.56"
      t = t.replace(/,/g, '');
    }
  } else if (hasComma) {
    // "5,12" -> "5.12"
    t = t.replace(',', '.');
  }

  // Guard against dangling decimal like "5." (allow on typing, but not on submit)
  if (/^[-+]?\d+[.]$/.test(t)) return null;

  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function TransactionAddRow({
  accounts,
  onAdd,
}: {
  accounts: Account[];
  onAdd: (t: NewTransaction) => Promise<void>;
}) {
  const [dateDE, setDateDE] = useState<string>(todayDE());
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [amountStr, setAmountStr] = useState<string>(''); // use string for typing
  const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 1);
  const reimbursable = useMemo(
    () => accounts.filter((a) => a.type === 'reimbursable'),
    [accounts]
  );
  const [reimId, setReimId] = useState<number | ''>('');

  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const iso = parseDateDEToISO(dateDE);
    if (!iso) return;

    // Parse the current input string exactly as typed
    const amt = parseAmountString(amountStr);
    if (amt === null) return; // invalid/unfinished amount → abort submit silently

    setBusy(true);
    try {
      await onAdd({
        account_id: accountId,
        date: iso,
        description: notes.trim() || null,
        amount: amt, // <-- send parsed number (no fallback to 0)
        category: category.trim() || null,
        reimbursement_account_id: reimId === '' ? null : Number(reimId),
      });
      // Reset
      setCategory('');
      setNotes('');
      setAmountStr('');
      setReimId('');
      setDateDE(todayDE());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid grid-cols-12 gap-2 items-center p-2" onSubmit={onSubmit}>
      <input
        className="input col-span-2"
        placeholder="dd.mm.yyyy"
        value={dateDE}
        onChange={(e) => setDateDE(e.target.value)}
      />
      <input
        className="input col-span-2"
        placeholder="Category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <input
        className="input col-span-3"
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.,]?[0-9]*"
        className="input col-span-2 text-right"
        placeholder="0,00"
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
      />
      <select
        className="input col-span-2"
        value={accountId}
        onChange={(e) => setAccountId(parseInt(e.target.value))}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        className="input col-span-1"
        value={reimId}
        onChange={(e) => setReimId(e.target.value === '' ? '' : parseInt(e.target.value))}
      >
        <option value="">—</option>
        {reimbursable.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button className="btn btn-primary col-span-12 md:col-span-12 w-fit px-3" disabled={busy}>
        {busy ? 'Add…' : 'Add'}
      </button>
    </form>
  );
}
