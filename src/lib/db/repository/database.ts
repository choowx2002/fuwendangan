/**
 * 数据库连接管理
 * 单例模式，确保全局只有一个数据库实例
 */

import Database from '@tauri-apps/plugin-sql'
import { DB_NAME, TABLE_LIST } from '../config/constants'
import { TABLE_DEFINITIONS } from '../config/schema'
import type { TableStateRow } from '../types'

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
  await db.execute(TABLE_DEFINITIONS.cards_base)
  await db.execute(TABLE_DEFINITIONS.card_prints)
  await db.execute(TABLE_DEFINITIONS.filter_options)
  await db.execute(TABLE_DEFINITIONS.icons)
  await db.execute(TABLE_DEFINITIONS.decks)
  await db.execute(TABLE_DEFINITIONS.deck_cards)
  await db.execute(TABLE_DEFINITIONS.version)
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

export const getTableState = async (): Promise<TableStateRow[] | null> => {
  const db = await getDatabase()

  const placeholders = TABLE_LIST.map(() => '?').join(', ')

  const sql = `
    SELECT
      name,
      SUM(pgsize) AS bytes
    FROM dbstat
    WHERE name IN (${placeholders})
    GROUP BY name;
  `

  const rows = await db.select<TableStateRow[]>(sql, [...TABLE_LIST])

  if (!rows || rows.length === 0) return null

  return rows
}

export async function resetDatabase() {
  const db = await getDatabase()

  try {
    await db.execute('BEGIN TRANSACTION')

    await db.execute('PRAGMA foreign_keys = OFF')

    for (const table of TABLE_LIST) {
      await db.execute(`DELETE FROM "${table}"`)
    }

    // await db.execute('DELETE FROM sqlite_sequence')

    await db.execute('PRAGMA foreign_keys = ON')

    await db.execute('COMMIT')

    await initializeTables(db)

  } catch (err) {
    await db.execute('ROLLBACK')
    throw err
  }
}
