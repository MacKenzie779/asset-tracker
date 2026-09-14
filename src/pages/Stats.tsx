// Stats tab (2d): KPI rail, net worth + monthly flows, then category treemap,
// allocation and top expenses / balance with people. Hand-built SVG and flex
// bars; every aggregate comes from lib/analytics.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import Money from '../components/terminal/Money';
import Sparkline, { sparkPoints } from '../components/terminal/Sparkline';
import {
  accountSeries, allocation, categorySpend, daysAgoISO, flowSeries, lastMonthKeys, netThisMonth, netWorthSeries, pctChange, savingsRate, sumsAllTime, topExpenses,
  type CategorySpend,
} from '../lib/analytics';
import { emit } from '../lib/bus';
import { useData } from '../lib/data';
import { formatDate, formatMonthKey } from '../lib/format';
import { formatAbs, formatPercent, MASK } from '../lib/number';
import { totalValue } from '../lib/people';
import { useShell } from '../lib/shell';
import { useI18n } from '../hooks/useI18n';
import { t as translate } from '../lib/i18n';

export default function Stats() {
  const data = useData();
  const { hidden } = useShell();
  const { t, tn } = useI18n();
  const nav = useNavigate();

  const months12 = useMemo(() => lastMonthKeys(12), []);
  const months6 = useMemo(() => lastMonthKeys(6), []);
  const total = totalValue(data.accounts);
  const worth = useMemo(() => netWorthSeries(data.txAll, months12), [data.txAll, months12]);
  const change = pctChange(worth);
  const net = useMemo(() => netThisMonth(data.txAll), [data.txAll]);
  const flows = useMemo(() => flowSeries(data.txAll, months12), [data.txAll, months12]);
  const income12 = flows.reduce((s, f) => s + f.income, 0);
  const expense12 = flows.reduce((s, f) => s + f.expense, 0);
  const rate = savingsRate(income12, expense12);
  const all = useMemo(() => sumsAllTime(data.txAll), [data.txAll]);
  const spend = useMemo(() => categorySpend(data.txAll, daysAgoISO(90)), [data.txAll]);
  const alloc = useMemo(() => allocation(data.accounts), [data.accounts]);
  const top = useMemo(() => topExpenses(data.txAll, 5), [data.txAll]);
  const peopleSeries = useMemo(
    () => data.people.map((p) => ({ person: p, series: accountSeries(data.txAll, p.id, months6) })),
    [data.people, data.txAll, months6]
  );

  const avgNet = flows.length ? (income12 - expense12) / flows.length : 0;
  const maxFlow = Math.max(1, ...flows.map((f) => Math.max(f.income, f.expense)));
  const mask = (s: string) => (hidden ? MASK : s);

  const filterCategory = (name: string) => {
    emit('blotter:filter', { query: name });
    nav('/');
  };

  return (
    <div className="t-stats" aria-label={t('stats.aria')}>
      {/* Band 1: KPI rail */}
      <div className="t-kpis">
        <div className="t-kpi">
          <div className="l">{t('stats.totalValue')}</div>
          <div className="v">{data.loaded ? <Money value={total} hidden={hidden} sign="neg" tone="none" /> : '——'}<span className="u"> €</span></div>
          <div className="t-spark-row">
            <Sparkline values={worth} stroke={change != null && change < 0 ? 'var(--neg)' : 'var(--pos)'} />
            <span className={change != null && change < 0 ? 'neg' : 'pos'}>{change == null ? '— 12M' : hidden ? '••• 12M' : `${formatPercent(change, 1, true).replace(' %', '%')} 12M`}</span>
          </div>
        </div>
        <div className="t-kpi">
          <div className="l">{t('pos.netThisMonth')}</div>
          <div className="v"><Money value={net} hidden={hidden} /></div>
          <div className="s">{t('stats.transfersExcluded')}</div>
        </div>
        <div className="t-kpi">
          <div className="l">{t('stats.savingsRate12m')}</div>
          <div className={clsx('v', rate == null ? 'ink2' : rate < 0 ? 'neg' : 'pos')}>{rate == null ? '—' : hidden ? '•••' : formatPercent(rate)}</div>
          <div className="t-divbars" aria-hidden="true">
            {flows.map((f) => {
              const r = savingsRate(f.income, f.expense);
              const v = r == null ? (f.expense > 0 ? -100 : 0) : r;
              const h = Math.abs(v) < 0.05 ? 1 : Math.max(2, Math.min(26, (Math.abs(v) / 100) * 26));
              return (
                <div key={f.key} title={`${formatMonthKey(f.key)}: ${r == null ? '—' : formatPercent(r)}`}>
                  <div style={{ height: h, background: v < 0 ? 'var(--neg)' : 'var(--pos)', alignSelf: v < 0 ? 'flex-start' : 'flex-end', marginTop: v < 0 ? 0 : undefined, marginBottom: v < 0 ? undefined : 0 }} />
                </div>
              );
            })}
          </div>
        </div>
        <div className="t-kpi">
          <div className="l">{t('stats.inOutAllTime')}</div>
          <div className="pair">
            <div><Money value={all.income} hidden={hidden} sign="none" tone="pos" /></div>
            <div><Money value={all.expense} hidden={hidden} sign="neg" tone="neg" /></div>
          </div>
          <div className="s">{tn('stats.txCount', all.count)}</div>
        </div>
      </div>

      {/* Band 2: net worth + monthly flows */}
      <div className="t-band2">
        <div className="t-pane">
          <div className="t-pane-head">
            <span className="t-label">{t('stats.netWorth12m')}</span>
            <span className="t-pane-meta">{worth.length ? `${mask(formatAbs(worth[0], 0))} → ${mask(formatAbs(worth[worth.length - 1], 0))} €` : ''}</span>
          </div>
          <NetWorthChart values={worth} />
          <div className="t-axis">
            <span>{formatMonthKey(months12[0])}</span>
            <span>{formatMonthKey(months12[6])}</span>
            <span>{formatMonthKey(months12[11])}</span>
          </div>
        </div>
        <div className="t-pane">
          <div className="t-pane-head">
            <span className="t-label">{t('stats.incomeVsExpense')}</span>
            <span className="t-pane-meta">Ø {hidden ? MASK : `${avgNet < 0 ? '-' : '+'}${formatAbs(avgNet, 0)}`} {t('stats.perMonth')}</span>
          </div>
          <div className="t-bars">
            {flows.map((f) => (
              <div key={f.key} title={hidden ? formatMonthKey(f.key) : t('stats.barTitle', { month: formatMonthKey(f.key), in: formatAbs(f.income), out: formatAbs(f.expense) })}>
                <div style={{ height: `${(f.income / maxFlow) * 100}%`, background: 'var(--pos)' }} />
                <div style={{ height: `${(f.expense / maxFlow) * 100}%`, background: 'var(--neg)' }} />
              </div>
            ))}
          </div>
          <div className="t-axis">
            <span>{formatMonthKey(months12[0])}</span>
            <span>{formatMonthKey(months12[11])}</span>
          </div>
        </div>
      </div>

      {/* Band 3 */}
      <div className="t-band3">
        <div className="t-pane">
          <div className="t-pane-head">
            <span className="t-label">{t('stats.spendByCategory')}</span>
            <span className="t-pane-meta">{tn('stats.categoriesCount', spend.length)}</span>
          </div>
          {spend.length === 0 ? <div className="t-stats-empty">{t('stats.noExpenses90')}</div> : <Treemap rows={spend} hidden={hidden} onPick={filterCategory} />}
        </div>

        <div className="t-pane">
          <div className="t-pane-head">
            <span className="t-label">{t('stats.allocation')}</span>
            <span className="t-pane-meta">{tn('stats.positionsCount', alloc.length)}</span>
          </div>
          {alloc.length === 0 ? (
            <div className="t-stats-empty">{t('stats.noPositive')}</div>
          ) : (
            <>
              <div className="t-alloc-bar" aria-hidden="true">
                {alloc.map((r) => <div key={r.id} style={{ width: `${r.share * 100}%`, background: r.color }} title={r.name} />)}
              </div>
              {alloc.map((r) => (
                <div key={r.id} className="t-legend-row">
                  <span className="sq" style={{ background: r.color }} aria-hidden="true" />
                  <span className="n" title={r.name}>{r.name}</span>
                  <span className="p">{Math.round(r.share * 100)}%</span>
                  <span className="v"><Money value={r.value} hidden={hidden} sign="none" tone="none" /></span>
                </div>
              ))}
              <div className="t-note">{allocationNote(alloc)}</div>
            </>
          )}
        </div>

        <div className="t-pane">
          <div className="t-pane-head">
            <span className="t-label">{t('stats.topExpenses')}</span>
            <span className="t-pane-meta">{t('stats.top', { n: top.length })}</span>
          </div>
          {top.length === 0 && <div className="t-stats-empty">{t('stats.noExpenses')}</div>}
          {top.map((t) => (
            <div key={t.id} className="t-top-row">
              <span className="d">{formatDate(t.date)}</span>
              <span className="c" title={`${t.category ?? '—'}${t.description ? ` · ${t.description}` : ''}`}>
                {t.category ?? '—'}{t.description && <span> · {t.description}</span>}
              </span>
              <span className="v"><Money value={t.amount} hidden={hidden} sign="neg" tone="none" /></span>
            </div>
          ))}

          <div className="t-pane-head" style={{ margin: '16px 0 9px' }}>
            <span className="t-label">{t('stats.balanceWithPeople')}</span>
            <span className="t-pane-meta">{tn('stats.peopleCount', data.people.length)}</span>
          </div>
          {data.people.length === 0 && <div className="t-stats-empty">{t('stats.noPeople')}</div>}
          {peopleSeries.map(({ person, series }) => (
            <div key={person.id} className="t-person-row">
              <span className="t-dot" style={{ background: person.color || '#6b7280' }} aria-hidden="true" />
              <span className="n" title={person.name}>{person.name}</span>
              <Sparkline values={series} width={110} height={16} vbHeight={14} stroke={person.color || '#6b7280'} pad={1} />
              <span className="v"><Money value={person.balance} hidden={hidden} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NetWorthChart({ values }: { values: number[] }) {
  const pts = sparkPoints(values, 40, 3);
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 176, display: 'block' }} aria-hidden="true">
      <line x1="0" y1="10" x2="100" y2="10" stroke="var(--grid-chart)" strokeWidth=".4" />
      <line x1="0" y1="25" x2="100" y2="25" stroke="var(--grid-chart)" strokeWidth=".4" />
      {pts && (
        <>
          <path d={`M${pts.split(' ').join(' L')} L100,40 L0,40 Z`} fill="var(--pos)" opacity=".1" />
          <polyline points={pts} fill="none" stroke="var(--pos)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

/* ---------- treemap ---------- */

type Tile = { row: CategorySpend; rank: number };

function Treemap({ rows, hidden, onPick }: { rows: CategorySpend[]; hidden: boolean; onPick: (name: string) => void }) {
  const shown = rows.slice(0, 9);
  const more = rows.length - shown.length;
  // Column split as in the handoff: 2 / 3 / 4 tiles, weighted 5 / 3 / 2.
  const split = shown.length <= 2 ? [shown.length] : shown.length <= 5 ? [2, shown.length - 2] : [2, 3, shown.length - 5];
  const weights = [5, 3, 2];
  const cols: { flex: number; tiles: Tile[] }[] = [];
  let i = 0;
  split.forEach((n, ci) => {
    const tiles = shown.slice(i, i + n).map((row, k) => ({ row, rank: i + k }));
    i += n;
    cols.push({ flex: weights[ci] ?? 2, tiles });
  });
  const rankClass = (r: number) => (r === 0 ? 'r1' : r === 1 ? 'r2' : r === 2 ? 'r3' : r <= 4 ? 'r4' : 'r5');
  const minFlex = 0.6;
  return (
    <div className="t-treemap" role="list">
      {cols.map((c, ci) => {
        const colTotal = c.tiles.reduce((s, t) => s + t.row.value, 0) || 1;
        return (
          <div key={ci} style={{ flex: c.flex }}>
            {c.tiles.map((t) => (
              <button
                key={t.row.name}
                type="button"
                role="listitem"
                className={clsx('t-tile', rankClass(t.rank))}
                style={{ flex: Math.max(minFlex, (t.row.value / colTotal) * c.tiles.length), background: `var(--tm-${t.rank + 1})` }}
                title={translate('stats.tileFilter', { name: t.row.name })}
                onClick={() => onPick(t.row.name)}
              >
                <div className="n">{t.row.name}</div>
                <div className="v">{hidden ? MASK : `-${formatAbs(t.row.value)}`}</div>
                {t.rank === 0 && <div className="m">{translate('stats.tileMeta', { pct: Math.round(t.row.share * 100), n: t.row.count })}</div>}
              </button>
            ))}
            {ci === cols.length - 1 && more > 0 && (
              <div className="t-tile more" style={{ flex: minFlex, background: 'var(--tm-9)' }}>
                <div className="n">{translate('stats.more', { n: more })}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function allocationNote(rows: ReturnType<typeof allocation>): string {
  if (rows.length === 0) return '';
  const top = rows[0];
  const first = translate('stats.allocNoteFirst', { name: shortName(top.name), pct: Math.round(top.share * 100) });
  const rest = rows.slice(1);
  if (rest.length === 0) return first;
  const restShare = Math.round(rest.reduce((s, r) => s + r.share, 0) * 100);
  const names = rest.length <= 3 ? joinNames(rest.map((r) => shortName(r.name))) : translate('stats.allocOthers', { n: rest.length });
  return `${first}\n${translate('stats.allocNoteRest', { names, pct: restShare })}`;
}

function shortName(n: string): string {
  return n.split(' ')[0];
}

function joinNames(ns: string[]): string {
  if (ns.length <= 1) return ns.join('');
  return `${ns.slice(0, -1).join(', ')} ${translate('stats.and')} ${ns[ns.length - 1]}`;
}
