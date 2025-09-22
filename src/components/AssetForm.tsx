
import { useState } from 'react'
import type { NewAsset } from '../types'

type Props = {
  onSubmit: (a: NewAsset) => Promise<void>
}

export default function AssetForm({ onSubmit }: Props) {
  const [form, setForm] = useState<NewAsset>({
    name: '', category: '', purchase_date: '', value: 0, notes: ''
  })
  const [busy, setBusy] = useState(false)

  function update<K extends keyof NewAsset>(k: K, v: NewAsset[K]){
    setForm(f => ({...f, [k]: v}))
  }

  return (
    <form className="card space-y-3" onSubmit={async (e) => {
      e.preventDefault()
      setBusy(true)
      try {
        await onSubmit({
          name: form.name.trim(),
          category: form.category || null,
          purchase_date: form.purchase_date || null,
          value: Number(form.value) || 0,
          notes: form.notes || null,
        })
        setForm({ name: '', category: '', purchase_date: '', value: 0, notes: '' })
      } finally {
        setBusy(false)
      }
    }}>
      <h2 className="text-lg font-semibold">Add Asset</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Name</span>
          <input required className="input" value={form.name} onChange={e=>update('name', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Category</span>
          <input className="input" value={form.category || ''} onChange={e=>update('category', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Purchase Date</span>
          <input type="date" className="input" value={form.purchase_date || ''} onChange={e=>update('purchase_date', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Value (€)</span>
          <input required type="number" step="0.01" className="input" value={form.value} onChange={e=>update('value', parseFloat(e.target.value))} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label">Notes</span>
        <textarea className="input" rows={3} value={form.notes || ''} onChange={e=>update('notes', e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="reset" className="btn" onClick={()=>setForm({ name: '', category: '', purchase_date: '', value: 0, notes: '' })}>
          Reset
        </button>
      </div>
    </form>
  )
}
