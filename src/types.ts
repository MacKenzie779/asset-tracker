// src/types.ts

export type ID = number;

/** "standard": your own money. "person": someone you settle up with (balance > 0 = they owe you). */
export type AccountType = 'standard' | 'person';

export type Account = {
  id: ID;
  name: string;
  type: AccountType;
  color?: string | null;
  balance: number;
};

export type NewAccount = {
  name: string;
  account_type?: AccountType;
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
  /** Both legs of a transfer share the id of the source leg. */
  transfer_id?: number | null;
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

/** A transfer: `amount` leaves `from_account_id` and arrives at `to_account_id`. */
export type NewTransfer = {
  from_account_id: ID;
  to_account_id: ID;
  date: string;
  amount: number;
  description?: string | null;
  /** What the money was for; defaults to "Transfer" for plain moves between your own accounts. */
  category?: string | null;
};

export type TransferIds = { from_id: ID; to_id: ID };

export type OpenDatabaseResult = {
  migrated: boolean;
  backup_path: string | null;
};

export type TxTypeFilter = 'all' | 'income' | 'expense' | 'transfer';
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
  offset: number;
  /** Income and expense exclude transfers and initial balances. */
  sum_income: number;
  sum_expense: number;
  /** Initial balances ("Init") in the filtered set. */
  sum_init: number;
  /** Net of transfer legs in the filtered set (0 when viewing all accounts). */
  sum_transfer: number;
};
