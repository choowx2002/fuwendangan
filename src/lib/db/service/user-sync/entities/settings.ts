/**
 * 设置白名单实体：按键 LWW（updated_at = sync_meta 中 settings:<key>:ts 游标）。
 * 本地用户修改经 settings store 的 onChange 写入该游标；导入应用远端值时用
 * setSyncSettingsApplying 抑制，避免把导入值误记为本地修改。
 */

import { get } from 'svelte/store'
import {
  playerName,
  defaultLanguage,
  locale,
  darkMode,
  rulesTheme,
  setSyncSettingsApplying,
} from '$lib/stores/settings'
import { setSyncMeta, getSyncMeta } from '../../../repository/sync-repository'
import { lwwWinner } from './common'
import type { SyncSetting } from '../types'

const SETTING_TS_PREFIX = 'settings:'
const SETTING_TS_SUFFIX = ':ts'

export function settingTsKey(key: string): string {
  return `${SETTING_TS_PREFIX}${key}${SETTING_TS_SUFFIX}`
}

const STORES: Record<string, { get: () => unknown; set: (v: unknown) => void }> = {
  playerName: { get: () => get(playerName), set: (v) => playerName.set(v as string) },
  defaultLanguage: {
    get: () => get(defaultLanguage),
    set: (v) => defaultLanguage.set(v as string),
  },
  locale: {
    get: () => get(locale),
    set: (v) => locale.set(v as Parameters<typeof locale.set>[0]),
  },
  darkMode: { get: () => get(darkMode), set: (v) => darkMode.set(v as boolean) },
  rulesTheme: { get: () => get(rulesTheme), set: (v) => rulesTheme.set(v as string) },
}

export const SETTING_KEYS = Object.keys(STORES)

/** 提取当前设备全部白名单设置（value + 本地游标时间） */
export async function extractSettings(): Promise<SyncSetting[]> {
  const result: SyncSetting[] = []
  for (const key of SETTING_KEYS) {
    const ts = await getSyncMeta(settingTsKey(key))
    result.push({ key, value: STORES[key].get(), updated_at: ts ?? '' })
  }
  return result
}

/** 按键 LWW 合并（无墓碑） */
export function mergeSettings(opts: {
  local: SyncSetting[]
  remote: SyncSetting[]
  localDeviceId: string
  remoteDeviceId: string
}): SyncSetting[] {
  const localMap = new Map(opts.local.map((s) => [s.key, s]))
  const remoteMap = new Map(opts.remote.map((s) => [s.key, s]))
  const keys = new Set([...localMap.keys(), ...remoteMap.keys()])
  const result: SyncSetting[] = []
  for (const key of keys) {
    const l = localMap.get(key)
    const r = remoteMap.get(key)
    const winner = lwwWinner(l?.updated_at, r?.updated_at, opts.localDeviceId, opts.remoteDeviceId)
    const chosen = winner === 'remote' ? r : l
    if (!chosen) continue
    result.push({ ...chosen })
  }
  return result
}

/** 应用合并后的设置（写 store + 更新游标；抑制 onChange 以免误记本地修改） */
export async function applySettings(settings: SyncSetting[]): Promise<void> {
  if (settings.length === 0) return
  setSyncSettingsApplying(true)
  try {
    for (const s of settings) {
      const store = STORES[s.key]
      if (!store) continue
      store.set(s.value)
      await setSyncMeta(settingTsKey(s.key), s.updated_at)
    }
  } finally {
    setSyncSettingsApplying(false)
  }
}
