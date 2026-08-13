/**
 * 玩家数据同步仓储层
 * sync_meta（key/value 元数据）与 sync_tombstones（删除墓碑）的读写。
 * 墓碑写入被 deck/collection 等仓储的硬删路径调用，故放在仓储层避免依赖倒置。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

export interface TombstoneRow {
  id: string
  entity_type: string
  entity_key: string
  updated_at: string
}

/** 读取 sync_meta 单键值（不存在返回 null） */
export async function getSyncMeta(key: string): Promise<string | null> {
  const db = await getDatabase()
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM ${TABLES.SYNC_META} WHERE key = ?`,
    [key]
  )
  return rows.length > 0 ? rows[0].value : null
}

/** 读取全部 sync_meta（key → value） */
export async function getAllSyncMeta(): Promise<Record<string, string>> {
  const db = await getDatabase()
  const rows = await db.select<{ key: string; value: string }[]>(
    `SELECT key, value FROM ${TABLES.SYNC_META}`
  )
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

/** 写入 sync_meta 单键值（upsert） */
export async function setSyncMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `INSERT INTO ${TABLES.SYNC_META} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  )
}

/** 删除 sync_meta 单键 */
export async function deleteSyncMeta(key: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.SYNC_META} WHERE key = ?`, [key])
}

/**
 * 写入墓碑（幂等 upsert）：按 (entity_type, entity_key) 唯一，updated_at 取 max，
 * 避免旧墓碑回写把更新的删除时间倒拨（删除后不应复活）。
 */
export async function addTombstone(
  entityType: string,
  entityKey: string,
  updatedAt?: string
): Promise<void> {
  const db = await getDatabase()
  const ts = updatedAt ?? new Date().toISOString()
  await db.execute(
    `INSERT INTO ${TABLES.SYNC_TOMBSTONES} (id, entity_type, entity_key, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_key) DO UPDATE SET
       updated_at = CASE WHEN excluded.updated_at > ${TABLES.SYNC_TOMBSTONES}.updated_at
         THEN excluded.updated_at ELSE ${TABLES.SYNC_TOMBSTONES}.updated_at END`,
    [Snowflake.generate(), entityType, entityKey, ts]
  )
}

/** 读取指定类型的墓碑（按 updated_at 升序） */
export async function getTombstonesByType(entityType: string): Promise<TombstoneRow[]> {
  const db = await getDatabase()
  return db.select<TombstoneRow[]>(
    `SELECT id, entity_type, entity_key, updated_at FROM ${TABLES.SYNC_TOMBSTONES}
     WHERE entity_type = ? ORDER BY updated_at ASC`,
    [entityType]
  )
}

/** 读取全部墓碑 */
export async function getAllTombstones(): Promise<TombstoneRow[]> {
  const db = await getDatabase()
  return db.select<TombstoneRow[]>(
    `SELECT id, entity_type, entity_key, updated_at FROM ${TABLES.SYNC_TOMBSTONES}`
  )
}

/** 读取单个墓碑（不存在返回 null） */
export async function getTombstone(
  entityType: string,
  entityKey: string
): Promise<TombstoneRow | null> {
  const db = await getDatabase()
  const rows = await db.select<TombstoneRow[]>(
    `SELECT id, entity_type, entity_key, updated_at FROM ${TABLES.SYNC_TOMBSTONES}
     WHERE entity_type = ? AND entity_key = ?`,
    [entityType, entityKey]
  )
  return rows.length > 0 ? rows[0] : null
}

/** 删除指定墓碑（实体复活后清理过期墓碑） */
export async function deleteTombstone(entityType: string, entityKey: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `DELETE FROM ${TABLES.SYNC_TOMBSTONES} WHERE entity_type = ? AND entity_key = ?`,
    [entityType, entityKey]
  )
}

/** 清空全部墓碑 */
export async function clearAllTombstones(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.SYNC_TOMBSTONES}`)
}
