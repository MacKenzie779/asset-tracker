import { useMemo, useState } from 'react';
import type { Account, NewTransaction } from '../types';
import { todayDE, parseDateDEToISO } from '../lib/format';

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
  const [amount, setAmount] = useState<number>(0);
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
    if (!iso) return; // silently ignore invalid date; you can show a toast if you want
    setBusy(true);
    try {
      await onAdd({
        account_id: accountId,
        date: iso,
        description: notes.trim() || null,
        amount: Number(amount) || 0,
        category: category.trim() || null,
        reimbursement_account_id: reimId === '' ? null : Number(reimId),
      });
      setCategory('');
      setNotes('');
      setAmount(0);
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
        type="number"
        step="0.01"
        className="input col-span-2 text-right"
        value={Number.isFinite(amount) ? amount : 0}
        onChange={(e) => setAmount(parseFloat(e.target.value))}
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
