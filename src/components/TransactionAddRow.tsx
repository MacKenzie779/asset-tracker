import { useMemo, useState } from 'react'
import type { Account, NewTransaction } from '../types'

function todayISO() {
  const d = new Date()
  const m = String(d.getMonth()+1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function TransactionAddRow({
  accounts,
  onAdd
}: {
  accounts: Account[]
  onAdd: (t: NewTransaction) => Promise<void>
}) {
  const defaultAccountId = useMemo(() => accounts[0]?.id ?? 1, [accounts])
  const [accountId, setAccountId] = useState<number>(defaultAccountId)
  const [date, setDate] = useState<string>(todayISO())
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [busy, setBusy] = useState(false)

  return (
    <form className="grid grid-cols-12 gap-2 items-center p-2" onSubmit={async (e) => {
      e.preventDefault()
      setBusy(true)
      try {
        await onAdd({
          account_id: accountId,
          date,
          description: desc.trim() || null,
          amount: Number(amount) || 0
        })
        setDesc(''); setAmount(0)
      } finally {
        setBusy(false)
      }
    }}>
      <select className="input col-span-3" value={accountId} onChange={e=>setAccountId(parseInt(e.target.value))}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input type="date" className="input col-span-2" value={date} onChange={e=>setDate(e.target.value)} />
      <input className="input col-span-5" placeholder="Description" value={desc} onChange={e=>setDesc(e.target.value)} />
      <input type="number" step="0.01" className="input col-span-1" value={amount} onChange={e=>setAmount(parseFloat(e.target.value))} />
      <button className="btn btn-primary col-span-1" disabled={busy}>{busy ? 'Add…' : 'Add'}</button>
    </form>
  )
}
