import { writable } from 'svelte/store'
import { Store } from '@tauri-apps/plugin-store'
import { locale as i18nLocale } from 'svelte-i18n'
import { isSupportedLocale, systemLocale } from '$lib/i18n'
import { isTauri } from '$lib/db/env'
import { setSyncMeta } from '$lib/db/repository/sync-repository'
import type { ZoneKey } from '$lib/decks/zone'

let storePromise: Promise<Store> | null = null

function getStore() {
  if (!storePromise) {
    storePromise = Store.load('settings.json')
  }
  return storePromise
}

const pendingReads: Promise<unknown>[] = []

/**
 * 玩家数据同步专用：白名单设置键在用户主动修改时 bump 其同步时间（存 sync_meta 按键游标）。
 * 导入应用远端值时通过 setSyncSettingsApplying 抑制，避免把导入值误记为本地修改。
 */
let syncSettingsApplying = false
export function setSyncSettingsApplying(v: boolean): void {
  syncSettingsApplying = v
}

const SETTING_TS_PREFIX = 'settings:'
const SETTING_TS_SUFFIX = ':ts'

function markSettingChanged(key: string) {
  if (syncSettingsApplying) return
  if (!isTauri) return
  void setSyncMeta(`${SETTING_TS_PREFIX}${key}${SETTING_TS_SUFFIX}`, new Date().toISOString())
}

export function persistentWritable<T>(key: string, defaultValue: T, onChange?: (v: T) => void) {
  const s = writable(defaultValue)

  const ready = getStore().then(async (store) => {
    const value = await store.get<T>(key)
    if (value !== undefined) {
      s.set(value)
    }

    let first = true
    s.subscribe(async (v) => {
      await store.set(key, v)
      await store.save()
      if (onChange && !first) onChange(v)
      first = false
    })
  })

  pendingReads.push(ready)
  return s
}

export const showForeignCardArt = persistentWritable('showForeignCardArt', false)

export const windowAlwaysOnTop = persistentWritable('windowAlwaysOnTop', false)

export const showTTSFeatures = persistentWritable('showTTSFeatures', false)

export const rulesTheme = persistentWritable('rulesTheme', 'parchment', () =>
  markSettingChanged('rulesTheme')
)

/** 玩家用户名（用于首页问候 / 卡组图案水印 / 对局记录 / 计分器默认名） */
export const playerName = persistentWritable('playerName', '', () =>
  markSettingChanged('playerName')
)

/** 界面语言（zh-CN / en），默认跟随系统语言 */
export const locale = persistentWritable('locale', systemLocale(), () =>
  markSettingChanged('locale')
)

/** 默认卡牌语言：新建借还/心愿单/购买清单等记录时的默认语言，初始 SC */
export const defaultLanguage = persistentWritable('defaultLanguage', 'SC', () =>
  markSettingChanged('defaultLanguage')
)

/** 暗色模式 */
export const darkMode = persistentWritable('darkMode', false, () => markSettingChanged('darkMode'))

/** 卡组构建页（竖屏/触屏设备）是否反转上下布局 */
export const revertLayout = persistentWritable('revertLayout', false)

type BuilderCardDisplayMode = 'text' | 'graphic'
type BuilderGroupMode = 'grouped' | 'single'

const DEFAULT_ZONE_DISPLAY_MODES: Record<ZoneKey, BuilderCardDisplayMode> = {
  legend: 'text',
  champion: 'text',
  mainDeck: 'text',
  battlefields: 'text',
  runes: 'text',
  sideboard: 'text',
}

/** 卡组构建页：是否显示所有区域 */
export const builderShowAllZones = persistentWritable('builderShowAllZones', true)

/** 卡组构建页：各区域的 文字/卡图 显示模式 */
export const builderZoneDisplayModes = persistentWritable<Record<ZoneKey, BuilderCardDisplayMode>>(
  'builderZoneDisplayModes',
  DEFAULT_ZONE_DISPLAY_MODES
)

/** 卡组构建页：卡图模式下每行列数 */
export const builderGraphicColumns = persistentWritable('builderGraphicColumns', 4)

/** 卡组构建页：主牌区 合并/单张 显示模式 */
export const builderMainDeckDisplayMode = persistentWritable<BuilderGroupMode>(
  'builderMainDeckDisplayMode',
  'grouped'
)

/** 卡组构建页：备牌区 合并/单张 显示模式 */
export const builderSideboardDisplayMode = persistentWritable<BuilderGroupMode>(
  'builderSideboardDisplayMode',
  'grouped'
)

/** 上次成功备份/导出数据包时间（ISO），用于启动时备份提醒 */
export const lastBackupAt = persistentWritable('lastBackupAt', '')

/** 上次弹过备份提醒的时间（ISO），避免每次启动都打扰 */
export const lastBackupReminderAt = persistentWritable('lastBackupReminderAt', '')

/** 是否启用启动备份提醒（默认关闭） */
export const backupReminderEnabled = persistentWritable('backupReminderEnabled', false)

/** 备份提醒间隔（天），默认 7 */
export const backupReminderDays = persistentWritable('backupReminderDays', 7)

/** Supabase BYO 云同步：用户自己的项目 URL（本地保存，绝不进入 bundle） */
export const syncSupabaseUrl = persistentWritable('syncSupabaseUrl', '')

/** Supabase BYO 云同步：用户自己的项目 anon key（本地保存，绝不进入 bundle） */
export const syncSupabaseAnonKey = persistentWritable('syncSupabaseAnonKey', '')

locale.subscribe((value) => {
  const next = isSupportedLocale(value) ? value : systemLocale()
  i18nLocale.set(next)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next
  }
})

/**
 * settings.json 全部持久化项完成初始读取后的 resolve 标记。
 * 用于在首页等场景判断设置是否已从磁盘加载，避免返回用户短暂看到默认值。
 */
export const settingsStoreReady = Promise.all(pendingReads).then(() => {})
