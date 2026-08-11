/**
 * 数据库连接管理
 * 单例模式，确保全局只有一个数据库实例
 */

import Database from '@tauri-apps/plugin-sql'
import { DB_NAME, TABLES } from '../config/constants'
import { TABLE_DEFINITIONS } from '../config/schema'

let dbPromise: Promise<Database> | null = null

/**
 * 数据库操作串行队列：
 * tauri-plugin-sql 底层是 sqlx 连接池（默认最多 10 个连接，插件未暴露池配置），
 * 跨多次 db.execute 的事务（BEGIN/COMMIT）若落在不同连接上，会因写锁互斥报「database is locked」。
 * 通过全局 promise 队列保证任何时刻只有一个 db 操作在跑 → 池子实际只开 1 个连接，
 * 事务、PRAGMA defer_foreign_keys 等依赖同一连接的语义才能可靠生效。
 */
let dbQueue: Promise<unknown> = Promise.resolve()

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbQueue.then(fn)
  dbQueue = run.catch(() => {})
  return run
}

function serializeDatabase(db: Database): void {
  const rawSelect = db.select.bind(db)
  const rawExecute = db.execute.bind(db)
  const rawClose = db.close.bind(db)
  ;(db as any).select = ((query: string, bindValues?: unknown[]) =>
    serialized(() => rawSelect(query, bindValues))) as typeof db.select
  ;(db as any).execute = ((query: string, bindValues?: unknown[]) =>
    serialized(() => rawExecute(query, bindValues))) as typeof db.execute
  ;(db as any).close = ((name?: string) => serialized(() => rawClose(name))) as typeof db.close
}

/**
 * 获取或创建数据库实例
 * 使用共享 Promise 缓存：并发调用方（布局层 init 与页面组件挂载时的查询）
 * 共享同一次 load + initializeTables，避免在刷新/首屏时重复打开连接池、
 * 对同一 SQLite 文件并发执行写语句导致「database is locked」。
 * @returns 数据库实例
 */
export async function getDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_NAME)
      // 瞬时锁冲突改为短重试（默认 busy_timeout=0 会直接报错）
      await db.execute('PRAGMA busy_timeout = 5000')
      await initializeTables(db)
      serializeDatabase(db)
      return db
    })().catch((err) => {
      // 初始化失败不污染后续调用：清空缓存，下次 getDatabase() 自动重试
      dbPromise = null
      throw err
    })
  }
  return dbPromise
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
  await db.execute(TABLE_DEFINITIONS.collection_history)
  await db.execute(TABLE_DEFINITIONS.collection_history_items)
  await db.execute(TABLE_DEFINITIONS.collection_stats_snapshots)
  await db.execute(TABLE_DEFINITIONS.lockers)
  await db.execute(TABLE_DEFINITIONS.locker_sections)
  await db.execute(TABLE_DEFINITIONS.locker_cards)
  await db.execute(TABLE_DEFINITIONS.idx_locker_sections_locker)
  await db.execute(TABLE_DEFINITIONS.idx_locker_cards_section)
  await db.execute(TABLE_DEFINITIONS.idx_locker_cards_card)
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_language)
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_status)
  await db.execute(TABLE_DEFINITIONS.idx_collection_series)
  await db.execute(TABLE_DEFINITIONS.idx_card_prints_variant)
  await db.execute(TABLE_DEFINITIONS.idx_collection_langs_collection)
  await db.execute(TABLE_DEFINITIONS.idx_collection_history_created)
  await db.execute(TABLE_DEFINITIONS.idx_collection_history_items_history)
  await db.execute(TABLE_DEFINITIONS.idx_collection_stats_snapshots_created)

  await ensureColumn(db, TABLES.MATCH_RECORDS, 'player_name', 'TEXT')
  await ensureColumn(db, TABLES.CARD_PRINTS, 'card_no', 'TEXT')
  await ensureColumn(db, TABLES.CARDS_BASE, 'deck_limit', 'INTEGER')
  await ensureColumn(db, TABLES.SERIES, 'cover_image', 'TEXT')
  await ensureColumn(db, TABLES.LOCKER_SECTIONS, 'color', 'TEXT')
  await ensureColumn(db, TABLES.LOCKER_SECTIONS, 'icon', 'TEXT')
  await ensureColumn(db, TABLES.LOCKER_SECTIONS, 'tags', 'TEXT')
  await ensureColumn(db, TABLES.LOCKERS, 'icon', 'TEXT')
  await ensureColumn(db, TABLES.LOCKERS, 'tags', 'TEXT')

  // 一次性语义迁移：仅当 version 表确实存在遗留行（name 非同步表名或为 NULL）时才写库，
  // 迁移完成后每次加载退化为只读 COUNT，不再拿写锁。
  const placeholders = SYNC_TABLE_NAMES.map(() => '?').join(', ')
  const legacyRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${TABLES.VERSION} WHERE name IS NULL OR name NOT IN (${placeholders})`,
    SYNC_TABLE_NAMES
  )
  if ((legacyRows[0]?.n ?? 0) > 0) {
    await migrateVersionSemantics(db)
  }

  // name 唯一索引在语义迁移之后创建，避免老库遗留重复 name 导致建索引失败
  await db.execute(TABLE_DEFINITIONS.idx_version_name)

  // 老库回填 card_prints.card_no 快照：仅当存在缺卡号快照的打印时才写库
  const nullCardNo = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${TABLES.CARD_PRINTS} WHERE card_no IS NULL`
  )
  if ((nullCardNo[0]?.n ?? 0) > 0) {
    await backfillPrintCardNo(db)
  }
}

/**
 * 回填 card_prints.card_no（cards_base.card_no 的稳定快照）：
 * 老库升级时补齐全部存量的 card_no；新库为空表无影响。
 * 由 initializeTables 在读保护（存在 card_no 为 NULL 的行）下调用。
 */
async function backfillPrintCardNo(db: Database): Promise<void> {
  await db.execute(
    `UPDATE ${TABLES.CARD_PRINTS}
     SET card_no = (SELECT card_no FROM ${TABLES.CARDS_BASE} WHERE id = ${TABLES.CARD_PRINTS}.card_id)
     WHERE card_no IS NULL`
  )
}

/**
 * 同步表标识：与云端 version 表的 name 列保持一致。
 */
const SYNC_TABLE_NAMES = ['cards', 'prints', 'icons', 'rules', 'series']

/**
 * 迁移：旧版 version 表的 name 存的是版本号名（如 "v1.0"），
 * 新语义下 name = 同步表标识（每张同步表一行）。
 * 删除不属于同步表标识的遗留行，避免旧行干扰按表同步；空库无影响。
 * 由 initializeTables 在读保护（存在遗留行）下调用。
 */
async function migrateVersionSemantics(db: Database): Promise<void> {
  const placeholders = SYNC_TABLE_NAMES.map(() => '?').join(', ')
  await db.execute(
    `DELETE FROM ${TABLES.VERSION} WHERE name IS NULL OR name NOT IN (${placeholders})`,
    SYNC_TABLE_NAMES
  )
}

/**
 * 为已存在的表补列（老库升级用）。新增列幂等：已存在则跳过。
 */
async function ensureColumn(
  db: Database,
  table: string,
  column: string,
  type: string
): Promise<void> {
  const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`)
  if (cols.some((c) => c.name === column)) return
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

/**
 * 关闭数据库连接（用于应用退出时清理）
 */
export async function closeDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    await db.close()
    dbPromise = null
  }
}

/**
 * 重置数据库实例（主要用于测试）
 */
export function resetDatabaseInstance(): void {
  dbPromise = null
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
