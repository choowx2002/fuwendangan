/**
 * Supabase BYO（用户自己的项目）云同步传输层
 * - 独立于内容同步客户端：使用用户在设置里填写的 URL + anon key（仅存本机，绝不进 bundle）。
 * - 存储模型：单行 `user_sync_bundle(user_id, device_id, updated_at, data jsonb)`，整包 upsert；
 *   全量 pull/push，冲突由客户端合并引擎解决（免费版 API 请求配额友好）。
 * - 身份：邮箱密码登录（免费版可用且跨设备），RLS `auth.uid() = user_id`。
 * - 免费版适配：闲置 7 天自动暂停、暂停后 URL 可能变更 → 提供 testConnection 与友好错误提示。
 */

import {
  createClient,
  isAuthSessionMissingError,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
import { get } from 'svelte/store'
import { syncSupabaseUrl, syncSupabaseAnonKey } from '$lib/stores/settings'
import { vaultGetSession, vaultSetSession, vaultClearSession } from './vault'
import type { SyncBundleBody } from './types'

export const SUPABASE_SYNC_TABLE = 'user_sync_bundle'

/** 远端数据：body 为空表示云端尚无数据 */
export interface RemoteBundleData {
  body: SyncBundleBody | null
  remoteDeviceId: string | null
}

let byoClient: SupabaseClient | null = null
let byoClientKey = ''
let sessionRestorePromise: Promise<void> | null = null

/** 按当前 URL/key 构造（或复用）BYO 客户端；未配置返回 null */
export function getByoClient(): SupabaseClient | null {
  const url = get(syncSupabaseUrl).trim()
  const key = get(syncSupabaseAnonKey).trim()
  if (!url || !key) return null
  const cacheKey = `${url}|${key}`
  if (byoClient && byoClientKey === cacheKey) return byoClient
  // persistSession: false → 会话不写 localStorage（移动端 WebView 易丢/明文），改由本地 store 持久化
  byoClient = createClient(url, key, {
    auth: {
      storageKey: 'sb-rune-archive-byo-auth-token',
      persistSession: false,
    },
  })
  byoClientKey = cacheKey
  // URL/key 变化（含设置延迟加载后首次配置）→ 重置恢复游标，重新尝试从 vault 恢复会话
  sessionRestorePromise = null
  return byoClient
}

/** 从本地 store 恢复会话（幂等：成功一次即跳过）；无会话时零成本返回 */
export async function ensureSession(): Promise<void> {
  if (!sessionRestorePromise) {
    sessionRestorePromise = (async () => {
      const client = getByoClient()
      const session = await vaultGetSession()
      if (!client || !session) return
      try {
        const { error } = await client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        })
        if (error) throw error
      } catch {
        // access_token 已过期：尝试用 refresh_token 刷新；失败则清除 vault 会话
        try {
          const { error } = await client.auth.refreshSession({
            refresh_token: session.refresh_token,
          })
          if (error) throw error
        } catch {
          await vaultClearSession()
        }
      }
    })()
  }
  await sessionRestorePromise
}

/** 当前登录用户（未配置/未登录返回 null） */
export async function getSupabaseUser(): Promise<User | null> {
  const client = getByoClient()
  if (!client) return null
  await ensureSession()
  const { data, error } = await client.auth.getUser()
  if (error) console.warn('[SYNC] getSupabaseUser error:', error.message, '| status=', (error as { status?: number }).status)
  return data.user ?? null
}

/** 邮箱密码登录 */
export async function signInSupabase(email: string, password: string): Promise<void> {
  const client = getByoClient()
  if (!client) throw new Error('请先填写 Supabase URL 与 anon key')
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  if (data.session) {
    await vaultSetSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? 0,
    })
  }
}

/** 登出 */
export async function signOutSupabase(): Promise<void> {
  const client = getByoClient()
  if (!client) return
  await client.auth.signOut()
  await vaultClearSession()
}

/** 拉取远端 bundle（单行；云端无数据时 body=null） */
export async function fetchRemoteBody(): Promise<RemoteBundleData> {
  const client = getByoClient()
  const user = await getSupabaseUser()
  if (!client) throw new Error('未配置 Supabase URL / anon key')
  if (!user) throw new Error('未登录，请先登录')
  const { data, error } = await client
    .from(SUPABASE_SYNC_TABLE)
    .select('device_id, data')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) {
    console.error('[SYNC] fetchRemoteBody 失败:', transportError(error).message, '| code=', (error as { code?: string }).code)
    throw transportError(error)
  }
  if (!data) return { body: null, remoteDeviceId: null }
  return {
    body: (data.data as SyncBundleBody) ?? null,
    remoteDeviceId: (data.device_id as string) ?? null,
  }
}

/** 推送整包 bundle（upsert 单行） */
export async function pushBody(body: SyncBundleBody, deviceId: string): Promise<void> {
  const client = getByoClient()
  const user = await getSupabaseUser()
  if (!client) throw new Error('未配置 Supabase URL / anon key')
  if (!user) throw new Error('未登录，请先登录')
  const { error } = await client.from(SUPABASE_SYNC_TABLE).upsert(
    {
      user_id: user.id,
      device_id: deviceId,
      updated_at: new Date().toISOString(),
      data: body,
    },
    { onConflict: 'user_id' }
  )
  if (error) {
    console.error('[SYNC] pushBody 失败:', transportError(error).message, '| code=', (error as { code?: string }).code)
    throw transportError(error)
  }
}

export interface ConnectionTestResult {
  ok: boolean
  /** no_config | signed_in | not_signed_in | table_missing | paused_or_network | error */
  code: string
  detail: string
}

/**
 * 连接测试：
 * 1. 未配置 URL/key → no_config
 * 2. auth.getUser 失败（项目暂停/URL 错误/断网）→ paused_or_network
 * 3. 查表失败（未建表）→ table_missing
 * 4. 通过 → signed_in / not_signed_in
 */
export async function testSupabaseConnection(): Promise<ConnectionTestResult> {
  const client = getByoClient()
  if (!client) return { ok: false, code: 'no_config', detail: '' }
  await ensureSession()
  let user: User | null = null
  try {
    const { data, error } = await client.auth.getUser()
    if (error) {
      // 未登录（本地无会话，非网络请求失败）→ 不视为暂停/断网，继续走查表验证连通性
      if (!isAuthSessionMissingError(error)) {
        return { ok: false, code: 'paused_or_network', detail: error.message }
      }
    } else {
      user = data.user ?? null
    }
  } catch (e) {
    return {
      ok: false,
      code: 'paused_or_network',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  try {
    const { error } = await client.from(SUPABASE_SYNC_TABLE).select('user_id').limit(1)
    if (error) {
      if ((error as { code?: string }).code === '42P01') {
        return { ok: false, code: 'table_missing', detail: error.message }
      }
      return { ok: false, code: 'error', detail: error.message }
    }
  } catch (e) {
    return {
      ok: false,
      code: 'paused_or_network',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  return { ok: true, code: user ? 'signed_in' : 'not_signed_in', detail: '' }
}

/** 建表 + RLS SQL（用户在自己的项目 SQL Editor 里运行） */
export function buildSupabaseCreateTableSql(): string {
  return `-- Rune Archive 玩家数据云同步（BYO）
-- 在 Supabase Dashboard → SQL Editor 中粘贴并运行

create table if not exists public.${SUPABASE_SYNC_TABLE} (
  user_id uuid primary key,
  device_id text not null,
  updated_at timestamptz not null default now(),
  data jsonb not null
);

alter table public.${SUPABASE_SYNC_TABLE} enable row level security;

create policy "own bundle read" on public.${SUPABASE_SYNC_TABLE}
  for select using (auth.uid() = user_id);

create policy "own bundle write" on public.${SUPABASE_SYNC_TABLE}
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
`
}

/** 把 PostgREST/网络错误映射为面向用户的提示（免费版暂停/URL 变更常见） */
function transportError(error: unknown): Error {
  const code = (error as { code?: string })?.code
  if (code === '42P01') {
    return new Error('云端尚未建表，请先在 Supabase SQL Editor 运行「复制建表 SQL」')
  }
  if (code === 'PGRST301' || code === 'PGRST302') {
    return new Error('无有效权限：请检查是否已登录，或建表 SQL 的 RLS 策略是否已运行')
  }
  const msg = error instanceof Error ? error.message : String(error)
  // 免费版项目暂停/网络失败通常表现为 fetch 失败或 auth 失败
  return new Error(
    `${msg || '连接失败'}（若为免费版项目：闲置 7 天会被暂停，请到 Supabase Dashboard 恢复；暂停恢复后 URL 可能变更，需重新填写）`
  )
}
