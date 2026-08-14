/**
 * Supabase BYO 登录会话持久化：明文 JSON 存于 plugin-store（session.json）。
 * - 此前用 Stronghold 加密 vault，因 libsodium-sys-stable 在 Android 交叉编译无解，已简化。
 * - web 环境不可用（仅 Tauri），一律返回 null。
 */

import { Store } from '@tauri-apps/plugin-store'
import { isTauri } from '$lib/db/env'

const VAULT_FILE = 'session.json'
const SESSION_KEY = 'supabase-session'

export interface VaultSession {
  access_token: string
  refresh_token: string
  expires_at: number
}

let storePromise: Promise<Store | null> | null = null

/** 初始化（幂等）并缓存 store；web 环境返回 null */
function initStore(): Promise<Store | null> {
  if (!isTauri) return Promise.resolve(null)
  if (!storePromise) {
    storePromise = Store.load(VAULT_FILE).catch((e) => {
      console.warn('[VAULT] store 初始化失败:', e instanceof Error ? e.message : String(e))
      return null
    })
  }
  return storePromise
}

/** 读取持久化会话；无则返回 null */
export async function vaultGetSession(): Promise<VaultSession | null> {
  const store = await initStore()
  if (!store) return null
  const session = await store.get<VaultSession>(SESSION_KEY)
  if (!session || !session.access_token || !session.refresh_token) return null
  return session
}

/** 保存持久化会话（仅 token，绝不含密码） */
export async function vaultSetSession(session: VaultSession): Promise<void> {
  const store = await initStore()
  if (!store) return
  await store.set(SESSION_KEY, session)
  await store.save()
}

/** 清除持久化会话（登出） */
export async function vaultClearSession(): Promise<void> {
  const store = await initStore()
  if (!store) return
  await store.delete(SESSION_KEY)
  await store.save()
}
