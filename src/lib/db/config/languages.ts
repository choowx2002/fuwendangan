/**
 * 收藏语言配置
 * 预设语言码 + 本地化显示名；预设之外的语言由用户在设置页注册为自定义语言（custom_languages 表）。
 */

export const PRESET_LANGUAGE_CODES = ['EN', 'SC', 'TC', 'JP', 'KR', 'FR'] as const

export const LANGUAGE_NAMES: Record<string, { zh: string; en: string }> = {
  EN: { zh: '英语', en: 'English' },
  SC: { zh: '简体中文', en: 'Simplified Chinese' },
  TC: { zh: '繁体中文', en: 'Traditional Chinese' },
  JP: { zh: '日语', en: 'Japanese' },
  KR: { zh: '韩语', en: 'Korean' },
  FR: { zh: '法语', en: 'French' },
}

/** 旧版自由文本 → 预设语言码 的别名映射 */
const LANGUAGE_ALIASES: Record<string, string> = {
  zh: 'SC',
  zhcn: 'SC',
  'zh-cn': 'SC',
  中文: 'SC',
  简体: 'SC',
  简体中文: 'SC',
  汉语: 'SC',
  'zh-hant': 'TC',
  'zh-tw': 'TC',
  繁中: 'TC',
  繁体: 'TC',
  繁体中文: 'TC',
  ja: 'JP',
  japanese: 'JP',
  日文: 'JP',
  日本語: 'JP',
  ko: 'KR',
  korean: 'KR',
  韩文: 'KR',
  한국어: 'KR',
  fr: 'FR',
  french: 'FR',
  français: 'FR',
  法语: 'FR',
  法文: 'FR',
  en: 'EN',
  english: 'EN',
  英语: 'EN',
  英文: 'EN',
}

/**
 * 将任意文本规范化到预设语言码。
 * 命中预设码或别名 → 返回预设码；否则返回 null（由调用方决定查自定义语言或抛错）。
 */
export function normalizePresetCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const upper = trimmed.toUpperCase()
  if ((PRESET_LANGUAGE_CODES as readonly string[]).includes(upper)) return upper
  const lower = trimmed.toLowerCase()
  return LANGUAGE_ALIASES[lower] ?? LANGUAGE_ALIASES[trimmed] ?? null
}

/**
 * 语言展示名：预设 → 本地化名；自定义 → 自定义名；未知 → 原码。
 * customNames 为 custom_languages 表的 code → name 映射。
 */
export function languageDisplayName(code: string, customNames?: Map<string, string>): string {
  const preset = LANGUAGE_NAMES[code]
  if (preset) return `${code} — ${preset.zh}`
  const custom = customNames?.get(code)
  if (custom) return `${code} — ${custom}`
  return code
}
