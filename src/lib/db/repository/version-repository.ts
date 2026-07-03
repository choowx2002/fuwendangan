/**
 * 版本信息仓储层
 */

import type { AppVersion } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 获取最新版本信息
 */
export async function getVersion(): Promise<AppVersion | null> {
  const db = await getDatabase()
  const results = await db.select<AppVersion[]>(
    `SELECT * FROM ${TABLES.VERSION} ORDER BY id DESC LIMIT 1`
  )

  return results.length > 0 ? results[0] : null
}

/**
 * 保存或更新版本信息
 */
export async function saveVersion(version: AppVersion): Promise<void> {
  const db = await getDatabase()

  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.VERSION} (id, name, updated_at) VALUES ($1, $2, $3)`,
    [version.id, version.name, version.updated_at]
  )
}

/**
 * 删除版本信息
 */
export async function clearVersion(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.VERSION}`)
}
