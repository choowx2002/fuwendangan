/**
 * 版本信息仓储层
 * 按表同步：version 表每行对应一张同步表（name = 表标识，updated_at = 最后同步时间）。
 */

import type { AppVersion } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 获取最新版本信息（按 updated_at 取最新行，用于「是否存在同步记录」判断与展示）
 */
export async function getVersion(): Promise<AppVersion | null> {
  const db = await getDatabase()
  const results = await db.select<AppVersion[]>(
    `SELECT * FROM ${TABLES.VERSION} ORDER BY updated_at DESC LIMIT 1`
  )

  return results.length > 0 ? results[0] : null
}

/**
 * 获取全部同步表的版本行（name → updated_at）
 */
export async function getVersions(): Promise<AppVersion[]> {
  const db = await getDatabase()
  return db.select<AppVersion[]>(`SELECT * FROM ${TABLES.VERSION}`)
}

/**
 * 按表 upsert 版本信息（name 唯一，同一张表只保留一行）
 */
export async function upsertTableVersion(name: string, updatedAt: string): Promise<void> {
  const db = await getDatabase()

  await db.execute(
    `INSERT INTO ${TABLES.VERSION} (name, updated_at) VALUES ($1, $2)
     ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`,
    [name, updatedAt]
  )
}

/**
 * 删除版本信息
 */
export async function clearVersion(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.VERSION}`)
}
