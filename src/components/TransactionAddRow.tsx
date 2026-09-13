import { useMemo, useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { Account, NewTransaction } from '../types';
import { todayDE, parseDateDEToISO } from '../lib/format';
import { parseDecimal } from '../lib/number';
import { errorMessage } from '../lib/errors';
import { useFocusTarget } from '../lib/focusBus';
import CategorySelect from './CategorySelect';
import AccountSelect from './AccountSelect';
import { IconPaperPlane } from './icons';
import { useToast } from './Toast';
import { invalidateCategories } from '../hooks/useCategories';

type TxType = 'income' | 'transfer' | 'expense';
const LS_KEY = 'tx:lastType';

export default function TransactionAddRow({
  accounts,
  onAdd,
}: {
  accounts: Account[];
  onAdd: (t: NewTransaction) => Promise<void>;
}) {
  const toast = useToast();
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
  useFocusTarget('quick-add', dateRef);

  const [busy, setBusy] = useState(false);

  // validation
  const iso = parseDateDEToISO(dateDE);
  const amt = parseDecimal(amountStr);

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
      toast.success(txType === 'transfer' ? 'Transfer added' : txType === 'income' ? 'Income added' : 'Expense added');
      dateRef.current?.focus();
    } catch (err) {
      // keep the typed values so the user can retry
      toast.error('Could not add transaction', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="p-2" onSubmit={onSubmit} aria-label="Add transaction">
      {/* type selector */}
      <div className="mb-2 flex gap-2 p-3" role="radiogroup" aria-label="Transaction type">
        <TypeBtn cur={txType} me="income"   onClick={setTxType}>Income</TypeBtn>
        <TypeBtn cur={txType} me="transfer" onClick={setTxType}>Transfer</TypeBtn>
        <TypeBtn cur={txType} me="expense"  onClick={setTxType}>Expense</TypeBtn>
      </div>

      {/* 12-col grid on small screens; a 45-col grid on md+ keeps everything on one line.
          Column budget per mode must total 45: income/expense 5+8+9+5+7+7+4, transfer 5+13+5+9+9+4. */}
      <div className="grid grid-cols-12 md:grid-cols-[repeat(45,minmax(0,1fr))] gap-2 items-center">
        {/* Date * */}
        <input
          ref={dateRef}
          className={clsx('input h-9 tabular-nums col-span-12 md:col-span-5', flagInvalid(dateMissing) && 'input-invalid')}
          placeholder="dd.mm.yyyy*"
          aria-label="Date"
          aria-invalid={flagInvalid(dateMissing) || undefined}
          value={dateDE}
          onChange={(e) => setDateDE(e.target.value)}
        />

        {txType !== 'transfer' ? (
          <>
            {/* Category * */}
            <div className="col-span-12 md:col-span-8">
              <CategorySelect
                className={clsx('input h-9 w-full', flagInvalid(catMissing) && 'input-invalid')}
                value={category}
                onChange={setCategory}
                placeholder="Category*"
              />
            </div>

            {/* Notes */}
            <input
              className="input h-9 col-span-12 md:col-span-9"
              placeholder="Notes"
              aria-label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* Amount * */}
            <input
              ref={amountRef}
              type="text"
              inputMode="decimal"
              className={clsx('input h-9 text-right tabular-nums col-span-12 md:col-span-5', flagInvalid(amountInvalid) && 'input-invalid')}
              placeholder="0,00*"
              aria-label="Amount"
              aria-invalid={flagInvalid(amountInvalid) || undefined}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              title={amountInvalid ? 'Enter a non-zero amount' : undefined}
            />

            {/* Account * */}
            <div className={clsx('col-span-12 md:col-span-7', flagInvalid(isEmptyAccount(accountId)) && 'ring-1 ring-rose-500/70 rounded-xl')}>
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
                ariaLabel="Reimbursable account (optional)"
                className="input h-9 w-full"
              />
            </div>
          </>
        ) : (
          <>
            {/* Notes */}
            <input
              className="input h-9 col-span-12 md:col-span-13"
              placeholder="Notes"
              aria-label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* Amount * */}
            <input
              ref={amountRef}
              type="text"
              inputMode="decimal"
              className={clsx('input h-9 text-right tabular-nums col-span-12 md:col-span-5', flagInvalid(amountInvalid) && 'input-invalid')}
              placeholder="0,00*"
              aria-label="Amount"
              aria-invalid={flagInvalid(amountInvalid) || undefined}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              title={amountInvalid ? 'Enter a non-zero amount' : undefined}
            />

            {/* Source * */}
            <div className={clsx('col-span-12 md:col-span-9', flagInvalid(srcId === '') && 'ring-1 ring-rose-500/70 rounded-xl')}>
              <AccountSelect
                options={accounts}
                value={srcId}
                onChange={setSrcId}
                placeholder="Source account*"
                className="input h-9 w-full"
              />
            </div>

            {/* Destination * */}
            <div className={clsx('col-span-12 md:col-span-9', flagInvalid(dstId === '' || (srcId !== '' && dstId === srcId)) && 'ring-1 ring-rose-500/70 rounded-xl')}>
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

        {/* Add button */}
        <button
          type="submit"
          title="Add (Enter)"
          aria-label="Add transaction"
          disabled={busy || !canSubmit}
          className="btn btn-primary h-10 w-full p-0 rounded-full col-span-12 md:col-span-4 grid place-items-center disabled:saturate-0"
        >
          <IconPaperPlane className="h-5 w-5" />
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
      role="radio"
      aria-checked={active}
      className={clsx(
        'px-3 h-8 rounded-full text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        active
          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
          : 'bg-neutral-200/60 dark:bg-neutral-800/60 hover:bg-neutral-300/60 dark:hover:bg-neutral-700/60',
      )}
      onClick={() => onClick(me)}
    >
      {children}
    </button>
  );
}
