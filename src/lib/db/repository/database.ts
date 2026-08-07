/**
 * 数据库连接管理
 * 单例模式，确保全局只有一个数据库实例
 */

import Database from '@tauri-apps/plugin-sql'
import { DB_NAME } from '../config/constants'
import { TABLE_DEFINITIONS } from '../config/schema'

let dbInstance: Database | null = null

/**
 * 获取或创建数据库实例
 * @returns 数据库实例
 */
export async function getDatabase(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load(DB_NAME)
    await initializeTables(dbInstance)
  }
  return dbInstance
}

/**
 * 初始化数据库表
 * @param db 数据库实例
 */
async function initializeTables(db: Database): Promise<void> {
  // await db.execute(TABLE_DEFINITIONS.DROP)
  await db.execute(TABLE_DEFINITIONS.cards_base)
  await db.execute(TABLE_DEFINITIONS.card_prints)
  await db.execute(TABLE_DEFINITIONS.filter_options)
  await db.execute(TABLE_DEFINITIONS.icons)
  await db.execute(TABLE_DEFINITIONS.decks)
  await db.execute(TABLE_DEFINITIONS.deck_versions)
  await db.execute(TABLE_DEFINITIONS.deck_cards)
  await db.execute(TABLE_DEFINITIONS.rules)
  await db.execute(TABLE_DEFINITIONS.version)
  await db.execute(TABLE_DEFINITIONS.match_records)
  await db.execute(TABLE_DEFINITIONS.match_games)
  await db.execute(TABLE_DEFINITIONS.collection)
  await db.execute(TABLE_DEFINITIONS.collection_langs)
  await db.execute(TABLE_DEFINITIONS.custom_languages)
  await db.execute(TABLE_DEFINITIONS.series)
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_language)
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_status)
  await db.execute(TABLE_DEFINITIONS.idx_collection_series)
  await db.execute(TABLE_DEFINITIONS.idx_card_prints_variant)
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_collection)
}

/**
 * 关闭数据库连接（用于应用退出时清理）
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close()
    dbInstance = null
  }
}

/**
 * 重置数据库实例（主要用于测试）
 */
export function resetDatabaseInstance(): void {
  dbInstance = null
}

export async function resetDatabase() {
  const db = await getDatabase()

  try {
    await db.execute(TABLE_DEFINITIONS.DROP)
    // await db.execute('DELETE FROM sqlite_sequence')

    const { clearSeriesCache } = await import('./series-repository')
    clearSeriesCache()
    await initializeTables(db)
  } catch (err) {
    throw err
  }
}
