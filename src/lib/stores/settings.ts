import { writable } from 'svelte/store'
import { Store } from '@tauri-apps/plugin-store'

let storePromise: Promise<Store> | null = null

function getStore() {
  if (!storePromise) {
    storePromise = Store.load('settings.json')
  }
  return storePromise
}

export function persistentWritable<T>(key: string, defaultValue: T) {
  const s = writable(defaultValue)

  getStore().then(async store => {
    const value = await store.get<T>(key)
    if (value !== undefined) {
      s.set(value)
    }

    s.subscribe(async v => {
      await store.set(key, v)
      await store.save()
    })
  })

  return s
}

export const showForeignCardArt = persistentWritable(
  'showForeignCardArt',
  false
)

export const darkMode = persistentWritable(
  'darkMode',
  false
)

export const showTTSFeatures = persistentWritable(
  'showTTSFeatures',
  false
)