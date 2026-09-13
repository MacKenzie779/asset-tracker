// One 27px blotter row; turns into an inline editor on ⏎ / EDIT.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import Money from './Money';
import MoreMenu from './MoreMenu';
import Typeahead from './Typeahead';
import { useData } from '../../lib/data';
import { formatDate, formatDateShort, parseDateDEToISO } from '../../lib/format';
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
            {linked && <span className="c-link" title="Linked transfer: date, notes, category and amount apply to both sides" aria-label="Linked transfer">⇄</span>}
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
              label="Row actions"
              actions={[
                { label: 'EDIT', hint: '⏎', onClick: p.onStartEdit },
                { label: 'DUPLICATE', onClick: p.onDuplicate },
                { label: linked ? 'DELETE BOTH SIDES' : 'DELETE', hint: '⌫', danger: true, onClick: p.onDelete },
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
  const [dateDE, setDateDE] = useState(formatDate(row.date));
  const [category, setCategory] = useState(row.category ?? '');
  const [notes, setNotes] = useState(row.description ?? '');
  const [amountStr, setAmountStr] = useState(formatDecimalDE(row.amount));
  const [accountText, setAccountText] = useState(row.account_name ?? '');
  const [accountId, setAccountId] = useState(row.account_id);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => { dateRef.current?.focus(); dateRef.current?.select(); }, []);

  const iso = parseDateDEToISO(dateDE);
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
        <input ref={dateRef} className={clsx('t-in', showErrors && dateInvalid && 'is-invalid')} value={dateDE} aria-label="Date" placeholder="dd.mm.yyyy" onChange={(e) => setDateDE(e.target.value)} onKeyDown={keys} />
      </span>
      <span className="c-cat" role="gridcell">
        <Typeahead items={categories} value={category} onChange={setCategory} placeholder="category" ariaLabel="Category" onKeyDown={keys} createHint />
      </span>
      <span className="c-notes" role="gridcell">
        <input className="t-in" value={notes} aria-label="Notes" placeholder="notes" onChange={(e) => setNotes(e.target.value)} onKeyDown={keys} />
      </span>
      <span className="c-val" role="gridcell">
        <input className={clsx('t-in t-in--right', showErrors && amountInvalid && 'is-invalid')} inputMode="decimal" value={amountStr} aria-label="Amount" placeholder="0,00" onChange={(e) => setAmountStr(e.target.value)} onKeyDown={keys} />
      </span>
      <span className="c-acc" role="gridcell">
        <Typeahead items={accounts} value={accountText} onChange={setAccountText} onPick={(it) => setAccountId(Number(it.id))} strict placeholder="account" ariaLabel="Account" onKeyDown={keys} />
      </span>
      <span className="c-act" role="gridcell">
        <button type="button" className="ok" onClick={() => void save()} disabled={busy} title="Save (Enter)">✓</button>
        <button type="button" className="cancel" onClick={onCancel} disabled={busy} title="Cancel (Esc)">✕</button>
      </span>
    </>
  );
}
