import { addMessages, init, t } from 'svelte-i18n'
import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'

export { t }

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN'

addMessages('en', en)
addMessages('zh-CN', zhCN)

export function isSupportedLocale(value: string | undefined | null): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function systemLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE
  const lang = navigator.language
  if (!lang) return DEFAULT_LOCALE
  const normalized = lang.toLowerCase()
  if (normalized.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
}

init({
  fallbackLocale: DEFAULT_LOCALE,
  initialLocale: systemLocale(),
})
