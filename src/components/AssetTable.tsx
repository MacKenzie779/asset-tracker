
import type { Asset } from '../types'

type Props = {
  assets: Asset[]
  onDelete: (id: number) => Promise<void>
}

export default function AssetTable({ assets, onDelete }: Props){
  if (assets.length === 0) {
    return <div className="card text-sm text-neutral-500">No assets yet. Add your first one above.</div>
  }

  return (
    <div className="card overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left">
          <tr className="[&>th]:py-2 [&>th]:px-2 border-b border-neutral-200/20">
            <th>Name</th>
            <th>Category</th>
            <th>Purchase Date</th>
            <th className="text-right">Value</th>
            <th className="w-[1%]"></th>
          </tr>
        </thead>
        <tbody>
          {assets.map(a => (
            <tr key={a.id} className="[&>td]:py-2 [&>td]:px-2 border-b border-neutral-200/20">
              <td className="font-medium">{a.name}</td>
              <td>{a.category || '—'}</td>
              <td>{a.purchase_date || '—'}</td>
              <td className="text-right">{a.value.toLocaleString(undefined, { style: 'currency', currency: 'EUR' })}</td>
              <td>
                <button className="btn" onClick={() => onDelete(a.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
