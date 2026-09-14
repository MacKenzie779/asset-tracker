import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Money from './Money';
import MoreMenu from './MoreMenu';
import Sparkline from './Sparkline';
import type { AccountSort } from './Ledger';
import { useToast } from '../Toast';
import { exportTransactionsPdf, exportTransactionsXlsx } from '../../lib/api';
import { flowSeries, lastMonthKeys, netThisMonth, netWorthSeries, pctChange, savingsRate } from '../../lib/analytics';
import { useData } from '../../lib/data';
import { errorMessage } from '../../lib/errors';
import { EXPORT_COLUMNS, readExportConfig, writeExportConfig, type ExportConfig } from '../../lib/exportConfig';
import type { TKey } from '../../lib/i18n';
import { formatPercent } from '../../lib/number';
import { owedToYou, personBalanceState, totalValue, youOwe } from '../../lib/people';
import { useShell } from '../../lib/shell';
import { useBus } from '../../hooks/useBus';
import { useI18n } from '../../hooks/useI18n';
import { useExportFeedback } from '../../hooks/useExportFeedback';
import type { Account, TransactionSearch } from '../../types';

export function sortAccounts(list: Account[], sort: AccountSort): Account[] {
  return [...list].sort((a, b) => (sort === 'value' ? b.balance - a.balance : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
}

export default function LedgerTab({ sort, exportPayload, exportTotal, filterAccount }: { sort: AccountSort; exportPayload: TransactionSearch; exportTotal: number; filterAccount: Account | null }) {
  const data = useData();
  const shell = useShell();
  const toast = useToast();
  const { t, tn } = useI18n();
  const notifySaved = useExportFeedback();
  const { hidden } = shell;

  /* ---- position ---- */
  const months = useMemo(() => lastMonthKeys(12), []);
  const total = totalValue(data.accounts);
  const series = useMemo(() => netWorthSeries(data.txAll, months), [data.txAll, months]);
  const change = pctChange(series);
  const net = useMemo(() => netThisMonth(data.txAll), [data.txAll]);
  const flows = useMemo(() => flowSeries(data.txAll, months), [data.txAll, months]);
  const rate = useMemo(() => savingsRate(flows.reduce((s, f) => s + f.income, 0), flows.reduce((s, f) => s + f.expense, 0)), [flows]);
  const receivable = owedToYou(data.accounts);
  const payable = youOwe(data.accounts);

  /* ---- accounts / people ---- */
  const accounts = useMemo(() => sortAccounts(data.standardAccounts, sort), [data.standardAccounts, sort]);
  const people = useMemo(() => sortAccounts(data.people, sort), [data.people, sort]);
  const positive = accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);
  const anyOpen = people.some((p) => Math.abs(p.balance) > 0.005);

  const settleTarget = () => {
    if (filterAccount?.type === 'person') return filterAccount.id;
    const open = people.filter((p) => Math.abs(p.balance) > 0.005);
    return open.length === 1 ? open[0].id : null;
  };

  /* ---- export ---- */
  const [cfg, setCfg] = useState<ExportConfig>(readExportConfig);
  useEffect(() => writeExportConfig(cfg), [cfg]);
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const noColumns = cfg.columns.length === 0;
  const canExport = exportTotal > 0 && !noColumns && exportState === 'idle';

  const runExport = async () => {
    if (!canExport) {
      if (noColumns) toast.error(t('export.noColumns'));
      return;
    }
    setExportState('busy');
    try {
      const path = cfg.format === 'pdf' ? await exportTransactionsPdf(exportPayload, cfg.columns) : await exportTransactionsXlsx(exportPayload, cfg.columns);
      notifySaved(path);
      setExportState('saved');
      window.setTimeout(() => setExportState('idle'), 2000);
    } catch (e) {
      toast.error(t('export.failed'), { description: errorMessage(e) });
      setExportState('idle');
    }
  };
  useBus('export', () => void runExport());

  const toggleCol = (key: string) =>
    setCfg((c) => ({ ...c, columns: c.columns.includes(key) ? c.columns.filter((k) => k !== key) : [...c.columns, key] }));

  return (
    <>
      <div className="t-position">
        <div className="t-label">{t('pos.label')}</div>
        <div className="t-pos-total">
          <span className="v">{data.loaded ? <Money value={total} hidden={hidden} sign="neg" tone="none" /> : '——'}</span>
          <span className="u">€</span>
        </div>
        <div className="t-spark-row">
          <Sparkline values={series} stroke={change != null && change < 0 ? 'var(--neg)' : 'var(--pos)'} />
          <span className={change != null && change < 0 ? 'neg' : 'pos'}>
            {change == null ? '— 12M' : hidden ? '••• 12M' : `${formatPercent(change, 1, true)} 12M`.replace(' %', '%')}
          </span>
        </div>
        <div className="t-kpi2">
          <div>
            <div className="l">{t('pos.netThisMonth')}</div>
            <div className="v"><Money value={net} hidden={hidden} /></div>
          </div>
          <div>
            <div className="l">{t('pos.savingsRate')}</div>
            <div className={clsx('v', rate == null ? 'ink2' : rate < 0 ? 'neg' : 'pos')}>{rate == null ? '—' : hidden ? '•••' : formatPercent(rate)}</div>
          </div>
          <div>
            <div className="l">{t('pos.receivable')}</div>
            <div className="v"><Money value={receivable} hidden={hidden} sign="none" tone={receivable > 0.005 ? 'pos' : 'none'} /></div>
          </div>
          <div>
            <div className="l">{t('pos.payable')}</div>
            <div className="v"><Money value={payable} hidden={hidden} sign="none" tone={payable > 0.005 ? 'neg' : 'none'} /></div>
          </div>
        </div>
      </div>

      <div className="t-sec t-sec--tight">
        <span className="t-label">{t('ledger.accountsCount', { n: accounts.length })}</span>
        <div className="t-sec-rule" />
        <button type="button" className="t-btn--text" onClick={() => shell.requestLedger('accounts', { kind: 'add', type: 'account' })}>{t('ledger.addAccount')}</button>
      </div>
      <div className="t-pad">
        {accounts.length === 0 && <div className="t-none">{t('ledger.noAccounts')}</div>}
        {accounts.map((a) => (
          <div key={a.id}>
            <div className="t-acc-row">
              <span className="t-dot" style={{ background: a.color || '#6b7280' }} aria-hidden="true" />
              <span className="n" title={a.name}>{a.name}</span>
              <span className="v"><Money value={a.balance} hidden={hidden} sign="neg" tone={a.balance < -0.005 ? 'neg' : 'none'} /></span>
              <MoreMenu
                label={t('menu.actionsFor', { name: a.name })}
                actions={[
                  { label: t('action.rename'), onClick: () => shell.requestLedger('accounts', { kind: 'edit', id: a.id }) },
                  { label: t('action.changeColor'), onClick: () => shell.requestLedger('accounts', { kind: 'edit', id: a.id }) },
                  { label: t('action.editBalance'), onClick: () => shell.requestLedger('accounts', { kind: 'edit', id: a.id }) },
                  { label: t('action.delete'), danger: true, onClick: () => shell.requestLedger('accounts', { kind: 'delete', id: a.id }) },
                ]}
              />
            </div>
            <div className="t-share" aria-hidden="true">
              <div style={{ width: `${positive > 0 ? Math.max(0, (a.balance / positive) * 100) : 0}%`, background: a.color || '#6b7280' }} />
            </div>
          </div>
        ))}
      </div>

      <div className="t-sec">
        <span className="t-label">{t('ledger.peopleCount', { n: people.length })}</span>
        <div className="t-sec-rule" />
        <button type="button" className="t-btn--text" onClick={() => shell.requestLedger('accounts', { kind: 'add', type: 'person' })}>{t('ledger.addPerson')}</button>
      </div>
      <div className="t-pad">
        {people.length === 0 && <div className="t-none">{t('ledger.noOpenBalances')}</div>}
        {people.map((p) => {
          const st = personBalanceState(p.balance);
          return (
            <div key={p.id} className="t-ppl-row">
              <span className="t-dot" style={{ background: p.color || '#6b7280' }} aria-hidden="true" />
              <span className="n" title={p.name}>{p.name}</span>
              <span className="d">{st === 'owes_you' ? t('people.owesYou') : st === 'you_owe' ? t('people.youOwe') : t('people.settled')}</span>
              <span className="v"><Money value={Math.abs(p.balance)} hidden={hidden} sign="none" tone={st === 'owes_you' ? 'pos' : st === 'you_owe' ? 'neg' : 'none'} /></span>
              <MoreMenu
                label={t('menu.actionsFor', { name: p.name })}
                actions={[
                  { label: t('action.settleUp'), onClick: () => shell.openSettle(p.id), disabled: st === 'settled' },
                  { label: t('action.rename'), onClick: () => shell.requestLedger('accounts', { kind: 'edit', id: p.id }) },
                  { label: t('action.changeColor'), onClick: () => shell.requestLedger('accounts', { kind: 'edit', id: p.id }) },
                  { label: t('action.delete'), danger: true, onClick: () => shell.requestLedger('accounts', { kind: 'delete', id: p.id }) },
                ]}
              />
            </div>
          );
        })}
        <div className="t-actions">
          <button type="button" className="t-btn t-btn--positive t-btn--wide" disabled={!anyOpen} onClick={() => shell.openSettle(settleTarget())} title={t('ledger.settleTitle')}>
            {t('action.settleUp')}
          </button>
          <button type="button" className="t-btn t-btn--secondary" onClick={() => shell.requestLedger('accounts', { kind: 'add', type: 'person' })}>{t('action.new')}</button>
        </div>
      </div>

      <div className="t-sec t-sec--loose">
        <span className="t-label">{t('export.section')}</span>
        <div className="t-sec-rule" />
      </div>
      <div className="t-pad">
        <div className="t-joined t-joined--raised" role="radiogroup" aria-label={t('export.formatAria')} style={{ marginBottom: 7 }}>
          {(['xlsx', 'pdf'] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={cfg.format === f} className={clsx('t-jseg', cfg.format === f && 'is-active')} onClick={() => setCfg((c) => ({ ...c, format: f }))}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="t-chips" role="group" aria-label={t('export.columnsAria')}>
          {EXPORT_COLUMNS.map((c) => {
            const on = cfg.columns.includes(c.key);
            return (
              <button key={c.key} type="button" aria-pressed={on} className={clsx('t-chip', on && 'is-on')} onClick={() => toggleCol(c.key)}>
                {t(`col.${c.key}` as TKey)}{on ? ' ✓' : ''}
              </button>
            );
          })}
        </div>
        <div className="t-actions" style={{ marginTop: 0 }}>
          <button type="button" className="t-btn t-btn--primary t-btn--wide" disabled={!canExport && exportState === 'idle'} onClick={() => void runExport()} title={t('export.title')}>
            {exportState === 'busy' ? t('export.busy') : exportState === 'saved' ? t('export.done') : tn('export.button', exportTotal)}
          </button>
          <button type="button" className="t-btn t-btn--secondary" onClick={() => shell.openSettle(filterAccount?.type === 'person' ? filterAccount.id : null)}>
            {t('export.statement')}
          </button>
        </div>
        <div className="t-help">{t('export.help')}</div>
      </div>
      <div className="t-spacer" style={{ minHeight: 12 }} />
    </>
  );
}
