
import { useEffect, useState } from 'react'
import AssetForm from './components/AssetForm'
import AssetTable from './components/AssetTable'
import { addAsset, deleteAsset, listAssets } from './lib/api'
import type { Asset, NewAsset } from './types'
import './index.css'

export default function App(){
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh(){
    setLoading(true)
    try{
      const data = await listAssets()
      setAssets(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handleAdd = async (a: NewAsset) => {
    await addAsset(a)
    await refresh()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this asset?')) return
    await deleteAsset(id)
    await refresh()
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 dark:bg-neutral-900/70 border-b border-neutral-200/20 dark:border-neutral-800/50">
        <div className="mx-auto max-w-5xl p-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">AssetTracker</h1>
          <span className="text-xs text-neutral-500">Local · Offline-first</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4 space-y-4">
        <AssetForm onSubmit={handleAdd} />
        {loading ? (
          <div className="card animate-pulse text-sm text-neutral-500">Loading…</div>
        ) : (
          <AssetTable assets={assets} onDelete={handleDelete} />
        )}
      </main>

      <footer className="mx-auto max-w-5xl p-6 text-xs text-neutral-500">
        Database lives in your App Data directory; everything stays on your machine.
      </footer>
    </div>
  )
}
