// src/lib/api.ts
import { invoke } from '@tauri-apps/api/tauri';
import type {
  Asset, NewAsset, UpdateAsset,
  Account, NewAccount, UpdateAccount,
  Transaction, NewTransaction, UpdateTransaction,
  TransactionSearch, TransactionSearchResult,
} from '../types';

/* assets */
export async function listAssets(): Promise<Asset[]> {
  return invoke<Asset[]>('list_assets');
}
export async function addAsset(input: NewAsset): Promise<number> {
  return invoke<number>('add_asset', { input });
}
export async function updateAsset(input: UpdateAsset): Promise<boolean> {
  return invoke<boolean>('update_asset', { input });
}
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
