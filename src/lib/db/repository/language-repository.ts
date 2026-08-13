/**
 * 自定义语言仓储层
 * 预设语言（EN/SC/TC/JP/KR）之外的收藏语言由用户在此注册，便于收藏弹窗下拉选择。
 */

import type { CustomLanguage } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { PRESET_LANGUAGE_CODES } from '../config/languages'

const now = () => new Date().toISOString()

const CODE_RE = /^[A-Z0-9]{2,6}$/

/** 获取全部自定义语言 */
export async function getCustomLanguages(): Promise<CustomLanguage[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT code, name, created_at, updated_at FROM ${TABLES.CUSTOM_LANGUAGES} ORDER BY code ASC`
  )
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }))
}

/** 语言码是否合法：预设 5 码或已注册的自定义语言 */
export async function isLanguageCodeValid(code: string): Promise<boolean> {
  const db = await getDatabase()
  if ((PRESET_LANGUAGE_CODES as readonly string[]).includes(code)) return true
  const rows = await db.select<{ code: string }[]>(
    `SELECT code FROM ${TABLES.CUSTOM_LANGUAGES} WHERE code = ?`,
    [code]
  )
  return rows.length > 0
}

/** 获取全部合法语言码（预设 + 自定义），供导入批量校验（避免逐行查询） */
export async function getValidLanguageCodes(): Promise<Set<string>> {
  const db = await getDatabase()
  const rows = await db.select<{ code: string }[]>(
    `SELECT code FROM ${TABLES.CUSTOM_LANGUAGES}`
  )
  const set = new Set<string>((PRESET_LANGUAGE_CODES as readonly string[]).slice())
  for (const r of rows) set.add(r.code)
  return set
}

/** 添加自定义语言（码格式校验 + 与预设/既有注册查重） */
export async function addCustomLanguage(code: string, name: string): Promise<void> {
  const db = await getDatabase()
  const cleanCode = code.trim().toUpperCase()
  const cleanName = name.trim()

  if (!CODE_RE.test(cleanCode)) throw new Error('语言码需为 2-6 位大写字母或数字')
  if ((PRESET_LANGUAGE_CODES as readonly string[]).includes(cleanCode)) {
    throw new Error(`语言码 ${cleanCode} 为内置语言，无需添加`)
  }
  if (!cleanName) throw new Error('请输入语言名称')

  const dup = await db.select<{ code: string }[]>(
    `SELECT code FROM ${TABLES.CUSTOM_LANGUAGES} WHERE code = ?`,
    [cleanCode]
  )
  if (dup.length > 0) throw new Error(`语言码 ${cleanCode} 已存在`)

  await db.execute(
    `INSERT INTO ${TABLES.CUSTOM_LANGUAGES} (code, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [cleanCode, cleanName, now(), now()]
  )
}

/** 重命名自定义语言（code 为标识，不可改） */
export async function renameCustomLanguage(code: string, name: string): Promise<void> {
  const db = await getDatabase()
  const cleanName = name.trim()
  if (!cleanName) throw new Error('请输入语言名称')
  await db.execute(
    `UPDATE ${TABLES.CUSTOM_LANGUAGES} SET name = ?, updated_at = ? WHERE code = ?`,
    [cleanName, now(), code]
  )
}

/** 删除自定义语言（被收藏引用时拒绝删除） */
export async function deleteCustomLanguage(code: string): Promise<void> {
  const db = await getDatabase()
  const inUse = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${TABLES.COLLECTION_LANGS} WHERE language_code = ?`,
    [code]
  )
  const used = inUse[0]?.n ?? 0
  if (used > 0) {
    throw new Error(`语言 ${code} 正被 ${used} 个收藏条目使用，无法删除`)
  }
  await db.execute(`DELETE FROM ${TABLES.CUSTOM_LANGUAGES} WHERE code = ?`, [code])
}
