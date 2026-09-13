import { useMemo, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import Skeleton from './Skeleton';
import EditableTransactionRow from './transactions/EditableTransactionRow';
import type { Account, Transaction, UpdateTransaction, TxSortBy, TxSortDir } from '../types';

export type SortableProps = {
  sortBy: TxSortBy;
  sortDir: TxSortDir;
  onRequestSort: (by: TxSortBy) => void;
};

export type TransactionsTableProps = {
  items: Transaction[];
  accounts: Account[];
  hidden: boolean;
  onDelete?: (id: number) => void;
  onUpdate?: (patch: UpdateTransaction) => Promise<void>;
  /** When set, headers become sort buttons (server-side sorting). */
  sortable?: SortableProps;
  /** Home: backend sends newest-first; show oldest → newest so the newest row sits at the bottom. */
  newestLast?: boolean;
  loading?: boolean;
  /** Rendered as a full-width row when there is nothing to show. */
  emptyMessage?: ReactNode;
};

const COLS: { key: TxSortBy; label: string; width?: number; align?: 'right' }[] = [
  { key: 'date', label: 'Date', width: 120 },
  { key: 'category', label: 'Category', width: 200 },
  { key: 'description', label: 'Notes' },
  { key: 'amount', label: 'Value', width: 140, align: 'right' },
  { key: 'account', label: 'Account', width: 200 },
];

const SKELETON_ROWS = 5;

export default function TransactionsTable({
  items,
  accounts,
  hidden,
  onDelete,
  onUpdate,
  sortable,
  newestLast = false,
  loading = false,
  emptyMessage,
}: TransactionsTableProps) {
  const rows = useMemo(() => (newestLast ? [...items].reverse() : items), [items, newestLast]);
  const showSkeleton = loading && rows.length === 0;
  const showEmpty = !loading && rows.length === 0 && emptyMessage != null;

  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="[&>th]:py-2 [&>th]:px-2 text-left border-b border-neutral-200/50 dark:border-neutral-800/50">
          {COLS.map((c) =>
            sortable ? (
              <SortTh
                key={c.key}
                label={c.label}
                active={sortable.sortBy === c.key}
                dir={sortable.sortDir}
                onClick={() => sortable.onRequestSort(c.key)}
                style={c.width ? { width: c.width } : undefined}
                className={c.align === 'right' ? 'text-right' : undefined}
              />
            ) : (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={c.align === 'right' ? 'text-right' : undefined}
              >
                {c.label}
              </th>
            )
          )}
          <th scope="col" className="w-[1%]">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody
        aria-busy={loading || undefined}
        className={clsx(loading && rows.length > 0 && 'opacity-60 transition-opacity')}
      >
        {rows.map((row) => (
          <EditableTransactionRow
            key={row.id}
            row={row}
            accounts={accounts}
            hidden={hidden}
            onDelete={onDelete}
            onUpdate={onUpdate}
          />
        ))}

        {showSkeleton &&
          Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <tr key={`sk-${i}`} className="[&>td]:py-2 [&>td]:px-2 border-b border-neutral-200/40 dark:border-neutral-800/40">
              <td><Skeleton className="h-4 w-20" /></td>
              <td><Skeleton className="h-4 w-24" /></td>
              <td><Skeleton className="h-4 w-40" /></td>
              <td><Skeleton className="ml-auto h-4 w-16" /></td>
              <td><Skeleton className="h-4 w-28" /></td>
              <td />
            </tr>
          ))}

        {showEmpty && (
          <tr>
            <td colSpan={COLS.length + 1}>{emptyMessage}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/* ---- header cell with sorting ---- */
function SortTh({
  label,
  active,
  dir,
  onClick,
  style,
  className,
}: {
  label: string;
  active: boolean;
  dir: TxSortDir;
  onClick: () => void;
  style?: CSSProperties;
  className?: string;
}) {
  const arrow = active ? (dir === 'asc' ? '↑' : '↓') : '';
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th style={style} className={className} scope="col" aria-sort={ariaSort}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={onClick}
        title={`Sort by ${label}${active ? ` (${dir})` : ''}`}
      >
        <span>{label}</span>
        <span className="text-xs opacity-70" aria-hidden="true">{arrow}</span>
      </button>
    </th>
  );
}
