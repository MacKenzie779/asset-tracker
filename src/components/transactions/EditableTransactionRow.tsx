import { useEffect, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import Amount from '../Amount';
import IconButton from '../IconButton';
import CategorySelect from '../CategorySelect';
import AccountSelect from '../AccountSelect';
import { IconCheck, IconPencil, IconTrash, IconX } from '../icons';
import { useToast } from '../Toast';
import { formatDate, parseDateDEToISO } from '../../lib/format';
import { formatDecimalDE, parseDecimal } from '../../lib/number';
import { invalidateCategories } from '../../hooks/useCategories';
import type { Account, Transaction, UpdateTransaction } from '../../types';

export type EditableTransactionRowProps = {
  row: Transaction;
  accounts: Account[];
  hidden: boolean;
  onDelete?: (id: number) => void;
  /** Should throw on failure; the page reports the error. */
  onUpdate?: (patch: UpdateTransaction) => Promise<void>;
};

const amountText = (row: Transaction) => (row.amount != null ? formatDecimalDE(row.amount) : '');

/** One transaction row with inline editing. Enter saves, Escape cancels. */
export default function EditableTransactionRow({
  row,
  accounts,
  hidden,
  onDelete,
  onUpdate,
}: EditableTransactionRowProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [dateDE, setDateDE] = useState(formatDate(row.date));
  const [category, setCategory] = useState(row.category ?? '');
  const [notes, setNotes] = useState(row.description ?? '');
  const [amountStr, setAmountStr] = useState<string>(amountText(row));
  const [accountId, setAccountId] = useState<number>(row.account_id);

  const reset = () => {
    setEditing(false);
    setShowErrors(false);
    setDateDE(formatDate(row.date));
    setCategory(row.category ?? '');
    setNotes(row.description ?? '');
    setAmountStr(amountText(row));
    setAccountId(row.account_id);
  };

  // Pick up fresh values after a refresh while not editing.
  useEffect(() => {
    if (editing) return;
    setDateDE(formatDate(row.date));
    setCategory(row.category ?? '');
    setNotes(row.description ?? '');
    setAmountStr(amountText(row));
    setAccountId(row.account_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  const iso = parseDateDEToISO(dateDE);
  const amt = parseDecimal(amountStr);
  const dateInvalid = !iso;
  const amountInvalid = amt === null;

  const save = async () => {
    if (!onUpdate || busy) return;
    if (dateInvalid || amountInvalid) {
      setShowErrors(true);
      toast.error(dateInvalid ? 'Enter a valid date (dd.mm.yyyy)' : 'Enter a valid amount');
      return;
    }

    const patch: UpdateTransaction = { id: row.id };
    if (iso !== row.date) patch.date = iso;
    if (Number.isFinite(amt) && amt !== row.amount) patch.amount = amt;
    if (accountId !== row.account_id) patch.account_id = accountId;

    const prevCat = row.category ?? '';
    const catTrim = (category ?? '').trim();
    if (catTrim !== prevCat) patch.category = catTrim || null;

    const prevNotes = row.description ?? '';
    const notesTrim = (notes ?? '').trim();
    if (notesTrim !== prevNotes) patch.description = notesTrim || null;

    setBusy(true);
    try {
      await onUpdate(patch);
      setEditing(false);
      setShowErrors(false);
      invalidateCategories();
    } catch {
      // the page shows the error; stay in edit mode with the typed values
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (!editing) return;
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      reset();
    }
  };

  return (
    <tr
      onKeyDown={onKeyDown}
      className={clsx(
        '[&>td]:py-2 [&>td]:px-2 border-b border-neutral-200/40 dark:border-neutral-800/40',
        editing && 'bg-blue-50/50 dark:bg-blue-950/20'
      )}
    >
      {/* Date */}
      <td className="tabular-nums align-middle" style={{ width: 120 }}>
        {editing ? (
          <input
            className={clsx('input h-8 w-[120px]', showErrors && dateInvalid && 'input-invalid')}
            placeholder="dd.mm.yyyy"
            aria-label="Date"
            aria-invalid={(showErrors && dateInvalid) || undefined}
            value={dateDE}
            onChange={(e) => setDateDE(e.target.value)}
            autoFocus
          />
        ) : (
          formatDate(row.date)
        )}
      </td>

      {/* Category */}
      <td className="align-middle" style={{ width: 200 }}>
        {editing ? (
          <CategorySelect className="input h-8 w-full" value={category} onChange={setCategory} />
        ) : (
          row.category || '—'
        )}
      </td>

      {/* Notes */}
      <td className="align-middle">
        {editing ? (
          <input
            className="input h-8 w-full"
            placeholder="Notes"
            aria-label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        ) : (
          row.description || ''
        )}
      </td>

      {/* Value */}
      <td className="text-right font-medium align-middle" style={{ width: 140 }}>
        {editing ? (
          <input
            type="text"
            inputMode="decimal"
            className={clsx('input h-8 text-right', showErrors && amountInvalid && 'input-invalid')}
            placeholder="0,00"
            aria-label="Amount"
            aria-invalid={(showErrors && amountInvalid) || undefined}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        ) : (
          <Amount value={row.amount} hidden={hidden} colorBySign />
        )}
      </td>

      {/* Account */}
      <td className="align-middle" style={{ width: 200 }}>
        {editing ? (
          <div className="w-full">
            <AccountSelect
              options={accounts}
              value={accountId}
              onChange={(v) => setAccountId(v === '' ? row.account_id : Number(v))}
              placeholder="Account"
              className="input h-8 w-full"
            />
          </div>
        ) : (
          row.account_name
        )}
      </td>

      {/* Actions */}
      <td className="align-middle">
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <>
              <IconButton label="Save" onClick={() => void save()} disabled={busy}>
                <IconCheck />
              </IconButton>
              <IconButton label="Cancel" onClick={reset} disabled={busy}>
                <IconX />
              </IconButton>
            </>
          ) : (
            <>
              {onUpdate && (
                <IconButton label="Edit" onClick={() => setEditing(true)}>
                  <IconPencil />
                </IconButton>
              )}
              {onDelete && (
                <IconButton label="Delete" tone="danger" onClick={() => onDelete(row.id)}>
                  <IconTrash />
                </IconButton>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
