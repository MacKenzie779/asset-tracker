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
import { useI18n } from '../../hooks/useI18n';
import type { Account, AccountType } from '../../types';

type Draft = { name: string; balance: string; color: string };

export default function AccountsTab({ filter, sort }: { filter: string; sort: AccountSort }) {
  const data = useData();
  const shell = useShell();
  const toast = useToast();
  const { t, tn } = useI18n();
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
      toast.success(addKind === 'person' ? t('acc.addedPerson') : t('acc.addedAccount'), { description: name });
      setAdd((d) => ({ ...d, name: '', balance: '' }));
      afterMutation();
      addNameRef.current?.focus();
    } catch (e) {
      toast.error(t('acc.createFailed'), { description: errorMessage(e) });
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
        await addTransaction({ account_id: a.id, date: parseDateDEToISO(todayDE())!, amount: diff, category: 'Korrektur', description: t('acc.balanceCorrection') });
      }
      toast.success(a.type === 'person' ? t('acc.updatedPerson') : t('acc.updatedAccount'), { description: Math.abs(diff) > 0.005 ? t('acc.correctionBooked', { amount: formatDecimalDE(diff, { grouping: true }) }) : undefined });
      setEditingId(null);
      afterMutation();
    } catch (e) {
      toast.error(t('acc.saveFailed'), { description: errorMessage(e) });
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
      toast.success(a?.type === 'person' ? t('acc.deletedPerson') : t('acc.deletedAccount'), { description: a?.name });
      setPendingDelete(null);
      afterMutation();
    } catch (e) {
      toast.error(t('acc.deleteFailed'), { description: errorMessage(e) });
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
            <input ref={editNameRef} className="t-in is-editing" style={{ borderColor: 'var(--accent)' }} value={draft.name} aria-label={t('field.name')} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} onKeyDown={editKeys} />
            <input className="t-in w-bal" inputMode="decimal" value={draft.balance} aria-label={t('field.balance')} title={t('acc.balanceTitle')} onChange={(e) => setDraft((d) => ({ ...d, balance: e.target.value }))} onKeyDown={editKeys} />
          </div>
          <div className="t-frow" style={{ gap: 8 }}>
            <ColorPicker value={draft.color} onChange={(c) => setDraft((d) => ({ ...d, color: c }))} />
            <div className="t-spacer" />
            <button type="button" className="t-btn t-btn--primary t-btn--sm" onClick={() => void submitEdit()} disabled={busy || !draft.name.trim()}>{t('action.saveEnter')}</button>
            <button type="button" className="t-btn t-btn--secondary t-btn--sm" onClick={() => setEditingId(null)} disabled={busy}>{t('action.esc')}</button>
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
          <span className="c">{isPerson ? t('acc.openCount', { n: openCounts.get(a.id) ?? 0 }) : t('acc.txCount', { n })}</span>
          <span className="v">
            {isPerson ? <Money value={a.balance} hidden={hidden} /> : <Money value={a.balance} hidden={hidden} sign="neg" tone={a.balance < -0.005 ? 'neg' : 'none'} />}
          </span>
          <button type="button" className="t-edit-btn" aria-label={t('acc.editAria', { name: a.name })} title={t('action.editTitle')} onClick={() => beginEdit(a)}>✎</button>
          <button type="button" className="t-del-btn" aria-label={t('acc.deleteAria', { name: a.name })} title={t('action.deleteTitle')} onClick={() => { setEditingId(null); setPendingDelete(a.id); }}>⌫</button>
        </div>
        {pendingDelete === a.id && (
          <div className="t-confirm" role="alertdialog" aria-label={t('confirm.deleteAria', { name: a.name })}>
            <div className="h">{t('confirm.deleteHead', { name: a.name })}</div>
            <div className="b">
              {n > 0
                ? tn(isPerson ? 'acc.deleteBlockedPerson' : 'acc.deleteBlockedAccount', n)
                : t('acc.deleteFree')}
            </div>
            <div className="a">
              <button type="button" className="t-btn t-btn--danger t-btn--sm" onClick={() => void confirmDelete()} disabled={busy || n > 0}>{t('action.delete')}</button>
              <button type="button" className="t-btn t-btn--secondary t-btn--sm" onClick={() => setPendingDelete(null)} disabled={busy}>{t('action.keep')}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="t-addblock">
        <div className="t-joined t-joined--wide" role="radiogroup" aria-label={t('acc.typeAria')} style={{ marginBottom: 7 }}>
          <button type="button" role="radio" aria-checked={addKind === 'standard'} className={clsx('t-jseg', addKind === 'standard' && 'is-active')} onClick={() => setAddKind('standard')}>{t('acc.typeAccount')}</button>
          <button type="button" role="radio" aria-checked={addKind === 'person'} className={clsx('t-jseg', addKind === 'person' && 'is-active')} onClick={() => setAddKind('person')}>{t('acc.typePerson')}</button>
        </div>
        <div className="t-frow">
          <input ref={addNameRef} className="t-in" placeholder={addKind === 'person' ? t('acc.namePlaceholderPerson') : t('acc.namePlaceholderAccount')} aria-label={t('field.name')} value={add.name} onChange={(e) => setAdd((d) => ({ ...d, name: e.target.value }))} onKeyDown={addKeys} />
          <input className="t-in w-bal" inputMode="decimal" placeholder="0,00" aria-label={addKind === 'person' ? t('acc.balanceAriaPerson') : t('acc.balanceAriaAccount')} title={addKind === 'person' ? t('acc.balanceTitlePerson') : t('acc.balanceTitleAccount')} value={add.balance} onChange={(e) => setAdd((d) => ({ ...d, balance: e.target.value }))} onKeyDown={addKeys} />
        </div>
        <div className="t-frow" style={{ gap: 8 }}>
          <ColorPicker value={add.color} onChange={(c) => setAdd((d) => ({ ...d, color: c }))} />
          <div className="t-spacer" />
          <button type="button" className="t-btn t-btn--primary t-btn--sm" onClick={() => void submitAdd()} disabled={busy || !add.name.trim()}>{t('action.addEnter')}</button>
        </div>
      </div>

      <div className="t-sec t-sec--mgmt">
        <span className="t-label">{t('acc.yourAccounts', { n: accounts.length })}</span>
        <div className="t-sec-rule" />
        <span className="t-sec-meta">{t('acc.sortMeta', { sort: sort === 'name' ? t('sort.name') : t('sort.value') })}</span>
      </div>
      <div className="t-pad">
        {accounts.length === 0 && <div className="t-none">{q ? t('acc.noAccountMatch') : t('ledger.noAccounts')}</div>}
        {accounts.map(renderRow)}
      </div>

      <div className="t-sec t-sec--mgmt">
        <span className="t-label">{t('ledger.peopleCount', { n: people.length })}</span>
        <div className="t-sec-rule" />
        <span className="t-sec-meta">{t('acc.settleFromLedger')}</span>
      </div>
      <div className="t-pad">
        {people.length === 0 && <div className="t-none">{q ? t('acc.noPersonMatch') : t('acc.noPeople')}</div>}
        {people.map(renderRow)}
      </div>

      <div className="t-spacer" style={{ minHeight: 12 }} />
      <div className="t-footnote">{t('acc.footnote')}</div>
    </>
  );
}
