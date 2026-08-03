/**
 * 数据统计仓储层
 * 提供各表的数量与占用大小统计，供设置页「本地数据库」区块使用
 */

import { getDatabase } from './database'
import { TABLES } from '../config/constants'

export interface TableStats {
  cards: number
  prints: number
  decks: number
  deckVersions: number
  deckCards: number
  rules: number
  icons: number
  filterExists: boolean
}

export interface TableSizeStat {
  name: string
  bytes: number
}

const ALL_TABLES = [
  TABLES.CARDS_BASE,
  TABLES.CARD_PRINTS,
  TABLES.DECKS,
  TABLES.DECK_VERSIONS,
  TABLES.DECK_CARDS,
  TABLES.RULES,
  TABLES.ICONS,
  TABLES.FILTER_OPTIONS,
  TABLES.VERSION,
]

/**
 * 获取各表数量统计
 */
export async function getTableCounts(): Promise<TableStats> {
  const db = await getDatabase()

  const count = async (table: string): Promise<number> => {
    const rows = await db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM ${table}`)
    return rows[0]?.count ?? 0
  }

  const [cards, prints, decks, deckVersions, deckCards, rules, icons, filterRows] =
    await Promise.all([
      count(TABLES.CARDS_BASE),
      count(TABLES.CARD_PRINTS),
      count(TABLES.DECKS),
      count(TABLES.DECK_VERSIONS),
      count(TABLES.DECK_CARDS),
      count(TABLES.RULES),
      count(TABLES.ICONS),
      db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM ${TABLES.FILTER_OPTIONS}`),
    ])

  return {
    cards,
    prints,
    decks,
    deckVersions,
    deckCards,
    rules,
    icons,
    filterExists: (filterRows[0]?.count ?? 0) > 0,
  }
}

/**
 * 获取各表占用大小（基于 SQLite dbstat）
 */
export async function getTableSizes(): Promise<TableSizeStat[]> {
  const db = await getDatabase()

  const placeholders = ALL_TABLES.map(() => '?').join(', ')

  const sql = `
    SELECT
      name,
      SUM(pgsize) AS bytes
    FROM dbstat
    WHERE name IN (${placeholders})
    GROUP BY name;
  `

  const rows = await db.select<TableSizeStat[]>(sql, [...ALL_TABLES])

  if (!rows || rows.length === 0) return []

  const sizeMap = new Map(rows.map((r) => [r.name, r.bytes]))

  return ALL_TABLES.map((name) => ({ name, bytes: sizeMap.get(name) ?? 0 }))
}
