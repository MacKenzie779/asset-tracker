export type Asset = {
  id: number
  name: string
  category?: string | null
  purchase_date?: string | null
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

/* Finance domain */
export type Account = {
  id: number
  name: string
  color?: string | null
  balance: number
}
export type NewAccount = {
  name: string
  color?: string | null
}

export type Transaction = {
  id: number
  account_id: number
  account_name: string
  account_color?: string | null
  date: string            // 'YYYY-MM-DD'
  description?: string | null
  amount: number          // income > 0; expense < 0
}
export type NewTransaction = {
  account_id: number
  date: string
  description?: string | null
  amount: number
}

export type UpdateAccount = {
  id: number
  name?: string
  color?: string | null
}
