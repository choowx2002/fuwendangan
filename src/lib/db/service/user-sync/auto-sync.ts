/**
 * 启动时自动同步检测（仅 Tauri）
 * - 前置条件：开关开启 + 已配置 Supabase URL/key + 已登录。
 * - 判断：云端 updated_at > 本地 last_sync → 弹框确认 → syncViaSupabase()。
 * - 断网/项目暂停/未配置等一律静默跳过，不打扰用户。
 */

import { ask } from '@tauri-apps/plugin-dialog'
import { get } from 'svelte/store'
import { isTauri } from '$lib/db/env'
import { syncSupabaseUrl, syncSupabaseAnonKey, autoSyncEnabled } from '$lib/stores/settings'
import { getLastSync } from './state'
import { fetchRemoteMeta, getSupabaseUser } from './supabase-transport'
import { t } from '$lib/i18n'

/** 启动后检测云端是否有更新；有则弹框确认后同步（幂等，失败静默） */
export async function checkAutoSyncOnLaunch(): Promise<void> {
  try {
    if (!isTauri) return
    if (!get(autoSyncEnabled)) return
    if (!get(syncSupabaseUrl).trim() || !get(syncSupabaseAnonKey).trim()) return
    const user = await getSupabaseUser()
    if (!user) return

    const meta = await fetchRemoteMeta()
    if (!meta?.updatedAt) return

    const lastSync = await getLastSync()
    if (lastSync && meta.updatedAt <= lastSync) return

    const accepted = await ask(get(t)('settings.autoSyncPrompt'), {
      title: get(t)('settings.autoSyncPromptTitle'),
      kind: 'info',
      okLabel: get(t)('settings.autoSyncConfirm'),
      cancelLabel: get(t)('common.cancel'),
    })
    if (!accepted) return

    // 动态导入避免与 index.ts 的 re-export 形成循环依赖
    const { syncViaSupabase } = await import('./index')
    await syncViaSupabase()
  } catch {
    // 断网 / 项目暂停 / 未配置等，静默跳过，不阻断启动
  }
}
