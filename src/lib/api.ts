import { invoke } from '@tauri-apps/api/tauri'
import type {
  Asset, NewAsset, UpdateAsset,
  Account, NewAccount,
  Transaction, NewTransaction, UpdateAccount
} from '../types'

/* assets (still available if you use them somewhere) */
export async function listAssets(): Promise<Asset[]> {
  return await invoke('list_assets')
}
export async function addAsset(input: NewAsset): Promise<number> {
  return await invoke('add_asset', { input })
}
export async function updateAsset(input: UpdateAsset): Promise<boolean> {
  return await invoke('update_asset', { input })
}
export async function deleteAsset(id: number): Promise<boolean> {
  return await invoke('delete_asset', { id })
}

/* finance */
export async function listAccounts(): Promise<Account[]> {
  return await invoke('list_accounts')
}
export async function addAccount(input: NewAccount): Promise<number> {
  return await invoke('add_account', { input })
}
export async function listTransactions(limit?: number): Promise<Transaction[]> {
  return await invoke('list_transactions', { limit })
}
export async function addTransaction(input: NewTransaction): Promise<number> {
  return await invoke('add_transaction', { input })
}
export async function deleteTransaction(id: number): Promise<boolean> {
  return await invoke('delete_transaction', { id })
}

export async function updateAccount(input: UpdateAccount): Promise<boolean> {
  return await invoke('update_account', { id: input.id, name: input.name, color: input.color ?? null });
}
export async function deleteAccount(id: number): Promise<boolean> {
  return await invoke('delete_account', { id });
}
