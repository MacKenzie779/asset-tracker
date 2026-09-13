import Amount from './Amount';
import { IconRefresh } from './icons';
import type { Account } from '../types';

export default function AccountsList({
  items,
  hidden,
}: {
  items: Account[];
  hidden: boolean;
}) {
  if (items.length === 0) {
    return <div className="p-3 text-sm text-neutral-500">No accounts yet.</div>;
  }

  return (
    <ul className="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
      {items.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {a.color ? (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} aria-hidden="true" />
            ) : null}
            <span className="truncate">{a.name}</span>
            {a.type === 'reimbursable' && (
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                title="Reimbursable"
                aria-label="Reimbursable"
              >
                <IconRefresh className="h-3 w-3" strokeWidth={2} />
              </span>
            )}
          </div>

          <Amount value={a.balance} hidden={hidden} colorBySign />
        </li>
      ))}
    </ul>
  );
}
