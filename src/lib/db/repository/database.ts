/**
 * 数据库连接管理
 * 单例模式，确保全局只有一个数据库实例
 */

import Database from '@tauri-apps/plugin-sql'
import { DB_NAME, TABLE_LIST, TABLES } from '../config/constants'
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
  await db.execute(TABLE_DEFINITIONS.collection)
  await db.execute(TABLE_DEFINITIONS.collection_langs)
  await db.execute(TABLE_DEFINITIONS.custom_languages)
  await db.execute(TABLE_DEFINITIONS.series)
  await migrateMatchRecordsOppLegend(db)
  await migrateMatchRecordsDeckVersion(db)
  await migrateMatchGamesIsFirst(db)
  await migrateDeckCardsPrintCode(db)
  await migrateDecksTags(db)
  await migrateCardPrintsFlags(db)
  await migrateCollectionLanguages(db)
  await migrateCollectionLangsStatus(db)
  await migrateCollectionOrphans(db)
  await migrateCollectionLangsTimestamps(db)
  await migrateCollectionSeriesInfo(db)
  await migrateSeriesCover(db)
  // 索引依赖迁移后的列，须在迁移之后创建（老库 language_code 列此时才存在）
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_language)
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_status)
  await db.execute(TABLE_DEFINITIONS.idx_collection_series)
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
 * 迁移：为 card_prints 增加闪卡标记列 is_promo / 用户自建打印标记列 is_custom（老库补列）
 */
async function migrateCardPrintsFlags(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(card_prints)`)
  for (const [name, type] of [
    ['is_promo', 'INTEGER DEFAULT 0'],
    ['is_custom', 'INTEGER DEFAULT 0'],
  ] as const) {
    if (!cols.some((c) => c.name === name)) {
      await db.execute(`ALTER TABLE card_prints ADD COLUMN ${name} ${type}`)
    }
  }
}

/**
 * 迁移：collection_langs.language 自由文本 → language_code 标准语言码
 * 1) 列重命名（老库）
 * 2) 存量值规范化（旧别名 → 预设 5 码）
 * 3) 无法映射的存量值自动注册为自定义语言（数据零丢失）
 */
async function migrateCollectionLanguages(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(collection_langs)`)
  const hasLang = cols.some((c) => c.name === 'language')
  const hasCode = cols.some((c) => c.name === 'language_code')

  if (hasLang && !hasCode) {
    await db.execute(`ALTER TABLE collection_langs RENAME COLUMN language TO language_code`)
  } else if (!hasCode) {
    await db.execute(
      `ALTER TABLE collection_langs ADD COLUMN language_code TEXT NOT NULL DEFAULT 'SC'`
    )
  }

  await db.execute(`UPDATE collection_langs SET language_code = CASE
    WHEN upper(trim(language_code)) IN ('EN','SC','TC','JP','KR') THEN upper(trim(language_code))
    WHEN lower(trim(language_code)) IN ('zh','zhcn','zh-cn','中文','简体','简体中文','汉语') THEN 'SC'
    WHEN lower(trim(language_code)) IN ('zh-hant','zh-tw','繁中','繁体','繁体中文') THEN 'TC'
    WHEN lower(trim(language_code)) IN ('ja','japanese','日文','日本語') THEN 'JP'
    WHEN lower(trim(language_code)) IN ('ko','korean','韩文','한국어') THEN 'KR'
    WHEN lower(trim(language_code)) IN ('en','english','英语','英文') THEN 'EN'
    ELSE trim(language_code)
  END`)

  const t = new Date().toISOString()
  await db.execute(
    `INSERT OR IGNORE INTO ${TABLES.CUSTOM_LANGUAGES} (code, name, created_at, updated_at)
     SELECT DISTINCT language_code, language_code, ?, ? FROM collection_langs
     WHERE language_code NOT IN ('EN','SC','TC','JP','KR')`,
    [t, t]
  )
}

/**
 * 迁移：为 collection_langs 增加收藏状态列 status（默认 owned）
 */
async function migrateCollectionLangsStatus(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(collection_langs)`)
  if (!cols.some((c) => c.name === 'status')) {
    await db.execute(`ALTER TABLE collection_langs ADD COLUMN status TEXT NOT NULL DEFAULT 'owned'`)
  }
}

/**
 * 迁移：清理收藏孤儿行
 * 删除 (card_id, card_no_extend) 组合在 card_prints 中不存在的收藏行及其语言行
 */
async function migrateCollectionOrphans(db: Database): Promise<void> {
  await db.execute(
    `DELETE FROM collection WHERE NOT EXISTS (
       SELECT 1 FROM card_prints p
       WHERE p.card_id = collection.card_id AND p.card_no_extend = collection.card_no_extend
     )`
  )
  await db.execute(
    `DELETE FROM collection_langs WHERE collection_id NOT IN (SELECT id FROM collection)`
  )
}

/**
 * 迁移：为 collection_langs 补 created_at / updated_at 时间列（老库缺失，仓储层已使用）
 */
async function migrateCollectionLangsTimestamps(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(collection_langs)`)
  const additions: Record<string, string> = {
    created_at: 'TEXT',
    updated_at: 'TEXT',
  }
  for (const [name, type] of Object.entries(additions)) {
    if (!cols.some((c) => c.name === name)) {
      await db.execute(`ALTER TABLE collection_langs ADD COLUMN ${name} ${type}`)
    }
  }
}

/**
 * 迁移：为 collection 增加 series_code（冗余的印刷系列码）与 last_edited_at（最近录入时间），
 * 并回填存量数据：series_code 取 card_no_extend 前 3 位大写，last_edited_at 取变体最大语言行时间。
 */
async function migrateCollectionSeriesInfo(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(collection)`)
  const additions: Record<string, string> = {
    series_code: 'TEXT',
    last_edited_at: 'TEXT',
  }
  for (const [name, type] of Object.entries(additions)) {
    if (!cols.some((c) => c.name === name)) {
      await db.execute(`ALTER TABLE collection ADD COLUMN ${name} ${type}`)
    }
  }
  await db.execute(
    `UPDATE collection SET series_code = substr(upper(card_no_extend), 1, 3)
     WHERE series_code IS NULL OR series_code = ''`
  )
  await db.execute(
    `UPDATE collection SET last_edited_at = COALESCE(
       (SELECT MAX(cl.updated_at) FROM collection_langs cl WHERE cl.collection_id = collection.id),
       created_at
     )
     WHERE last_edited_at IS NULL`
  )
}

/**
 * 迁移：为 series 增加系列封面图列 cover_image（老库补列）
 */
async function migrateSeriesCover(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(series)`)
  if (!cols.some((c) => c.name === 'cover_image')) {
    await db.execute(`ALTER TABLE series ADD COLUMN cover_image TEXT`)
  }
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
