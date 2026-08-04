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
  await db.execute(TABLE_DEFINITIONS.match_records)
  await db.execute(TABLE_DEFINITIONS.match_games)
  await migrateMatchRecordsOppLegend(db)
  await migrateMatchRecordsDeckVersion(db)
  await migrateMatchGamesIsFirst(db)
  await migrateDeckCardsPrintCode(db)
  await migrateDecksTags(db)
}

/**
 * 迁移：为 match_records 增加对手传奇快照列（老库补列）
 */
async function migrateMatchRecordsOppLegend(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(match_records)`)
  const additions: Record<string, string> = {
    opp_legend_id: 'TEXT',
    opp_legend_print_id: 'TEXT',
    opp_legend_name: 'TEXT',
    opp_legend_image: 'TEXT',
  }
  for (const [name, type] of Object.entries(additions)) {
    if (!cols.some((c) => c.name === name)) {
      await db.execute(`ALTER TABLE match_records ADD COLUMN ${name} ${type}`)
    }
  }
}

/**
 * 迁移：为 match_records 增加卡组版本关联列（老库补列）
 */
async function migrateMatchRecordsDeckVersion(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(match_records)`)
  const additions: Record<string, string> = {
    deck_version_id: 'TEXT',
    deck_version_number: 'INTEGER',
  }
  for (const [name, type] of Object.entries(additions)) {
    if (!cols.some((c) => c.name === name)) {
      await db.execute(`ALTER TABLE match_records ADD COLUMN ${name} ${type}`)
    }
  }
}

/**
 * 迁移：为 match_games 增加先手标记列（1=我方先手，0=对方先手，老库补列）
 */
async function migrateMatchGamesIsFirst(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(match_games)`)
  if (!cols.some((c) => c.name === 'is_first')) {
    await db.execute(`ALTER TABLE match_games ADD COLUMN is_first INTEGER`)
  }
}

/**
 * 迁移：为 decks 增加自定义标签列 tags（JSON 数组字符串）
 */
async function migrateDecksTags(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(decks)`)
  if (!cols.some((c) => c.name === 'tags')) {
    await db.execute(`ALTER TABLE decks ADD COLUMN tags TEXT`)
  }
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
