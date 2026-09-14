// One 27px blotter row; turns into an inline editor on ⏎ / EDIT.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import DateField from './DateField';
import Money from './Money';
import MoreMenu from './MoreMenu';
import Typeahead from './Typeahead';
import { useI18n } from '../../hooks/useI18n';
import { useData } from '../../lib/data';
import { formatDateShort } from '../../lib/format';
import { formatDecimalDE, parseDecimal } from '../../lib/number';
import type { Transaction, UpdateTransaction } from '../../types';

type Props = {
  row: Transaction;
  hidden: boolean;
  selected: boolean;
  editing: boolean;
  isNew: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: UpdateTransaction) => Promise<void>;
  onDelete: () => void;
  onDuplicate: () => void;
};

export default function BlotterRow(p: Props) {
  const { row } = p;
  const { t } = useI18n();
  const linked = row.transfer_id != null;
  return (
    <div
      className={clsx('t-grid t-row', p.selected && 'is-selected', p.editing && 'is-editing', p.isNew && 'is-new')}
      role="row"
      aria-selected={p.selected}
      data-id={row.id}
      onMouseDown={() => { if (!p.editing) p.onSelect(); }}
      onDoubleClick={() => { if (!p.editing) p.onStartEdit(); }}
    >
      {p.editing ? (
        <Editor row={row} onCancel={p.onCancelEdit} onSave={p.onSave} />
      ) : (
        <>
          <span className="c-date" role="gridcell">{formatDateShort(row.date)}</span>
          <span className="c-cat" role="gridcell">
            {linked && <span className="c-link" title={t('row.linkedTitle')} aria-label={t('row.linkedAria')}>⇄</span>}
            <span>{row.category || '—'}</span>
          </span>
          <span className="c-notes" role="gridcell" title={row.description ?? undefined}>{row.description || ''}</span>
          <span className="c-val" role="gridcell"><Money value={row.amount} hidden={p.hidden} /></span>
          <span className="c-acc" role="gridcell">
            <span className="t-dot t-dot--5" style={{ background: row.account_color || '#6b7280' }} aria-hidden="true" />
            <span title={row.account_name}>{row.account_name}</span>
          </span>
          <span className="c-act" role="gridcell">
            <MoreMenu
              label={t('row.actions')}
              actions={[
                { label: t('action.edit'), hint: '⏎', onClick: p.onStartEdit },
                { label: t('action.duplicate'), onClick: p.onDuplicate },
                { label: linked ? t('action.deleteBoth') : t('action.delete'), hint: '⌫', danger: true, onClick: p.onDelete },
              ]}
            />
          </span>
        </>
      )}
    </div>
  );
}

function Editor({ row, onCancel, onSave }: { row: Transaction; onCancel: () => void; onSave: (patch: UpdateTransaction) => Promise<void> }) {
  const data = useData();
  const { t } = useI18n();
  const [dateISO, setDateISO] = useState(row.date);
  const [category, setCategory] = useState(row.category ?? '');
  const [notes, setNotes] = useState(row.description ?? '');
  const [amountStr, setAmountStr] = useState(formatDecimalDE(row.amount));
  const [accountText, setAccountText] = useState(row.account_name ?? '');
  const [accountId, setAccountId] = useState(row.account_id);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const dateRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { dateRef.current?.focus(); dateRef.current?.select(); }, []);

  const iso = dateISO || null;
  const amt = parseDecimal(amountStr);
  const dateInvalid = !iso;
  const amountInvalid = amt === null || Math.abs(amt) < 0.005;

  const save = async () => {
    if (busy) return;
    if (dateInvalid || amountInvalid) { setShowErrors(true); return; }
    const patch: UpdateTransaction = { id: row.id };
    if (iso !== row.date) patch.date = iso!;
    if (amt !== null && amt !== row.amount) patch.amount = amt;
    if (accountId !== row.account_id) patch.account_id = accountId;
    const cat = category.trim();
    if (cat !== (row.category ?? '')) patch.category = cat || null;
    const n = notes.trim();
    if (n !== (row.description ?? '')) patch.description = n || null;
    if (Object.keys(patch).length === 1) { onCancel(); return; }
    setBusy(true);
    try { await onSave(patch); } catch { /* reported by the page; stay in edit */ } finally { setBusy(false); }
  };

  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void save(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
  };

  const categories = data.categories.map((c) => ({ id: String(c.id), label: c.name }));
  const accounts = data.accounts.map((a) => ({ id: String(a.id), label: a.name, color: a.color ?? null }));

  return (
    <>
      <span className="c-date" role="gridcell">
        <DateField inputRef={dateRef} value={dateISO} onChange={setDateISO} ariaLabel={t('field.date')} invalid={showErrors && dateInvalid} onKeyDown={keys} />
      </span>
      <span className="c-cat" role="gridcell">
        <Typeahead items={categories} value={category} onChange={setCategory} placeholder={t('field.categoryPlaceholder')} ariaLabel={t('field.category')} onKeyDown={keys} createHint />
      </span>
      <span className="c-notes" role="gridcell">
        <input className="t-in" value={notes} aria-label={t('field.notes')} placeholder={t('field.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} onKeyDown={keys} />
      </span>
      <span className="c-val" role="gridcell">
        <input className={clsx('t-in t-in--right', showErrors && amountInvalid && 'is-invalid')} inputMode="decimal" value={amountStr} aria-label={t('field.amount')} placeholder="0,00" onChange={(e) => setAmountStr(e.target.value)} onKeyDown={keys} />
      </span>
      <span className="c-acc" role="gridcell">
        <Typeahead items={accounts} value={accountText} onChange={setAccountText} onPick={(it) => setAccountId(Number(it.id))} strict placeholder={t('field.accountPlaceholder')} ariaLabel={t('blotter.account')} onKeyDown={keys} />
      </span>
      <span className="c-act" role="gridcell">
        <button type="button" className="ok" onClick={() => void save()} disabled={busy} title={t('row.saveTitle')}>✓</button>
        <button type="button" className="cancel" onClick={onCancel} disabled={busy} title={t('row.cancelTitle')}>✕</button>
      </span>
    </>
  );
}
