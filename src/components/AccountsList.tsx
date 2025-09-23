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
            {a.type === 'reimbursable' && (
              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    title="Reimbursable" aria-label="Reimbursable">
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeWidth="2" />
                  <path d="M20 4v6h-6" strokeWidth="2" />
                </svg>
              </span>
            )}
          </div>


          <Amount value={a.balance} hidden={hidden} colorBySign />

        </li>
      ))}
    </ul>
  )
}
