
import { invoke } from '@tauri-apps/api/tauri'
import type { Asset, NewAsset, UpdateAsset } from '../types'

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
