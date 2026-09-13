import { useMemo, useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { Account, NewTransaction, NewTransfer } from '../types';
import { todayDE, parseDateDEToISO } from '../lib/format';
import { formatMoneyDE, parseDecimal } from '../lib/number';
import { errorMessage } from '../lib/errors';
import { useFocusTarget } from '../lib/focusBus';
import CategorySelect from './CategorySelect';
import AccountSelect from './AccountSelect';
import { IconPaperPlane } from './icons';
import { useToast } from './Toast';
import { invalidateCategories } from '../hooks/useCategories';

type TxType = 'income' | 'transfer' | 'expense';
const LS_KEY = 'tx:lastType';

/**
 * Quick-add row with three modes.
 *
 * Expense / Income write one entry on the chosen account. Picking a person under
 * "Split with" additionally moves their share to that person as a linked
 * transfer, so the person's balance shows what they owe you (expense) or what
 * you owe them (income). Leaving "their share" empty means the whole amount is
 * theirs. Picking a person as the *account* records something they paid for you.
 *
 * Transfer writes a linked pair: money leaves the source and arrives at the destination.
 */
export default function TransactionAddRow({
  accounts,
  onAdd,
  onTransfer,
}: {
  accounts: Account[];
  onAdd: (t: NewTransaction) => Promise<void>;
  onTransfer: (t: NewTransfer) => Promise<void>;
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

  // Income/Expense (in Transfer mode the category is optional and defaults to "Transfer")
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');      // no default
  const people = useMemo(() => accounts.filter(a => a.type === 'person'), [accounts]);
  const [splitId, setSplitId] = useState<number | ''>('');          // person to split with (optional)
  const [shareStr, setShareStr] = useState<string>('');             // their share (optional; empty = all)

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
  const share = parseDecimal(shareStr);

  const isEmptyAccount = (v: number | '') => v === '';
  const catMissing = txType !== 'transfer' && (category.trim().length === 0);
  const dateMissing = !iso;
  const amountInvalid = !Number.isFinite(amt as number) || (amt as number) === 0;
  const accountsInvalid = txType === 'transfer'
    ? (srcId === '' || dstId === '' || srcId === dstId)
    : isEmptyAccount(accountId);
  const hasSplit = txType !== 'transfer' && splitId !== '';
  const splitInvalid = hasSplit && splitId === accountId;
  const shareInvalid =
    hasSplit && shareStr.trim() !== '' &&
    (share === null || share <= 0 || (Number.isFinite(amt as number) && share > Math.abs(amt as number) + 1e-9));

  const canSubmit =
    !dateMissing && !amountInvalid && !accountsInvalid && !splitInvalid && !shareInvalid &&
    (txType === 'transfer' || !catMissing);
  const flagInvalid = (cond: boolean) => showErrors && cond;

  const personName = (id: number | '') => accounts.find(a => a.id === Number(id))?.name ?? '';

  const resetFields = () => {
    setDateDE(todayDE()); setNotes(''); setAmountStr(''); setCategory('');
    setAccountId(''); setSplitId(''); setShareStr(''); setSrcId(''); setDstId('');
    setShowErrors(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !iso || !amt) {
      setShowErrors(true);
      // focus the first invalid field
      if (dateMissing) { dateRef.current?.focus(); return; }
      if (amountInvalid) { amountRef.current?.focus(); return; }
      return;
    }

    const total = Math.abs(amt);
    const desc = notes.trim() || null;
    setBusy(true);
    try {
      if (txType === 'transfer') {
        const src = personName(srcId) || String(srcId);
        const dst = personName(dstId) || String(dstId);
        const label = (notes.trim() ? `${notes.trim()} ` : '') + `[${src} -> ${dst}]`;
        await onTransfer({ from_account_id: Number(srcId), to_account_id: Number(dstId), date: iso, amount: total, description: label, category: category.trim() || null });
        toast.success('Transfer added', { description: `${formatMoneyDE(total)} from ${src} to ${dst}` });
      } else {
        const theirs = hasSplit ? (shareStr.trim() === '' ? total : (share as number)) : 0;
        const own = total - theirs;
        const sign = txType === 'expense' ? -1 : 1;

        if (own > 1e-9) {
          await onAdd({ account_id: Number(accountId), date: iso, description: desc, amount: sign * own, category: category.trim() });
        }
        if (theirs > 1e-9) {
          // Expense: their share moves from your account to the person (they owe you).
          // Income: their share of what you received moves from the person to your account (you owe them).
          const from = txType === 'expense' ? Number(accountId) : Number(splitId);
          const to = txType === 'expense' ? Number(splitId) : Number(accountId);
          // The category travels with their share, so the person's ledger shows what it was for.
          await onTransfer({ from_account_id: from, to_account_id: to, date: iso, amount: theirs, description: desc, category: category.trim() });
        }

        const who = personName(splitId);
        toast.success(txType === 'expense' ? 'Expense added' : 'Income added', {
          description: hasSplit
            ? (own > 1e-9
                ? `${formatMoneyDE(own)} yours, ${formatMoneyDE(theirs)} for ${who}`
                : `${formatMoneyDE(theirs)} for ${who}`)
            : undefined,
        });
      }

      invalidateCategories();
      resetFields();
      dateRef.current?.focus();
    } catch (err) {
      // keep the typed values so the user can retry
      toast.error('Could not add transaction', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  // Column budget per mode on md+ (45 columns total):
  //   income/expense, no split:   5 + 8 + 9 + 5 + 7 + 7 + 4
  //   income/expense, with split: 5 + 7 + 7 + 5 + 7 + 6 + 4 + 4
  //   transfer:                   5 + 8 + 9 + 5 + 7 + 7 + 4
  const cols = hasSplit
    ? { category: 'md:col-span-7', notes: 'md:col-span-7', account: 'md:col-span-7', split: 'md:col-span-6', share: 'md:col-span-4' }
    : { category: 'md:col-span-8', notes: 'md:col-span-9', account: 'md:col-span-7', split: 'md:col-span-7', share: '' };

  return (
    <form className="p-2" onSubmit={onSubmit} aria-label="Add transaction">
      {/* type selector */}
      <div className="mb-2 flex gap-2 p-3" role="radiogroup" aria-label="Transaction type">
        <TypeBtn cur={txType} me="income"   onClick={setTxType}>Income</TypeBtn>
        <TypeBtn cur={txType} me="transfer" onClick={setTxType}>Transfer</TypeBtn>
        <TypeBtn cur={txType} me="expense"  onClick={setTxType}>Expense</TypeBtn>
      </div>

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
            <div className={clsx('col-span-12', cols.category)}>
              <CategorySelect
                className={clsx('input h-9 w-full', flagInvalid(catMissing) && 'input-invalid')}
                value={category}
                onChange={setCategory}
                placeholder="Category*"
              />
            </div>

            {/* Notes */}
            <input
              className={clsx('input h-9 col-span-12', cols.notes)}
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

            {/* Account * (a person here means: they paid this for you) */}
            <div className={clsx('col-span-12', cols.account, flagInvalid(isEmptyAccount(accountId) || splitInvalid) && 'ring-1 ring-rose-500/70 rounded-xl')}>
              <AccountSelect
                options={accounts}
                value={accountId}
                onChange={setAccountId}
                placeholder="Account*"
                className="input h-9 w-full"
              />
            </div>

            {/* Split with (optional person) */}
            <div className={clsx('col-span-12', cols.split, flagInvalid(splitInvalid) && 'ring-1 ring-rose-500/70 rounded-xl')}>
              <AccountSelect
                options={people}
                value={splitId}
                onChange={(v) => { setSplitId(v); if (v === '') setShareStr(''); }}
                placeholder={txType === 'expense' ? 'Paid for…' : 'Shared with…'}
                ariaLabel={txType === 'expense' ? 'Person you paid for (optional)' : 'Person who gets a share (optional)'}
                className="input h-9 w-full"
              />
            </div>

            {/* Their share (only with a person) */}
            {hasSplit && (
              <input
                type="text"
                inputMode="decimal"
                className={clsx('input h-9 text-right tabular-nums col-span-12', cols.share, flagInvalid(shareInvalid) && 'input-invalid')}
                placeholder="Their share"
                aria-label={`Share of ${personName(splitId) || 'the person'} (empty = whole amount)`}
                aria-invalid={flagInvalid(shareInvalid) || undefined}
                title="Their share of the amount. Leave empty if the whole amount is theirs."
                value={shareStr}
                onChange={(e) => setShareStr(e.target.value)}
              />
            )}
          </>
        ) : (
          <>
            {/* Category (optional; "Transfer" when empty) */}
            <div className="col-span-12 md:col-span-8">
              <CategorySelect
                className="input h-9 w-full"
                value={category}
                onChange={setCategory}
                placeholder="Category (optional)"
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

            {/* Source * */}
            <div className={clsx('col-span-12 md:col-span-7', flagInvalid(srcId === '') && 'ring-1 ring-rose-500/70 rounded-xl')}>
              <AccountSelect
                options={accounts}
                value={srcId}
                onChange={setSrcId}
                placeholder="From*"
                ariaLabel="Source account"
                className="input h-9 w-full"
              />
            </div>

            {/* Destination * */}
            <div className={clsx('col-span-12 md:col-span-7', flagInvalid(dstId === '' || (srcId !== '' && dstId === srcId)) && 'ring-1 ring-rose-500/70 rounded-xl')}>
              <AccountSelect
                options={accounts}
                value={dstId}
                onChange={setDstId}
                placeholder="To*"
                ariaLabel="Destination account"
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

      {txType === 'transfer' && (
        <p className="px-1 pt-2 text-xs text-neutral-500">
          Money you lend, pay for someone or pay back is a transfer to or from that person. Give it a category to record what it was for.
        </p>
      )}
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
