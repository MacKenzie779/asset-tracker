// Right-hand 340px column: LEDGER (position, accounts, people, export),
// ACCOUNTS (accounts + people CRUD) and CATEGORIES (category CRUD) tabs.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import AccountsTab from './AccountsTab';
import CategoriesTab from './CategoriesTab';
import Dropdown from './Dropdown';
import LedgerTab from './LedgerTab';
import { useShell, type LedgerTab as Tab } from '../../lib/shell';
import type { Account, TransactionSearch } from '../../types';

export type AccountSort = 'value' | 'name';
const SORT_KEY = 'assettracker.accountSort';

const TABS: { value: Tab; label: string }[] = [
  { value: 'ledger', label: 'LEDGER' }, { value: 'accounts', label: 'ACCOUNTS' }, { value: 'categories', label: 'CATEGORIES' },
];

export default function Ledger({ exportPayload, exportTotal, filterAccount }: { exportPayload: TransactionSearch; exportTotal: number; filterAccount: Account | null }) {
  const shell = useShell();
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
    <aside className="t-ledger" aria-label="Ledger column">
      <div className="t-lhead">
        <div className="t-ltabs" role="tablist" aria-label="Ledger column">
          {TABS.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={clsx('t-ltab', tab === t.value && 'is-active')} onClick={() => shell.setLedgerTab(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="t-spacer" />
        {tab === 'ledger' ? (
          <Dropdown
            options={[{ value: 'value', label: 'Sort by value' }, { value: 'name', label: 'Sort by name' }]}
            value={sort}
            label="SORT"
            onChange={(v) => setSort(v as AccountSort)}
            ariaLabel="Sort accounts"
          />
        ) : searchOpen ? (
          <input
            ref={searchRef}
            className="t-in t-lsearch"
            placeholder="⌕ filter"
            aria-label="Filter rows"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setFilter(''); setSearchOpen(false); } }}
          />
        ) : (
          <button type="button" className="t-dd" aria-label="Filter rows" onClick={() => setSearchOpen(true)}>⌕</button>
        )}
      </div>
      {tab === 'ledger' && <LedgerTab sort={sort} exportPayload={exportPayload} exportTotal={exportTotal} filterAccount={filterAccount} />}
      {tab === 'accounts' && <AccountsTab filter={filter} sort={sort} />}
      {tab === 'categories' && <CategoriesTab filter={filter} />}
    </aside>
  );
}
