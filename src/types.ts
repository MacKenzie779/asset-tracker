// src/types.ts

export type ID = number;

export type AccountType = 'standard' | 'reimbursable';

export type Account = {
  id: ID;
  name: string;
  type: AccountType;
  color?: string | null;
  balance?: number;
};

export type NewAccount = {
  name: string;
  type?: AccountType;
  color?: string | null;
  initial_balance?: number;
};

export type UpdateAccount = {
  id: ID;
  name?: string;
  type?: AccountType;
  color?: string | null;
};

export type Category = { id: ID; name: string };

export type Transaction = {
  id: ID;
  account_id: ID;
  account_name?: string;
  account_color?: string | null;
  date: string; // YYYY-MM-DD
  category?: string | null;
  description?: string | null;
  amount: number;
};

export type NewTransaction = {
  account_id: ID;
  date: string;
  amount: number;
  description?: string | null;
  category?: string | null;
};

export type UpdateTransaction = {
  id: ID;
  account_id?: ID;
  date?: string;
  amount?: number;
  description?: string | null;
  category?: string | null;
};

export type TxTypeFilter = 'all' | 'income' | 'expense';
export type TxSortBy = 'date' | 'category' | 'description' | 'amount' | 'account' | 'id';
export type TxSortDir = 'asc' | 'desc';

export type TransactionSearch = {
  query?: string;
  account_id?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  tx_type?: TxTypeFilter;
  limit?: number;
  offset?: number; // use -1 to request last page from server
  sort_by?: TxSortBy;
  sort_dir?: TxSortDir;
};

export type TransactionSearchResult = {
  items: Transaction[];
  total: number;
  offset: number;      // effective offset (server-computed)
  sum_income: number;
  sum_expense: number;
};
