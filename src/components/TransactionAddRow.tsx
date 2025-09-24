import { useMemo, useState } from 'react';
import type { Account, NewTransaction } from '../types';
import { todayDE, parseDateDEToISO } from '../lib/format';
import CategorySelect from '../components/CategorySelect';
import { invalidateCategories } from '../hooks/useCategories';

// ---- local helpers for categories (stored in localStorage) ----
function loadCategoriesLS(): string[] {
  try {
    const raw = localStorage.getItem('categories');
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.from(new Set(arr)).filter(Boolean);
  } catch {
    return [];
  }
}
function saveCategoriesLS(list: string[]) {
  try {
    localStorage.setItem('categories', JSON.stringify(Array.from(new Set(list)).filter(Boolean)));
  } catch {}
}
function canonicalizeCategory(input: string, options: string[]): string {
  const t = (input ?? '').trim();
  if (!t) return '';
  const hit = options.find(o => o.toLowerCase() === t.toLowerCase());
  return hit ?? t; // use existing spelling if found, else as typed
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
  const [amountStr, setAmountStr] = useState<string>('');
  const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 1);
  const [reimId, setReimId] = useState<number | ''>('');
  const categories = useMemo(() => loadCategoriesLS(), []); // suggestions

  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const iso = parseDateDEToISO(dateDE);
    if (!iso) return;

    // Parse amount ("5,12" / "5.12")
    let t = (amountStr ?? '').trim().replace(/\s/g, '');
    if (t.includes(',') && t.includes('.')) {
      const lastComma = t.lastIndexOf(',');
      const lastDot = t.lastIndexOf('.');
      t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (t.includes(',')) {
      t = t.replace(',', '.');
    }
    if (/^[-+]?\d+[.]$/.test(t)) return; // unfinished like "5."
    const amt = Number(t);
    if (!Number.isFinite(amt)) return;

    // Canonicalize category and store to LS for future suggestions
    const cat = canonicalizeCategory(category, categories);
    if (cat) saveCategoriesLS([...categories, cat]);

    setBusy(true);
    try {
      await onAdd({
        account_id: accountId,
        date: iso,
        description: notes.trim() || null,
        amount: amt,
        category: cat || null,
        reimbursement_account_id: reimId === '' ? null : Number(reimId),
      });
      setCategory('');
      invalidateCategories();
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
      {/* Category with chooser (datalist) */}
      <CategorySelect
        className="input col-span-2"
        value={category}
        onChange={setCategory}
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
        {accounts.filter(a => a.type === 'reimbursable').map((a) => (
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
