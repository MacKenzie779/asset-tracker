// Right-hand 340px column: LEDGER (position, accounts, people, export),
// ACCOUNTS (accounts + people CRUD) and CATEGORIES (category CRUD) tabs.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import AccountsTab from './AccountsTab';
import CategoriesTab from './CategoriesTab';
import Dropdown from './Dropdown';
import LedgerTab from './LedgerTab';
import { useI18n } from '../../hooks/useI18n';
import { useShell, type LedgerTab as Tab } from '../../lib/shell';
import type { Account, TransactionSearch } from '../../types';

export type AccountSort = 'value' | 'name';
const SORT_KEY = 'assettracker.accountSort';

const TABS: { value: Tab; labelKey: 'ltab.ledger' | 'ltab.accounts' | 'ltab.categories' }[] = [
  { value: 'ledger', labelKey: 'ltab.ledger' }, { value: 'accounts', labelKey: 'ltab.accounts' }, { value: 'categories', labelKey: 'ltab.categories' },
];

export default function Ledger({ exportPayload, exportTotal, filterAccount }: { exportPayload: TransactionSearch; exportTotal: number; filterAccount: Account | null }) {
  const shell = useShell();
  const { t } = useI18n();
  const tab = shell.ledgerTab;
  const [sort, setSort] = useState<AccountSort>(() => {
    try { return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'value'; } catch { return 'value'; }
  });
  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch {} }, [sort]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSearchOpen(false); setFilter(''); }, [tab]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);

  return (
    <aside className="t-ledger" aria-label={t('ledger.aria')}>
      <div className="t-lhead">
        <div className="t-ltabs" role="tablist" aria-label={t('ledger.aria')}>
          {TABS.map((tb) => (
            <button key={tb.value} type="button" role="tab" aria-selected={tab === tb.value} className={clsx('t-ltab', tab === tb.value && 'is-active')} onClick={() => shell.setLedgerTab(tb.value)}>
              {t(tb.labelKey)}
            </button>
          ))}
        </div>
        <div className="t-spacer" />
        {tab === 'ledger' ? (
          <Dropdown
            options={[{ value: 'value', label: t('ledger.sortByValue') }, { value: 'name', label: t('ledger.sortByName') }]}
            value={sort}
            label={t('ledger.sortLabel')}
            onChange={(v) => setSort(v as AccountSort)}
            ariaLabel={t('ledger.sortAria')}
          />
        ) : searchOpen ? (
          <input
            ref={searchRef}
            className="t-in t-lsearch"
            placeholder={t('ledger.filterPlaceholder')}
            aria-label={t('ledger.filterAria')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setFilter(''); setSearchOpen(false); } }}
          />
        ) : (
          <button type="button" className="t-dd" aria-label={t('ledger.filterAria')} onClick={() => setSearchOpen(true)}>⌕</button>
        )}
      </div>
      {tab === 'ledger' && <LedgerTab sort={sort} exportPayload={exportPayload} exportTotal={exportTotal} filterAccount={filterAccount} />}
      {tab === 'accounts' && <AccountsTab filter={filter} sort={sort} />}
      {tab === 'categories' && <CategoriesTab filter={filter} />}
    </aside>
  );
}
