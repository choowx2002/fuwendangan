import { writable } from 'svelte/store'
import { Store } from '@tauri-apps/plugin-store'
import { locale as i18nLocale } from 'svelte-i18n'
import { isSupportedLocale, systemLocale } from '$lib/i18n'

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
