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
  await migrateDeckCardsPrintCode(db)
}

/**
 * 迁移：为 deck_cards 增加稳定键 print_code（card_prints.card_no_extend 快照），
 * 并回填已有数据，用于卡图 id 变更后修复卡组引用
 */
async function migrateDeckCardsPrintCode(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(deck_cards)`)
  if (!cols.some((c) => c.name === 'print_code')) {
    await db.execute(`ALTER TABLE deck_cards ADD COLUMN print_code TEXT`)
  }
  await db.execute(
    `UPDATE deck_cards
     SET print_code = (SELECT cp.card_no_extend FROM card_prints cp WHERE cp.id = deck_cards.card_id)
     WHERE print_code IS NULL`
  )
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
    await db.execute(TABLE_DEFINITIONS.DROP)
    // await db.execute('DELETE FROM sqlite_sequence')

    await initializeTables(db)
  } catch (err) {
    throw err
  }
}
