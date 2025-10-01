import { useMemo, useState, useEffect, useRef } from 'react';
import type { Account, NewTransaction } from '../types';
import { todayDE, parseDateDEToISO } from '../lib/format';
import CategorySelect from './CategorySelect';
import AccountSelect from './AccountSelect';
import { invalidateCategories } from '../hooks/useCategories';

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

type TxType = 'income' | 'transfer' | 'expense';
const LS_KEY = 'tx:lastType';
const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const invalidCls =
  'ring-1 ring-red-500/70 border-red-500/70 focus:ring-red-500/70 focus:border-red-500/70';

export default function TransactionAddRow({
  accounts,
  onAdd,
}: {
  accounts: Account[];
  onAdd: (t: NewTransaction) => Promise<void>;
}) {
  const [txType, setTxType] = useState<TxType>(() => {
    const s = localStorage.getItem(LS_KEY) as TxType | null;
    return s === 'income' || s === 'transfer' || s === 'expense' ? s : 'expense';
  });
  useEffect(() => { localStorage.setItem(LS_KEY, txType); }, [txType]);

  const [dateDE, setDateDE] = useState<string>(todayDE());
  const [notes, setNotes] = useState('');
  const [amountStr, setAmountStr] = useState<string>('');
  const [showErrors, setShowErrors] = useState(false);

  // Income/Expense
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');      // no default
  const reimbursable = useMemo(() => accounts.filter(a => a.type === 'reimbursable'), [accounts]);
  const [reimId, setReimId] = useState<number | ''>('');            // no default

  // Transfer
  const [srcId, setSrcId] = useState<number | ''>('');              // no default
  const [dstId, setDstId] = useState<number | ''>('');              // no default

  // focus refs for required feedback
  const dateRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);

  // validation
  const iso = parseDateDEToISO(dateDE);
  const amt = parseAmountString(amountStr);

  const isEmptyAccount = (v: number | '') => v === '';
  const catMissing = txType !== 'transfer' && (category.trim().length === 0);
  const dateMissing = !iso;
  const amountInvalid = !Number.isFinite(amt as number) || (amt as number) === 0;
  const accountsInvalid = txType === 'transfer'
    ? (srcId === '' || dstId === '' || srcId === dstId)
    : isEmptyAccount(accountId);

  const canSubmit = !dateMissing && !amountInvalid && !accountsInvalid && (txType === 'transfer' || !catMissing);
  const flagInvalid = (cond: boolean) => showErrors && cond;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !iso || !amt) {
      setShowErrors(true);
      // focus the first invalid field
      if (dateMissing) { dateRef.current?.focus(); return; }
      if (amountInvalid) { amountRef.current?.focus(); return; }
      return;
    }

    setBusy(true);
    try {
      if (txType === 'income') {
        await onAdd({ account_id: Number(accountId), date: iso, description: notes.trim() || null, amount:  Math.abs(amt), category: category.trim() });
        if (reimId !== '' && reimId !== accountId) {
          await onAdd({ account_id: Number(reimId),  date: iso, description: notes.trim() || null, amount:  Math.abs(amt), category: category.trim() });
        }
      } else if (txType === 'transfer') {
        const src = accounts.find(a => a.id === Number(srcId))?.name ?? String(srcId);
        const dst = accounts.find(a => a.id === Number(dstId))?.name ?? String(dstId);
        const desc = (notes.trim() ? `${notes.trim()} ` : '') + `[${src} -> ${dst}]`;
        await onAdd({ account_id: Number(srcId), date: iso, description: desc, amount: -Math.abs(amt), category: 'Transfer' });
        await onAdd({ account_id: Number(dstId), date: iso, description: desc, amount:  Math.abs(amt), category: 'Transfer' });
      } else {
        await onAdd({ account_id: Number(accountId), date: iso, description: notes.trim() || null, amount: -Math.abs(amt), category: category.trim() });
        if (reimId !== '' && reimId !== accountId) {
          await onAdd({ account_id: Number(reimId),  date: iso, description: notes.trim() || null, amount: -Math.abs(amt), category: category.trim() });
        }
      }

      invalidateCategories();
      // reset light fields; keep type
      setDateDE(todayDE()); setNotes(''); setAmountStr(''); setCategory(''); setReimId(''); setAccountId(''); setSrcId(''); setDstId('');
      setShowErrors(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="p-2" onSubmit={onSubmit}>
      {/* type selector */}
      <div className="mb-2 flex gap-2 p-3">
        <TypeBtn cur={txType} me="income"   onClick={setTxType}>Income</TypeBtn>
        <TypeBtn cur={txType} me="transfer" onClick={setTxType}>Transfer</TypeBtn>
        <TypeBtn cur={txType} me="expense"  onClick={setTxType}>Expense</TypeBtn>
      </div>

      {/* 12-col grid; md+ stays on one line; account pickers use AccountSelect (same design as CategorySelect) */}
      <div className="grid grid-cols-12 md:grid-cols-[repeat(45,minmax(0,1fr))] gap-2 items-center">
        {/* Date * */}
        <input
          ref={dateRef}
          className={cx('input h-9 tabular-nums col-span-12 md:col-span-5', flagInvalid(dateMissing) && invalidCls)}
          placeholder="dd.mm.yyyy*"
          value={dateDE}
          onChange={(e) => setDateDE(e.target.value)}
        />

        {txType !== 'transfer' ? (
          <>
            {/* Category * */}
            <div className="col-span-12 md:col-span-8">
              <CategorySelect
                className={cx('input h-9 w-full', flagInvalid(catMissing) && invalidCls)}
                value={category}
                onChange={setCategory}
                placeholder="Category*"
              />
            </div>

            {/* Notes */}
            <input
              className="input h-9 col-span-12 md:col-span-9"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* Amount * */}
            <input
              ref={amountRef}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              className={cx('input h-9 text-right tabular-nums col-span-12 md:col-span-5', flagInvalid(amountInvalid) && invalidCls)}
              placeholder="0,00*"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              title={amountInvalid ? 'Enter a non-zero amount' : undefined}
            />

            {/* Account * — same design as CategorySelect */}
            <div className={cx('col-span-12 md:col-span-7', flagInvalid(isEmptyAccount(accountId)) && 'ring-1 ring-red-500/70 rounded-xl')}>
              <AccountSelect
                options={accounts}
                value={accountId}
                onChange={setAccountId}
                placeholder="Account*"
                className="input h-9 w-full"
              />
            </div>

            {/* Reimbursable (optional) — same width as Account */}
            <div className="col-span-12 md:col-span-7">
              <AccountSelect
                options={reimbursable}
                value={reimId}
                onChange={setReimId}
                placeholder="Reimbursable"
                className="input h-9 w-full"
              />
            </div>
          </>
        ) : (
          <>
            {/* Notes */}
            <input
              className="input h-9 col-span-12 md:col-span-15"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* Amount * */}
            <input
              ref={amountRef}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              className={cx('input h-9 text-right tabular-nums col-span-12 md:col-span-5', flagInvalid(amountInvalid) && invalidCls)}
              placeholder="0,00*"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              title={amountInvalid ? 'Enter a non-zero amount' : undefined}
            />

            {/* Source * */}
            <div className={cx('col-span-12 md:col-span-9', flagInvalid(srcId === '') && 'ring-1 ring-red-500/70 rounded-xl')}>
              <AccountSelect
                options={accounts}
                value={srcId}
                onChange={setSrcId}
                placeholder="Source account*"
                className="input h-9 w-full"
              />
            </div>

            {/* Destination * */}
            <div className={cx('col-span-12 md:col-span-9', flagInvalid(dstId === '' || (srcId !== '' && dstId === srcId)) && 'ring-1 ring-red-500/70 rounded-xl')}>
              <AccountSelect
                options={accounts}
                value={dstId}
                onChange={setDstId}
                placeholder="Destination account*"
                className="input h-9 w-full"
              />
            </div>
          </>
        )}

        {/* Add button — bigger paper plane */}
        <button
          title="Add"
          aria-label="Add"
          disabled={busy || !canSubmit}
          className="
            btn btn-primary h-10 w-100 p-0 rounded-full
            col-span-10 md:col-span-4 grid place-items-center
            disabled:opacity-40 disabled:cursor-not-allowed disabled:saturate-0
          "
        >
          <PaperPlaneIcon />
        </button>

      </div>
    </form>
  );
}

/* --- small UI bits --- */
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

function PaperPlaneIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      className="block"
      fill="none"
      stroke="currentColor"
    >
      <path d="M22 2L11 13" strokeWidth="2" strokeLinecap="round"/>
      <path d="M22 2L15 22l-4-9-9-4 20-7Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

