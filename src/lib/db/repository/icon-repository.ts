/**
 * 图标信息仓储层
 */

import type { IconDB } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 获取所有图标信息
 */
export async function getIcon(name: string): Promise<IconDB> {
  const db = await getDatabase()
  const results = await db.select<IconDB[]>(
    `SELECT * FROM ${TABLES.ICONS}  WHERE name_zh = ? OR name_en = ?`,
    [name, name]
  )
  return results[0] ?? null
}

/**
 * 获取所有图标信息
 */
export async function getIcons(): Promise<IconDB[]> {
  const db = await getDatabase()
  const results = await db.select<IconDB[]>(`SELECT * FROM ${TABLES.ICONS}`)
  return results
}

/**
 * 保存或更新单个图标信息
 */
export async function saveIcon(icon: IconDB): Promise<void> {
  const db = await getDatabase()

  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.ICONS} (id, name_zh, name_en, url, storage_type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      icon.id,
      icon.name_zh,
      icon.name_en,
      icon.url,
      icon.storage_type,
      icon.created_at,
      icon.updated_at,
    ]
  )
}

/**
 * 批量保存或更新图标信息 (全量同步时常用)
 */
export async function saveIcons(icons: IconDB[]): Promise<void> {
  for (const icon of icons) {
    await saveIcon(icon)
  }
}

/**
 * 清空所有图标信息
 */
export async function clearIcons(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.ICONS}`)
}
