import { useMemo, useState, useEffect } from 'react';
import type { Account, NewTransaction } from '../types';
import { todayDE, parseDateDEToISO } from '../lib/format';
import CategorySelect from './CategorySelect';            // combobox we added earlier
import { invalidateCategories } from '../hooks/useCategories';

// Parse "5,12" / "5.12" / "1.234,56" / "1,234.56" -> number | null
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
  if (/^[-+]?\d+[.]$/.test(t)) return null; // unfinished like "5."
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type TxType = 'income' | 'transfer' | 'expense';
const LS_KEY = 'tx:lastType';

export default function TransactionAddRow({
  accounts,
  onAdd,
}: {
  accounts: Account[];
  onAdd: (t: NewTransaction) => Promise<void>;
}) {
  // ----- Type (remember last choice) -----
  const [txType, setTxType] = useState<TxType>(() => {
    const s = localStorage.getItem(LS_KEY) as TxType | null;
    return s === 'income' || s === 'transfer' || s === 'expense' ? s : 'expense';
  });
  useEffect(() => { localStorage.setItem(LS_KEY, txType); }, [txType]);

  // ----- Shared/basic state -----
  const [dateDE, setDateDE] = useState<string>(todayDE());
  const [notes, setNotes] = useState('');
  const [amountStr, setAmountStr] = useState<string>('');

  // Income/Expense
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 1);
  const reimbursable = useMemo(() => accounts.filter(a => a.type === 'reimbursable'), [accounts]);
  const [reimId, setReimId] = useState<number | ''>('');

  // Transfer
  const [srcId, setSrcId] = useState<number>(accounts[0]?.id ?? 1);
  const [dstId, setDstId] = useState<number>(accounts[1]?.id ?? accounts[0]?.id ?? 1);

  // Keep account defaults sensible when account list changes
  useEffect(() => {
    if (!accounts.length) return;
    if (!accounts.some(a => a.id === accountId)) setAccountId(accounts[0].id);
    if (!accounts.some(a => a.id === srcId)) setSrcId(accounts[0].id);
    if (!accounts.some(a => a.id === dstId)) setDstId(accounts[Math.min(1, Math.max(0, accounts.length - 1))].id);
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState(false);

  // ----- Validation per type -----
  const iso = parseDateDEToISO(dateDE);
  const amt = parseAmountString(amountStr);
  const catOk = (category ?? '').trim().length > 0;
  const baseOk = Boolean(iso) && Number.isFinite(amt!) && (amt as number) !== 0;

  const canSubmit =
    txType === 'income'
      ? baseOk && catOk && Number.isFinite(accountId)
      : txType === 'expense'
      ? baseOk && catOk && Number.isFinite(accountId)
      : baseOk && Number.isFinite(srcId) && Number.isFinite(dstId) && srcId !== dstId;

  // ----- Submit handler -----
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !iso || !amt) return;

    setBusy(true);
    try {
      if (txType === 'income') {
        // 1) primary income
        await onAdd({
          account_id: accountId,
          date: iso,
          description: notes.trim() || null,
          amount: Math.abs(amt), // income is positive
          category: category.trim(),
          reimbursement_account_id: null, // we no longer store this in DB
        });

        // 2) optional mirror on reimbursable account (same info, same sign)
        if (reimId !== '' && reimId !== accountId) {
          await onAdd({
            account_id: Number(reimId),
            date: iso,
            description: notes.trim() || null,
            amount: Math.abs(amt),
            category: category.trim(),
            reimbursement_account_id: null,
          });
        }
      } else if (txType === 'transfer') {
        const src = accounts.find(a => a.id === srcId)?.name ?? String(srcId);
        const dst = accounts.find(a => a.id === dstId)?.name ?? String(dstId);
        const suffix = `(from ${src} / to ${dst})`;
        const desc = (notes.trim() ? `${notes.trim()} ` : '') + suffix;

        // out of source (negative)
        await onAdd({
          account_id: srcId,
          date: iso,
          description: desc,
          amount: -Math.abs(amt),
          category: 'Transfer',
          reimbursement_account_id: null,
        });

        // into destination (positive)
        await onAdd({
          account_id: dstId,
          date: iso,
          description: desc,
          amount: Math.abs(amt),
          category: 'Transfer',
          reimbursement_account_id: null,
        });
      } else {
        // expense
        await onAdd({
          account_id: accountId,
          date: iso,
          description: notes.trim() || null,
          amount: -Math.abs(amt), // expense is negative
          category: category.trim(),
          reimbursement_account_id: null,
        });

        // optional mirror on reimbursable account (same info, same sign per your spec)
        if (reimId !== '' && reimId !== accountId) {
          await onAdd({
            account_id: Number(reimId),
            date: iso,
            description: notes.trim() || null,
            amount: -Math.abs(amt),
            category: category.trim(),
            reimbursement_account_id: null,
          });
        }
      }

      // refresh categories in the chooser everywhere
      invalidateCategories();

      // Reset lightweight fields, keep accounts & type for speed
      setDateDE(todayDE());
      setNotes('');
      setAmountStr('');
      setCategory('');
      setReimId('');
    } finally {
      setBusy(false);
    }
  };

  // ----- UI -----
  return (
    <form className="grid grid-cols-12 gap-2 items-center p-2" onSubmit={onSubmit}>
      {/* Type selector */}
      <div className="col-span-12 flex gap-2">
        <TypeBtn cur={txType} me="income"   onClick={setTxType}>Income</TypeBtn>
        <TypeBtn cur={txType} me="transfer" onClick={setTxType}>Transfer</TypeBtn>
        <TypeBtn cur={txType} me="expense"  onClick={setTxType}>Expense</TypeBtn>
      </div>

      {/* Date */}
      <input
        className="input col-span-2"
        placeholder="dd.mm.yyyy"
        value={dateDE}
        onChange={(e) => setDateDE(e.target.value)}
      />

      {/* Fields by type */}
      {txType !== 'transfer' ? (
        <>
          {/* Category (required) */}
          <CategorySelect
            className="input col-span-2"
            value={category}
            onChange={setCategory}
          />
          {/* Notes */}
          <input
            className="input col-span-3"
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {/* Amount (required) */}
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            className="input col-span-2 text-right"
            placeholder="0,00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
          {/* Account (required) */}
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
          {/* Reimbursable (optional; not saved; only used to auto-create mirror tx) */}
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
        </>
      ) : (
        <>
          {/* Notes */}
          <input
            className="input col-span-4 md:col-span-3"
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {/* Amount (required) */}
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            className="input col-span-2 text-right"
            placeholder="0,00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
          {/* Source account (required) */}
          <select
            className="input col-span-3 md:col-span-2"
            value={srcId}
            onChange={(e) => setSrcId(parseInt(e.target.value))}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {/* Destination account (required) */}
          <select
            className="input col-span-3 md:col-span-3"
            value={dstId}
            onChange={(e) => setDstId(parseInt(e.target.value))}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </>
      )}

      {/* Submit */}
      <button
        className="btn btn-primary col-span-12 md:col-span-12 w-fit px-3"
        disabled={busy || !canSubmit}
      >
        {busy ? 'Add…' : 'Add'}
      </button>
    </form>
  );
}

/* --- tiny segmented button --- */
function TypeBtn({
  cur, me, onClick, children,
}: {
  cur: TxType; me: TxType; onClick: (t: TxType) => void; children: React.ReactNode;
}) {
  const active = cur === me;
  return (
    <button
      type="button"
      className={[
        'px-3 h-8 rounded-full text-sm',
        active
          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
          : 'bg-neutral-200/60 dark:bg-neutral-800/60 hover:bg-neutral-300/60 dark:hover:bg-neutral-700/60',
      ].join(' ')}
      onClick={() => onClick(me)}
    >
      {children}
    </button>
  );
}
