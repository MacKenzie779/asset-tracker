import Amount from './Amount'
import type { Account } from '../types'

export default function AccountsList({
  items,
  hidden,
}: {
  items: Account[]
  hidden: boolean
}) {
  if (items.length === 0) {
    return <div className="text-sm text-neutral-500 p-3">No accounts yet.</div>
  }

  return (
    <ul className="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
      {items.map(a => (
        <li key={a.id} className="px-3 py-2 flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-2">
            {a.color ? <span className="h-2.5 w-2.5 rounded-full" style={{backgroundColor: a.color}} /> : null}
            <span className="truncate">{a.name}</span>
          </div>
          <div className="shrink-0 font-medium text-sm">
            <Amount value={a.balance} hidden={hidden} />
          </div>
        </li>
      ))}
    </ul>
  )
}
