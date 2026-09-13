import Amount from './Amount';
import PersonBalance from './PersonBalance';
import { IconUser } from './icons';
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

  const own = items.filter((a) => a.type !== 'person');
  const people = items.filter((a) => a.type === 'person');

  return (
    <div>
      <ul className="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
        {own.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {a.color ? (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} aria-hidden="true" />
              ) : null}
              <span className="truncate">{a.name}</span>
            </div>
            <Amount value={a.balance} hidden={hidden} colorBySign />
          </li>
        ))}
      </ul>

      {people.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 border-t border-neutral-200/60 px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800/60">
            <IconUser className="h-3.5 w-3.5" />
            People
          </div>
          <ul className="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
            {people.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {a.color ? (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} aria-hidden="true" />
                  ) : null}
                  <span className="truncate">{a.name}</span>
                </div>
                <PersonBalance balance={a.balance} hidden={hidden} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
