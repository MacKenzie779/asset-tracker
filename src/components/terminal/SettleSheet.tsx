// ⌘S: right-hand sheet listing a person's open items, oldest first, with a
// target amount, booking (a Transfer between the person and one of your
// accounts) and the settlement statement export.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Money from './Money';
import Typeahead, { type TAItem } from './Typeahead';
import { useOverlayOpen } from '../Modal';
import { useToast } from '../Toast';
import { addTransfer, exportSettlementReportPdf, exportSettlementReportXlsx } from '../../lib/api';
import { afterMutation, useData } from '../../lib/data';
import { errorMessage } from '../../lib/errors';
import { readExportConfig } from '../../lib/exportConfig';
import { formatDate, formatDayMonth, todayDE, parseDateDEToISO } from '../../lib/format';
import { formatAbs, parseDecimal } from '../../lib/number';
import { computeOpenItems, selectByTarget } from '../../lib/settlement';
import { useShell } from '../../lib/shell';
import { useExportFeedback } from '../../hooks/useExportFeedback';
import { readLastAccount } from './CommandPalette';

const SETTLE_ACCOUNT_KEY = 'assettracker.settleAccount';

export default function SettleSheet() {
  const shell = useShell();
  const { open, personId } = shell.settle;
  useOverlayOpen(open);
  if (!open) return null;
  return <Sheet personId={personId} onPick={(id) => shell.openSettle(id)} onClose={shell.closeSettle} />;
}

function Sheet({ personId, onPick, onClose }: { personId: number | null; onPick: (id: number) => void; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const notifySaved = useExportFeedback();
  const { hidden } = useShell();
  const person = personId != null ? data.accountById.get(personId) ?? null : null;
  const people = data.people;

  const openItems = useMemo(() => {
    if (!person) return null;
    return computeOpenItems(data.txAll.filter((t) => t.account_id === person.id), person.balance);
  }, [data.txAll, person]);

  const [checked, setChecked] = useState<Map<number, number>>(new Map());
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountText, setAccountText] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  // reset when the person (or the data) changes: everything checked, no target
  useEffect(() => {
    if (!openItems) return;
    setChecked(new Map(openItems.items.map((o) => [o.tx.id, o.remaining])));
    setTarget('');
  }, [openItems]);

  // default settle account: last used here, else last quick-entry account, else the first account
  useEffect(() => {
    let id: number | null = null;
    try { id = Number(localStorage.getItem(SETTLE_ACCOUNT_KEY)) || null; } catch {}
    id = id ?? readLastAccount();
    const acc = data.standardAccounts.find((a) => a.id === id) ?? data.standardAccounts[0] ?? null;
    setAccountId(acc?.id ?? null);
    setAccountText(acc?.name ?? '');
  }, [data.standardAccounts]);

  useEffect(() => {
    const t = window.setTimeout(() => targetRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [person?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = openItems?.items ?? [];
  const theyOwe = openItems?.theyOwe ?? true;
  const sum = Array.from(checked.values()).reduce((s, v) => s + v, 0);
  const oldest = items[0]?.tx.date;
  const cfg = readExportConfig();

  const applyTarget = (raw: string) => {
    setTarget(raw);
    const v = parseDecimal(raw);
    if (v !== null && v > 0) setChecked(selectByTarget(items, v));
    else if (raw.trim() === '') setChecked(new Map(items.map((o) => [o.tx.id, o.remaining])));
  };
  const toggle = (id: number, remaining: number) => {
    setTarget('');
    setChecked((m) => {
      const n = new Map(m);
      if (n.has(id)) n.delete(id);
      else n.set(id, remaining);
      return n;
    });
  };

  const book = async () => {
    if (!person || !accountId || sum <= 0.005 || busy) return;
    setBusy(true);
    try {
      const from = theyOwe ? person.id : accountId;
      const to = theyOwe ? accountId : person.id;
      await addTransfer({ from_account_id: from, to_account_id: to, date: parseDateDEToISO(todayDE())!, amount: sum, description: `Settlement ${person.name}`, category: null });
      try { localStorage.setItem(SETTLE_ACCOUNT_KEY, String(accountId)); } catch {}
      toast.success('Settlement booked', { description: `${formatAbs(sum)} € · ${person.name} ↔ ${data.accountById.get(accountId)?.name ?? ''}` });
      afterMutation();
      onClose();
    } catch (e) {
      toast.error('Could not book the settlement', { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const exportStatement = async () => {
    if (!person || busy) return;
    setBusy(true);
    try {
      const t = parseDecimal(target);
      const tv = t !== null && t > 0 ? t : undefined;
      const filters = { account_id: person.id, tx_type: 'all' as const };
      const cols = cfg.columns.length ? cfg.columns : undefined;
      const path = cfg.format === 'pdf' ? await exportSettlementReportPdf(filters, cols, tv) : await exportSettlementReportXlsx(filters, cols, tv);
      notifySaved(path);
    } catch (e) {
      toast.error('Statement export failed', { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const accountItems: TAItem[] = data.standardAccounts.map((a) => ({ id: String(a.id), label: a.name, color: a.color ?? null }));

  return (
    <div className="t-scrim t-scrim--right" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="t-sheet" role="dialog" aria-modal="true" aria-label="Settle up">
        <div className="t-sheet-head">
          {person && <span className="t-dot t-dot--7" style={{ background: person.color ?? '#6b7280' }} />}
          <span className="h">{person ? `Settle up — ${person.name}` : 'Settle up'}</span>
          <div className="t-spacer" />
          <button type="button" className="esc" onClick={onClose}>ESC</button>
        </div>

        <div className="t-sheet-body">
          {!person && (
            <div className="t-sheet-block">
              <div className="t-label" style={{ marginBottom: 8 }}>CHOOSE A PERSON</div>
              {people.length === 0 && <div className="t-none">No people yet. Add one in the ledger column’s ACCOUNTS tab.</div>}
              <div className="t-pick">
                {people.map((p) => (
                  <button key={p.id} type="button" className="t-chip" onClick={() => onPick(p.id)}>
                    <span className="t-dot" style={{ background: p.color ?? '#6b7280', marginRight: 6 }} />
                    {p.name} · {formatAbs(p.balance)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {person && openItems && (
            <>
              <div className="t-sheet-block">
                <div className="t-label">{theyOwe ? `${person.name.toUpperCase()} OWES YOU` : `YOU OWE ${person.name.toUpperCase()}`}</div>
                <div className={clsx('t-sheet-big', theyOwe ? 'pos' : 'neg')}>
                  <Money value={Math.abs(person.balance)} hidden={hidden} sign="none" tone="none" /> €
                </div>
                <div className="t-sheet-sub">
                  {items.length} open item{items.length === 1 ? '' : 's'}{oldest ? ` · oldest ${formatDate(oldest)}` : ''}
                </div>
              </div>

              <div style={{ padding: '0 14px' }}>
                {items.map((o) => {
                  const on = checked.has(o.tx.id);
                  const amt = checked.get(o.tx.id) ?? o.remaining;
                  const partial = on && amt + 1e-9 < o.remaining;
                  return (
                    <button key={o.tx.id} type="button" className={clsx('t-item-row', on && 'is-on')} onClick={() => toggle(o.tx.id, o.remaining)} aria-pressed={on}>
                      <span className="t-check" aria-hidden="true">✓</span>
                      <span className="d">{formatDayMonth(o.tx.date)}</span>
                      <span className="n t-truncate">{o.tx.description || o.tx.category || '—'}{partial ? ' (partial)' : ''}</span>
                      <span className="v"><Money value={amt} hidden={hidden} sign="none" tone="none" /></span>
                    </button>
                  );
                })}
                {items.length === 0 && <div className="t-none">Nothing open. {Math.abs(person.balance) > 0.005 ? 'The balance comes from entries before the last full settlement.' : ''}</div>}
              </div>

              <div className="t-sheet-block">
                <div className="t-label" style={{ marginBottom: 6 }}>TARGET AMOUNT</div>
                <input
                  ref={targetRef}
                  className="t-in t-in--big"
                  inputMode="decimal"
                  placeholder={formatAbs(openItems.total)}
                  aria-label="Target amount"
                  value={target}
                  onChange={(e) => applyTarget(e.target.value)}
                />
                <div className="t-help" style={{ fontSize: 9.5 }}>Selects oldest items first until the target is reached.</div>
              </div>

              <div className="t-sheet-block" style={{ paddingTop: 0 }}>
                <div className="t-label" style={{ marginBottom: 6 }}>{theyOwe ? 'RECEIVE ON' : 'PAY FROM'}</div>
                <Typeahead
                  items={accountItems}
                  value={accountText}
                  onChange={setAccountText}
                  onPick={(it) => setAccountId(Number(it.id))}
                  strict
                  placeholder="account*"
                  ariaLabel={theyOwe ? 'Account that receives the money' : 'Account that pays'}
                  className="w-full"
                />
                <div className="t-help" style={{ fontSize: 9.5 }}>Booked as a transfer dated today; the person’s balance drops by the booked amount.</div>
              </div>
            </>
          )}
        </div>

        {person && (
          <div className="t-sheet-foot">
            <button type="button" className="t-btn t-btn--positive t-btn--wide" onClick={() => void book()} disabled={busy || sum <= 0.005 || !accountId}>
              BOOK SETTLEMENT{sum > 0.005 ? ` · ${formatAbs(sum)}` : ''}
            </button>
            <button type="button" className="t-btn t-btn--secondary" onClick={() => void exportStatement()} disabled={busy} title="Export the settlement statement">
              {cfg.format.toUpperCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
