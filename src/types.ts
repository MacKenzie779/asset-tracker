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
  type: 'standard' | 'reimbursable'
  balance: number
}

export type NewAccount = {
  name: string
  color?: string | null
  account_type: 'standard' | 'reimbursable'
  initial_balance?: number
}

export type Transaction = {
  id: number
  account_id: number
  account_name: string
  account_color?: string | null
  date: string                // 'YYYY-MM-DD'
  category?: string | null
  description?: string | null // shown as "Notes"
  amount: number
  reimbursement_account_id?: number | null
  reimbursement_account_name?: string | null
}

export type NewTransaction = {
  account_id: number
  date: string
  description?: string | null
  amount: number
  category?: string | null
  reimbursement_account_id?: number | null
}

export type UpdateTransaction = Partial<NewTransaction> & { id: number }

export type UpdateAccount = {
  id: number
  name?: string
  color?: string | null
}
