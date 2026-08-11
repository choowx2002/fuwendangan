import { writable } from 'svelte/store'
import { Store } from '@tauri-apps/plugin-store'
import { locale as i18nLocale } from 'svelte-i18n'
import { isSupportedLocale, systemLocale } from '$lib/i18n'
import type { ZoneKey } from '$lib/decks/zone'

let storePromise: Promise<Store> | null = null

function getStore() {
  if (!storePromise) {
    storePromise = Store.load('settings.json')
  }
  return storePromise
}

const pendingReads: Promise<unknown>[] = []

export function persistentWritable<T>(key: string, defaultValue: T) {
  const s = writable(defaultValue)

  const ready = getStore().then(async (store) => {
    const value = await store.get<T>(key)
    if (value !== undefined) {
      s.set(value)
    }

    s.subscribe(async (v) => {
      await store.set(key, v)
      await store.save()
    })
  })

  pendingReads.push(ready)
  return s
}

export const showForeignCardArt = persistentWritable('showForeignCardArt', false)

export const darkMode = persistentWritable('darkMode', false)

export const windowAlwaysOnTop = persistentWritable('windowAlwaysOnTop', false)

export const showTTSFeatures = persistentWritable('showTTSFeatures', false)

export const rulesTheme = persistentWritable('rulesTheme', 'parchment')

/** 玩家用户名（用于首页问候 / 卡组图案水印 / 对局记录 / 计分器默认名） */
export const playerName = persistentWritable('playerName', '')

/** 界面语言（zh-CN / en），默认跟随系统语言 */
export const locale = persistentWritable('locale', systemLocale())

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
