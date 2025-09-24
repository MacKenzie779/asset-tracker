import { useMemo, useState } from 'react';
import Amount from './Amount';
import { formatDate, parseDateDEToISO } from '../lib/format';
import type { Account, Transaction, UpdateTransaction } from '../types';
import CategorySelect from '../components/CategorySelect';
import { invalidateCategories } from '../hooks/useCategories';

// ---- local helpers for categories (merge from items + localStorage) ----
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
  return hit ?? t;
}

export default function TransactionsTable({
  items,
  accounts,
  hidden,
  onDelete,
  onUpdate,
}: {
  items: Transaction[];
  accounts: Account[];
  hidden: boolean;
  onDelete?: (id: number) => void;
  onUpdate?: (patch: UpdateTransaction) => Promise<void>;
}) {
  // items come newest-first from backend; we need oldest → newest (newest at bottom)
  const rows = useMemo(() => [...items].reverse(), [items]);

  // Build category list from existing items + any locally stored ones
  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.category) s.add(it.category);
    for (const c of loadCategoriesLS()) s.add(c);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'de'));
  }, [items]);

  const reimbursable = useMemo(
    () => accounts.filter(a => a.type === 'reimbursable'),
    [accounts]
  );

  return (
    <>
      <datalist id="categories-list">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <table className="min-w-full text-sm">
        <thead>
          <tr className="[&>th]:py-2 [&>th]:px-2 text-left border-b border-neutral-200/50 dark:border-neutral-800/50">
            <th style={{ width: 120 }}>Date</th>
            <th style={{ width: 150 }}>Category</th>
            <th>Notes</th>
            <th className="text-right" style={{ width: 140 }}>Value</th>
            <th style={{ width: 180 }}>Account</th>
            <th style={{ width: 160 }}>Reimbursement</th>
            <th className="w-[1%]"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <EditableRow
              key={row.id}
              row={row}
              accounts={accounts}
              reimbursable={reimbursable}
              categories={categories}
              hidden={hidden}
              onDelete={onDelete}
              onUpdate={onUpdate}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

function EditableRow({
  row, accounts, reimbursable, categories, hidden, onDelete, onUpdate
}: {
  row: Transaction;
  accounts: Account[];
  reimbursable: Account[];
  categories: string[];            // added
  hidden: boolean;
  onDelete?: (id: number) => void;
  onUpdate?: (patch: UpdateTransaction) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [dateDE, setDateDE] = useState(formatDate(row.date));
  const [category, setCategory] = useState(row.category ?? '');
  const [notes, setNotes] = useState(row.description ?? '');
  const [amountStr, setAmountStr] = useState<string>(
    row.amount != null ? row.amount.toFixed(2).replace('.', ',') : ''
  );
  const [accountId, setAccountId] = useState<number>(row.account_id);
  const [reimId, setReimId] = useState<number | null>(row.reimbursement_account_id ?? null);

  const reset = () => {
    setEditing(false);
    setDateDE(formatDate(row.date));
    setCategory(row.category ?? '');
    setNotes(row.description ?? '');
    setAmountStr(row.amount != null ? row.amount.toFixed(2).replace('.', ',') : '');
    setAccountId(row.account_id);
    setReimId(row.reimbursement_account_id ?? null);
  };

  const save = async () => {
    if (!onUpdate) return;
    const iso = parseDateDEToISO(dateDE);
    if (!iso) return;

    // Parse amount string ("5,12" / "5.12")
    let t = (amountStr ?? '').trim().replace(/\s/g, '');
    if (t.includes(',') && t.includes('.')) {
      const lastComma = t.lastIndexOf(',');
      const lastDot = t.lastIndexOf('.');
      t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (t.includes(',')) {
      t = t.replace(',', '.');
    }
    if (/^[-+]?\d+[.]$/.test(t)) return;
    const amt = Number(t);

    // Canonicalize category (case-insensitive) and persist to LS
    const catCanon = canonicalizeCategory(category, categories);
    if (catCanon) saveCategoriesLS([...categories, catCanon]);

    const patch: UpdateTransaction = { id: row.id };
    if (iso !== row.date) patch.date = iso;
    if (Number.isFinite(amt) && amt !== row.amount) patch.amount = amt;
    if (accountId !== row.account_id) patch.account_id = accountId;

    const prevCat = row.category ?? '';
    if ((catCanon ?? '') !== prevCat) patch.category = catCanon || null;

    const notesTrim = (notes ?? '').trim();
    const prevNotes = row.description ?? '';
    if (notesTrim !== prevNotes) patch.description = notesTrim || null;

    const prevReim = row.reimbursement_account_id ?? null;
    if ((reimId ?? null) !== prevReim) patch.reimbursement_account_id = reimId;

    await onUpdate(patch);
    setEditing(false);
    invalidateCategories();
  };

  return (
    <tr className="[&>td]:py-2 [&>td]:px-2 border-b border-neutral-200/40 dark:border-neutral-800/40">
      {/* Date */}
      <td className="tabular-nums align-middle">
        {editing ? (
          <input
            className="input h-8 w-[120px]"
            placeholder="dd.mm.yyyy"
            value={dateDE}
            onChange={(e) => setDateDE(e.target.value)}
          />
        ) : (
          formatDate(row.date)
        )}
      </td>

      {/* Category (chooser + free typing) */}
      <td className="align-middle">
        {editing ? (
          <CategorySelect
            value={category}
            onChange={setCategory}
            className="input h-8 w-full"
          />
        ) : (
          row.category || '—'
        )}
      </td>

      {/* Notes */}
      <td className="align-middle">
        {editing ? (
          <input className="input h-8 w-full" placeholder="Notes" value={notes} onChange={e=>setNotes(e.target.value)} />
        ) : (
          row.description || '—'
        )}
      </td>

      {/* Value */}
      <td className="text-right font-medium align-middle">
        {editing ? (
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            className="input h-8 text-right"
            placeholder="0,00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        ) : (
          <Amount value={row.amount} hidden={hidden} colorBySign />
        )}
      </td>

      {/* Account */}
      <td className="align-middle">
        {editing ? (
          <select className="input w-full" value={accountId} onChange={e=>setAccountId(parseInt(e.target.value))}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : (
          row.account_name
        )}
      </td>

      {/* Reimbursement */}
      <td className="align-middle">
        {editing ? (
          <select
            className="input w-full"
            value={reimId ?? ''}
            onChange={e=>setReimId(e.target.value === '' ? null : parseInt(e.target.value))}
          >
            <option value="">—</option>
            {reimbursable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : (
          row.reimbursement_account_name || '—'
        )}
      </td>

      {/* Icons */}
      <td className="align-middle">
        <div className="flex items-center justify-end gap-2">
          {editing ? (
            <>
              <IconBtn label="Save" onClick={save}><IconCheck /></IconBtn>
              <IconBtn label="Cancel" onClick={reset}><IconX /></IconBtn>
            </>
          ) : (
            <>
              <IconBtn label="Edit" onClick={()=>setEditing(true)}><IconPencil /></IconBtn>
              {onDelete && <IconBtn label="Delete" onClick={()=>onDelete(row.id)}><IconTrash /></IconBtn>}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/* Icon button + inline icons */
function IconBtn({label, onClick, children}:{label:string; onClick?:()=>void; children:React.ReactNode}) {
  return <button type="button" className="icon-btn" title={label} aria-label={label} onClick={onClick}>{children}</button>;
}
function IconPencil(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" strokeWidth="1.8"/></svg>)}
function IconTrash(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18" strokeWidth="1.8"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeWidth="1.8"/><path d="M10 11v6M14 11v6" strokeWidth="1.8"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" strokeWidth="1.8"/></svg>)}
function IconCheck(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5" strokeWidth="1.8"/></svg>)}
function IconX(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12" strokeWidth="1.8"/></svg>)}
