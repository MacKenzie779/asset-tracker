// ACCOUNTS tab (4b): accounts and people share one UI. Add block on top,
// in-place edit state, inline delete confirmation, footer note.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import ColorPicker, { ENTITY_COLORS } from './ColorPicker';
import Money from './Money';
import type { AccountSort } from './Ledger';
import { sortAccounts } from './LedgerTab';
import { useToast } from '../Toast';
import { addAccount, addTransaction, deleteAccount, updateAccount } from '../../lib/api';
import { countByAccount } from '../../lib/analytics';
import { afterMutation, useData } from '../../lib/data';
import { errorMessage } from '../../lib/errors';
import { todayDE, parseDateDEToISO } from '../../lib/format';
import { formatDecimalDE, parseDecimal } from '../../lib/number';
import { computeOpenItems } from '../../lib/settlement';
import { useShell } from '../../lib/shell';
import type { Account, AccountType } from '../../types';

type Draft = { name: string; balance: string; color: string };

export default function AccountsTab({ filter, sort }: { filter: string; sort: AccountSort }) {
  const data = useData();
  const shell = useShell();
  const toast = useToast();
  const { hidden } = shell;

  const [addKind, setAddKind] = useState<AccountType>('standard');
  const [add, setAdd] = useState<Draft>({ name: '', balance: '', color: ENTITY_COLORS[1] });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', balance: '', color: ENTITY_COLORS[0] });
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const addNameRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);

  const beginEdit = (a: Account) => {
    setPendingDelete(null);
    setEditingId(a.id);
    setDraft({ name: a.name, balance: formatDecimalDE(a.balance, { grouping: true }), color: a.color || ENTITY_COLORS[0] });
    window.setTimeout(() => { editNameRef.current?.focus(); editNameRef.current?.select(); }, 0);
  };

  // Requests from the LEDGER tab (+ ACCOUNT, ⋯ menu) and ⌘, land here.
  useEffect(() => {
    const it = shell.ledgerIntent;
    if (!it) return;
    if (it.kind === 'add') {
      setAddKind(it.type === 'person' ? 'person' : 'standard');
      setEditingId(null);
      setPendingDelete(null);
      window.setTimeout(() => addNameRef.current?.focus(), 0);
    } else if (it.kind === 'edit') {
      const a = data.accountById.get(it.id);
      if (a) beginEdit(a);
    } else if (it.kind === 'delete') {
      setEditingId(null);
      setPendingDelete(it.id);
    }
    shell.consumeLedgerIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.ledgerIntent]);

  const counts = useMemo(() => countByAccount(data.txAll), [data.txAll]);
  const openCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of data.people) m.set(p.id, computeOpenItems(data.txAll.filter((t) => t.account_id === p.id), p.balance).items.length);
    return m;
  }, [data.txAll, data.people]);

  const q = filter.trim().toLowerCase();
  const match = (a: Account) => !q || a.name.toLowerCase().includes(q);
  const accounts = useMemo(() => sortAccounts(data.standardAccounts, sort).filter(match), [data.standardAccounts, sort, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = useMemo(() => sortAccounts(data.people, sort).filter(match), [data.people, sort, q]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- writes ---- */
  const submitAdd = async () => {
    const name = add.name.trim();
    const bal = add.balance.trim() === '' ? 0 : parseDecimal(add.balance);
    if (!name || bal === null || busy) return;
    setBusy(true);
    try {
      await addAccount({ name, color: add.color, account_type: addKind, initial_balance: bal });
      toast.success(addKind === 'person' ? 'Person added' : 'Account created', { description: name });
      setAdd((d) => ({ ...d, name: '', balance: '' }));
      afterMutation();
      addNameRef.current?.focus();
    } catch (e) {
      toast.error('Could not create', { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (editingId == null || busy) return;
    const a = data.accountById.get(editingId);
    if (!a) { setEditingId(null); return; }
    const name = draft.name.trim();
    const bal = draft.balance.trim() === '' ? a.balance : parseDecimal(draft.balance);
    if (!name || bal === null) return;
    setBusy(true);
    try {
      if (name !== a.name || draft.color !== (a.color || '')) await updateAccount({ id: a.id, name, color: draft.color });
      const diff = bal - a.balance;
      if (Math.abs(diff) > 0.005) {
        // The balance is the sum of transactions, so a changed balance is booked as a correction entry.
        await addTransaction({ account_id: a.id, date: parseDateDEToISO(todayDE())!, amount: diff, category: 'Korrektur', description: 'Balance correction' });
      }
      toast.success(a.type === 'person' ? 'Person updated' : 'Account updated', { description: Math.abs(diff) > 0.005 ? `Correction of ${formatDecimalDE(diff, { grouping: true })} booked` : undefined });
      setEditingId(null);
      afterMutation();
    } catch (e) {
      toast.error('Could not save', { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (pendingDelete == null || busy) return;
    const a = data.accountById.get(pendingDelete);
    setBusy(true);
    try {
      await deleteAccount(pendingDelete);
      toast.success(a?.type === 'person' ? 'Person deleted' : 'Account deleted', { description: a?.name });
      setPendingDelete(null);
      afterMutation();
    } catch (e) {
      toast.error('Could not delete', { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const addKeys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); void submitAdd(); } };
  const editKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
  };

  const renderRow = (a: Account) => {
    const isPerson = a.type === 'person';
    if (editingId === a.id) {
      return (
        <div key={a.id} className="t-edit">
          <div className="t-frow">
            <input ref={editNameRef} className="t-in is-editing" style={{ borderColor: 'var(--accent)' }} value={draft.name} aria-label="Name" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} onKeyDown={editKeys} />
            <input className="t-in w-bal" inputMode="decimal" value={draft.balance} aria-label="Balance" title="Changing the balance books a correction entry" onChange={(e) => setDraft((d) => ({ ...d, balance: e.target.value }))} onKeyDown={editKeys} />
          </div>
          <div className="t-frow" style={{ gap: 8 }}>
            <ColorPicker value={draft.color} onChange={(c) => setDraft((d) => ({ ...d, color: c }))} />
            <div className="t-spacer" />
            <button type="button" className="t-btn t-btn--primary t-btn--sm" onClick={() => void submitEdit()} disabled={busy || !draft.name.trim()}>SAVE ⏎</button>
            <button type="button" className="t-btn t-btn--secondary t-btn--sm" onClick={() => setEditingId(null)} disabled={busy}>ESC</button>
          </div>
        </div>
      );
    }
    const n = counts.get(a.id) ?? 0;
    return (
      <div key={a.id}>
        <div className="t-mrow">
          <span className="t-dot t-dot--7" style={{ background: a.color || '#6b7280' }} aria-hidden="true" />
          <span className="n" title={a.name}>{a.name}</span>
          <span className="c">{isPerson ? `${openCounts.get(a.id) ?? 0} open` : `${n} tx`}</span>
          <span className="v">
            {isPerson ? <Money value={a.balance} hidden={hidden} /> : <Money value={a.balance} hidden={hidden} sign="neg" tone={a.balance < -0.005 ? 'neg' : 'none'} />}
          </span>
          <button type="button" className="t-edit-btn" aria-label={`Edit ${a.name}`} title="Edit" onClick={() => beginEdit(a)}>✎</button>
          <button type="button" className="t-del-btn" aria-label={`Delete ${a.name}`} title="Delete" onClick={() => { setEditingId(null); setPendingDelete(a.id); }}>⌫</button>
        </div>
        {pendingDelete === a.id && (
          <div className="t-confirm" role="alertdialog" aria-label={`Delete ${a.name}?`}>
            <div className="h">Delete “{a.name}”?</div>
            <div className="b">
              {n > 0
                ? `${n} transaction${n === 1 ? '' : 's'} reference${n === 1 ? 's' : ''} it. Move or delete them first — a${isPerson ? ' person' : 'n account'} with transactions cannot be deleted.`
                : 'No transactions reference it.'}
            </div>
            <div className="a">
              <button type="button" className="t-btn t-btn--danger t-btn--sm" onClick={() => void confirmDelete()} disabled={busy || n > 0}>DELETE</button>
              <button type="button" className="t-btn t-btn--secondary t-btn--sm" onClick={() => setPendingDelete(null)} disabled={busy}>KEEP</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="t-addblock">
        <div className="t-joined t-joined--wide" role="radiogroup" aria-label="Type" style={{ marginBottom: 7 }}>
          <button type="button" role="radio" aria-checked={addKind === 'standard'} className={clsx('t-jseg', addKind === 'standard' && 'is-active')} onClick={() => setAddKind('standard')}>ACCOUNT</button>
          <button type="button" role="radio" aria-checked={addKind === 'person'} className={clsx('t-jseg', addKind === 'person' && 'is-active')} onClick={() => setAddKind('person')}>PERSON</button>
        </div>
        <div className="t-frow">
          <input ref={addNameRef} className="t-in" placeholder={addKind === 'person' ? 'name' : 'account name'} aria-label="Name" value={add.name} onChange={(e) => setAdd((d) => ({ ...d, name: e.target.value }))} onKeyDown={addKeys} />
          <input className="t-in w-bal" inputMode="decimal" placeholder="0,00" aria-label={addKind === 'person' ? 'Current balance (positive if they owe you)' : 'Opening balance'} title={addKind === 'person' ? 'Positive if they already owe you, negative if you owe them' : 'Opening balance, booked as an initial entry'} value={add.balance} onChange={(e) => setAdd((d) => ({ ...d, balance: e.target.value }))} onKeyDown={addKeys} />
        </div>
        <div className="t-frow" style={{ gap: 8 }}>
          <ColorPicker value={add.color} onChange={(c) => setAdd((d) => ({ ...d, color: c }))} />
          <div className="t-spacer" />
          <button type="button" className="t-btn t-btn--primary t-btn--sm" onClick={() => void submitAdd()} disabled={busy || !add.name.trim()}>ADD ⏎</button>
        </div>
      </div>

      <div className="t-sec t-sec--mgmt">
        <span className="t-label">YOUR ACCOUNTS · {accounts.length}</span>
        <div className="t-sec-rule" />
        <span className="t-sec-meta">SORT: {sort.toUpperCase()}</span>
      </div>
      <div className="t-pad">
        {accounts.length === 0 && <div className="t-none">{q ? 'No account matches.' : 'No accounts yet.'}</div>}
        {accounts.map(renderRow)}
      </div>

      <div className="t-sec t-sec--mgmt">
        <span className="t-label">PEOPLE · {people.length}</span>
        <div className="t-sec-rule" />
        <span className="t-sec-meta">SETTLE FROM LEDGER</span>
      </div>
      <div className="t-pad">
        {people.length === 0 && <div className="t-none">{q ? 'No person matches.' : 'No people yet.'}</div>}
        {people.map(renderRow)}
      </div>

      <div className="t-spacer" style={{ minHeight: 12 }} />
      <div className="t-footnote">A person is an account you settle up with — same fields, same actions. A positive balance means they owe you. Changing a balance books a correction entry.</div>
    </>
  );
}
