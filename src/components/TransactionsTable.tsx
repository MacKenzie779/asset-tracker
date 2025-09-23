import Amount from './Amount'
import type { Transaction } from '../types'
import { formatDate } from '../lib/format'

export default function TransactionsTable({
  items,
  hidden,
  onDelete,
}: {
  items: Transaction[]
  hidden: boolean
  onDelete?: (id: number) => void
}) {
  if (items.length === 0) {
    return <div className="text-sm text-neutral-500 p-3">No transactions yet.</div>
  }
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="[&>th]:py-2 [&>th]:px-2 text-left border-b border-neutral-200/50 dark:border-neutral-800/50">
          <th style={{width: 110}}>Date</th>
          <th>Description</th>
          <th>Account</th>
          <th className="text-right" style={{width: 140}}>Amount</th>
          <th className="w-[1%]"></th>
        </tr>
      </thead>
      <tbody>
        {items.map(t => (
          <tr key={t.id} className="[&>td]:py-2 [&>td]:px-2 border-b border-neutral-200/40 dark:border-neutral-800/40">
            <td className="tabular-nums">{formatDate(t.date)}</td>   {/* ← was t.date */}
            <td className="truncate">{t.description || '—'}</td>
            <td className="truncate">
              {/* ... */}
            </td>
            <td className="text-right font-medium">
              <Amount value={t.amount} hidden={hidden} colorBySign />
            </td>
            <td>
              {onDelete && (
                <button className="btn" onClick={()=>onDelete(t.id)}>Delete</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
