/**
 * Supabase BYO 登录状态共享 store（设置页 + Sidebar 共用）
 * - userEmail：当前登录邮箱（空串 = 未配置/未登录）
 * - checking：登录状态检查中（避免把检查过程误显示为「未登录」）
 */
import { get } from 'svelte/store'
import { getSupabaseUser } from '$lib/db'
import { syncSupabaseUrl, syncSupabaseAnonKey } from '$lib/stores/settings'

export const supabaseState = $state({
  userEmail: '',
  checking: false,
})

/** 重新查询登录状态；返回当前登录邮箱（未配置/未登录为空串） */
export async function refreshSupabaseUser(): Promise<string> {
  const url = get(syncSupabaseUrl).trim()
  const key = get(syncSupabaseAnonKey).trim()
  if (!url || !key) {
    supabaseState.userEmail = ''
    supabaseState.checking = false
    return ''
  }
  supabaseState.checking = true
  try {
    const user = await getSupabaseUser()
    supabaseState.userEmail = user?.email ?? ''
  } catch {
    supabaseState.userEmail = ''
  } finally {
    supabaseState.checking = false
  }
  return supabaseState.userEmail
}
