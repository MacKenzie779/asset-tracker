// Quick entry strip, docked under the blotter header. Enter from any field
// commits; required fields are category, amount, account. IN / OUT may name a
// person under "paid for" (their share moves to them as a linked transfer);
// TRF writes a linked pair between two accounts.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import DateField from './DateField';
import Typeahead from './Typeahead';
import { LAST_ACCOUNT_KEY } from './CommandPalette';
import { useToast } from '../Toast';
import { useData } from '../../lib/data';
import { errorMessage } from '../../lib/errors';
import { todayISO, parseDateDEToISO } from '../../lib/format';
import { formatAbs, formatDecimalDE, parseDecimal } from '../../lib/number';
import { useBus } from '../../hooks/useBus';
import { useI18n } from '../../hooks/useI18n';
import type { CommitPlan } from '../../pages/Terminal';
import type { QuickEntryPrefill } from '../../lib/bus';

type Direction = 'in' | 'out' | 'trf';
const DIR_KEY = 'tx:lastType';
const DIRS: { value: Direction; labelKey: 'qe.dirIn' | 'qe.dirTrf' | 'qe.dirOut'; titleKey: 'type.income' | 'type.transfer' | 'type.expense' }[] = [
  { value: 'in', labelKey: 'qe.dirIn', titleKey: 'type.income' },
  { value: 'trf', labelKey: 'qe.dirTrf', titleKey: 'type.transfer' },
  { value: 'out', labelKey: 'qe.dirOut', titleKey: 'type.expense' },
];

function readDir(): Direction {
  try {
    const s = localStorage.getItem(DIR_KEY);
    return s === 'income' ? 'in' : s === 'transfer' ? 'trf' : 'out';
  } catch { return 'out'; }
}

export default function QuickEntry({ onCommit }: { onCommit: (plan: CommitPlan) => Promise<void> }) {
  const data = useData();
  const toast = useToast();
  const { t } = useI18n();
  const [dir, setDir] = useState<Direction>(readDir);
  useEffect(() => { try { localStorage.setItem(DIR_KEY, dir === 'in' ? 'income' : dir === 'trf' ? 'transfer' : 'expense'); } catch {} }, [dir]);

  const [dateISO, setDateISO] = useState(todayISO);
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [accText, setAccText] = useState('');
  const [accId, setAccId] = useState<number | null>(null);
  const [paidText, setPaidText] = useState('');
  const [paidId, setPaidId] = useState<number | null>(null);
  const [shareStr, setShareStr] = useState('');
  const [dstText, setDstText] = useState('');
  const [dstId, setDstId] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLInputElement>(null);

  const focusAmount = useCallback(() => { amountRef.current?.focus(); amountRef.current?.select(); }, []);
  useBus('focus:quick-entry', focusAmount);
  useBus('quick-entry:prefill', (p: QuickEntryPrefill) => {
    if (p.direction) setDir(p.direction);
    if (p.date) { const d = parseDateDEToISO(p.date); if (d) setDateISO(d); }
    if (p.category !== undefined) setCategory(p.category);
    if (p.notes !== undefined) setNotes(p.notes);
    if (p.amount !== undefined) setAmountStr(formatDecimalDE(p.amount));
    if (p.accountId !== undefined) {
      const a = data.accountById.get(p.accountId);
      setAccId(a ? a.id : null);
      setAccText(a?.name ?? '');
    }
    if (p.personId !== undefined) {
      const a = data.accountById.get(p.personId);
      setPaidId(a ? a.id : null);
      setPaidText(a?.name ?? '');
    }
    setShowErrors(false);
    window.setTimeout(() => {
      const target = p.focus === 'category' ? categoryRef.current : p.focus === 'account' ? accountRef.current : amountRef.current;
      target?.focus();
      target?.select();
    }, 0);
  });

  const isTrf = dir === 'trf';
  const iso = dateISO || null;
  const amt = parseDecimal(amountStr);
  const share = parseDecimal(shareStr);
  const dateInvalid = !iso;
  const amountInvalid = amt === null || Math.abs(amt) < 0.005;
  const catMissing = !isTrf && category.trim() === '';
  const accMissing = accId == null;
  const dstInvalid = isTrf && (dstId == null || dstId === accId);
  const hasPaid = !isTrf && paidId != null;
  const paidInvalid = hasPaid && paidId === accId;
  const shareInvalid = hasPaid && shareStr.trim() !== '' && (share === null || share <= 0 || (amt !== null && share > Math.abs(amt) + 1e-9));
  const canSubmit = !dateInvalid && !amountInvalid && !catMissing && !accMissing && !dstInvalid && !paidInvalid && !shareInvalid;
  const flag = (c: boolean) => showErrors && c;

  const reset = () => {
    setDateISO(todayISO()); setCategory(''); setNotes(''); setAmountStr('');
    setAccText(''); setAccId(null); setPaidText(''); setPaidId(null); setShareStr(''); setDstText(''); setDstId(null);
    setShowErrors(false);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!canSubmit || !iso || amt === null) {
      setShowErrors(true);
      if (amountInvalid) focusAmount();
      else if (catMissing) categoryRef.current?.focus();
      else if (accMissing) accountRef.current?.focus();
      return;
    }
    const total = Math.abs(amt);
    const desc = notes.trim() || null;
    const cat = category.trim();
    const name = (id: number | null) => (id != null ? data.accountById.get(id)?.name ?? '' : '');
    const plan: CommitPlan = { label: '', steps: [] };
    if (isTrf) {
      plan.steps.push({ kind: 'transfer', input: { from_account_id: accId!, to_account_id: dstId!, date: iso, amount: total, description: desc, category: cat || null } });
      plan.label = t('commit.transfer');
      plan.description = `${formatAbs(total)} € · ${name(accId)} → ${name(dstId)}`;
    } else {
      const theirs = hasPaid ? (shareStr.trim() === '' ? total : (share as number)) : 0;
      const own = total - theirs;
      const sign = dir === 'out' ? -1 : 1;
      if (own > 1e-9) plan.steps.push({ kind: 'tx', input: { account_id: accId!, date: iso, description: desc, amount: sign * own, category: cat } });
      if (theirs > 1e-9) {
        // Expense: their share moves from your account to the person (they owe you).
        // Income: their share of what you received moves from the person to your account (you owe them).
        const from = dir === 'out' ? accId! : paidId!;
        const to = dir === 'out' ? paidId! : accId!;
        plan.steps.push({ kind: 'transfer', input: { from_account_id: from, to_account_id: to, date: iso, amount: theirs, description: desc, category: cat } });
      }
      plan.label = dir === 'out' ? t('commit.expense') : t('commit.income');
      plan.description = hasPaid
        ? own > 1e-9
          ? t('commit.splitBoth', { own: formatAbs(own), theirs: formatAbs(theirs), name: name(paidId) })
          : t('commit.splitAll', { theirs: formatAbs(theirs), name: name(paidId) })
        : `${formatAbs(total)} € · ${cat} · ${name(accId)}`;
    }
    setBusy(true);
    try {
      await onCommit(plan);
      try { if (accId != null && data.accountById.get(accId)?.type !== 'person') localStorage.setItem(LAST_ACCOUNT_KEY, String(accId)); } catch {}
      reset();
      focusAmount();
    } catch (err) {
      toast.error(t('commit.failed'), { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void submit(); }
  };

  const categoryItems = useMemo(() => data.categories.map((c) => ({ id: String(c.id), label: c.name })), [data.categories]);
  const accountItems = useMemo(() => data.accounts.map((a) => ({ id: String(a.id), label: a.name, color: a.color ?? null })), [data.accounts]);
  const peopleItems = useMemo(() => data.people.map((a) => ({ id: String(a.id), label: a.name, color: a.color ?? null })), [data.people]);

  return (
    <form className="t-qe" onSubmit={submit} aria-label={t('qe.aria')} noValidate>
      <div className="t-dir" role="radiogroup" aria-label={t('qe.direction')}>
        {DIRS.map((d) => (
          <button key={d.value} type="button" role="radio" aria-checked={dir === d.value} title={t(d.titleKey)} className={clsx('t-dseg', d.value, dir === d.value && 'is-active')} onClick={() => setDir(d.value)}>
            {t(d.labelKey)}
          </button>
        ))}
      </div>
      <DateField className="w-date" value={dateISO} onChange={setDateISO} ariaLabel={t('field.date')} invalid={flag(dateInvalid)} onKeyDown={onKey} />
      <Typeahead
        inputRef={categoryRef}
        items={categoryItems}
        value={category}
        onChange={setCategory}
        placeholder={isTrf ? t('field.categoryPlaceholder') : t('qe.categoryRequired')}
        ariaLabel={t('field.category')}
        className="w-cat"
        invalid={flag(catMissing)}
        onKeyDown={onKey}
        createHint
      />
      <input className="t-in w-notes" value={notes} aria-label={t('field.notes')} placeholder={t('field.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} onKeyDown={onKey} />
      <input
        ref={amountRef}
        className={clsx('t-in t-in--amount w-amt', flag(amountInvalid) && 'is-invalid')}
        inputMode="decimal"
        value={amountStr}
        aria-label={t('field.amount')}
        placeholder={t('qe.amountPlaceholder')}
        onChange={(e) => setAmountStr(e.target.value)}
        onKeyDown={onKey}
      />
      <Typeahead
        inputRef={accountRef}
        items={accountItems}
        value={accText}
        onChange={(t) => { setAccText(t); if (t.trim() === '') setAccId(null); }}
        onPick={(it) => setAccId(Number(it.id))}
        strict
        placeholder={isTrf ? t('qe.from') : t('qe.accountRequired')}
        ariaLabel={isTrf ? t('qe.sourceAccount') : t('blotter.account')}
        className="w-acc"
        invalid={flag(accMissing || paidInvalid)}
        onKeyDown={onKey}
      />
      {isTrf ? (
        <Typeahead
          items={accountItems}
          value={dstText}
          onChange={(t) => { setDstText(t); if (t.trim() === '') setDstId(null); }}
          onPick={(it) => setDstId(Number(it.id))}
          strict
          placeholder={t('qe.to')}
          ariaLabel={t('qe.destAccount')}
          className="w-acc"
          invalid={flag(dstInvalid)}
          onKeyDown={onKey}
        />
      ) : (
        <>
          <Typeahead
            items={peopleItems}
            value={paidText}
            onChange={(t) => { setPaidText(t); if (t.trim() === '') { setPaidId(null); setShareStr(''); } }}
            onPick={(it) => setPaidId(Number(it.id))}
            strict
            placeholder={dir === 'out' ? t('qe.paidFor') : t('qe.sharedWith')}
            ariaLabel={dir === 'out' ? t('qe.paidForAria') : t('qe.sharedWithAria')}
            className="w-paid"
            invalid={flag(paidInvalid)}
            onKeyDown={onKey}
            emptyText={t('qe.noPeople')}
          />
          {hasPaid && (
            <input
              className={clsx('t-in t-in--right w-share', flag(shareInvalid) && 'is-invalid')}
              inputMode="decimal"
              value={shareStr}
              aria-label={t('qe.shareAria')}
              title={t('qe.shareTitle')}
              placeholder={t('qe.sharePlaceholder')}
              onChange={(e) => setShareStr(e.target.value)}
              onKeyDown={onKey}
            />
          )}
        </>
      )}
      <button type="submit" className="t-btn t-btn--primary" disabled={busy} title={t('qe.commitTitle')}>{t('qe.commit')}</button>
    </form>
  );
}
