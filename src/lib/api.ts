import { invoke } from '@tauri-apps/api/tauri';
import type {
  Account, NewAccount, UpdateAccount,
  Transaction, NewTransaction, UpdateTransaction,
  TransactionSearch, TransactionSearchResult,
} from '../types';

export async function deleteAsset(id: number): Promise<boolean> {
  return invoke<boolean>('delete_asset', { id });
}

/* accounts */
export async function listAccounts(): Promise<Account[]> {
  return invoke<Account[]>('list_accounts');
}
export async function addAccount(input: NewAccount): Promise<number> {
  return invoke<number>('add_account', { input });
}
export async function updateAccount(input: UpdateAccount): Promise<boolean> {
  const { id, name, color } = input;
  return invoke<boolean>('update_account', { id, name, color: color ?? null });
}
export async function deleteAccount(id: number): Promise<boolean> {
  return invoke<boolean>('delete_account', { id });
}

/* transactions (CRUD) */
export async function listTransactions(limit?: number): Promise<Transaction[]> {
  return invoke<Transaction[]>('list_transactions', { limit });
}
export async function addTransaction(input: NewTransaction): Promise<number> {
  return invoke<number>('add_transaction', { input });
}
export async function updateTransaction(input: UpdateTransaction): Promise<boolean> {
  return invoke<boolean>('update_transaction', { input });
}
export async function deleteTransaction(id: number): Promise<boolean> {
  return invoke<boolean>('delete_transaction', { id });
}

/* transactions (search + export) */
export async function searchTransactions(filters: TransactionSearch): Promise<TransactionSearchResult> {
  return invoke<TransactionSearchResult>('search_transactions', { filters });
}
export async function exportTransactionsXlsx(filters: TransactionSearch, columns?: string[]): Promise<string> {
  return invoke<string>('export_transactions_xlsx', { filters, columns });
}
export async function exportTransactionsPdf(filters: TransactionSearch, columns?: string[]): Promise<string> {
  return invoke<string>('export_transactions_pdf', { filters, columns });
}

/* NEW: reimbursable window exports */
export async function exportReimbursableReportXlsx(filters: TransactionSearch, columns?: string[]): Promise<string> {
  return invoke<string>('export_reimbursable_report_xlsx', { filters, columns });
}
export async function exportReimbursableReportPdf(filters: TransactionSearch, columns?: string[]): Promise<string> {
  return invoke<string>('export_reimbursable_report_pdf', { filters, columns });
}

// categories
import type { Category } from '../types';

export async function listCategories(): Promise<Category[]> {
  return invoke<Category[]>('list_categories');
}

export async function addCategory(name: string): Promise<number> {
  return invoke<number>('add_category', { name });
}

export async function renameCategory(id: number, name: string): Promise<boolean> {
  return invoke<boolean>('update_category', { id, name });
}

export async function deleteCategory(id: number): Promise<boolean> {
  return invoke<boolean>('delete_category', { id });
}