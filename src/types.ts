// src/types.ts

// ---------- Common ----------
export type ID = number;

// ---------- Accounts ----------
export type AccountType = 'standard' | 'reimbursable';

export type Account = {
  id: ID;
  name: string;
  type: AccountType;
  color?: string | null;
  balance?: number; // convenience, may be computed on backend
};

export type NewAccount = {
  name: string;
  type?: AccountType;
  color?: string | null;
  initial_balance?: number; // optional: backend may insert initial transaction
};

export type UpdateAccount = {
  id: ID;
  name?: string;
  type?: AccountType;
  color?: string | null;
};

// ---------- Categories ----------
export type Category = {
  id: ID;
  name: string;
};

// ---------- Transactions ----------
export type Transaction = {
  id: ID;
  account_id: ID;
  account_name?: string;
  account_color?: string | null;

  date: string; // ISO 'YYYY-MM-DD'
  category_id?: ID | null;
  category?: string | null; // display (db category or legacy text)
  description?: string | null;
  amount: number;
};

export type NewTransaction = {
  account_id: ID;
  date: string; // ISO
  amount: number;
  description?: string | null;
  category_id?: ID | null;
  category?: string | null;
  reimbursement_account_id?: ID | null;
};

export type UpdateTransaction = {
  id: ID;
  account_id?: ID;
  date?: string; // ISO
  amount?: number;
  description?: string | null;
  category_id?: ID | null;
  category?: string | null;
  reimbursement_account_id?: ID | null;
};

// ---------- Assets (kept for completeness) ----------
export type Asset = {
  id: ID;
  name: string;
  value: number;
};

export type NewAsset = {
  name: string;
  value: number;
};

export type UpdateAsset = {
  id: ID;
  name?: string;
  value?: number;
};

// ---------- Transactions search & export ----------
export type TxTypeFilter = 'all' | 'income' | 'expense';

export type TransactionSearch = {
  query?: string;
  account_id?: number | null;
  date_from?: string | null; // inclusive, ISO 'YYYY-MM-DD'
  date_to?: string | null;   // inclusive, ISO 'YYYY-MM-DD'
  tx_type?: TxTypeFilter;
  limit?: number;
  offset?: number;
};

export type TransactionSearchResult = {
  items: Transaction[];
  total: number;
  sum_income: number;   // > 0
  sum_expense: number;  // < 0
};
