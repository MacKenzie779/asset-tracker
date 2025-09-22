
export type Asset = {
  id: number
  name: string
  category?: string | null
  purchase_date?: string | null // ISO date 'YYYY-MM-DD'
  value: number
  notes?: string | null
  created_at: string
  updated_at: string
}

export type NewAsset = {
  name: string
  category?: string | null
  purchase_date?: string | null
  value: number
  notes?: string | null
}

export type UpdateAsset = Partial<NewAsset> & { id: number }
