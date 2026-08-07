/**
 * 数据统计仓储层
 * 提供数据库整体与各表的数量、占用大小统计，供设置页「本地数据库」区块使用
 */

import { getDatabase } from './database'

export interface DbTableStat {
  name: string
  label: string
  count: number
  bytes: number
}

export interface DbStats {
  totalBytes: number
  tables: DbTableStat[]
}

const TABLE_LABELS: Record<string, string> = {
  cards_base: '卡牌基础数据',
  card_prints: '卡图数据',
  decks: '卡组',
  deck_versions: '卡组版本',
  deck_cards: '卡组卡牌',
  rules: '规则',
  icons: '图标',
  filter_options: '筛选设置',
  version: '同步版本',
  collection: '收藏',
  collection_langs: '收藏语言',
  custom_languages: '自定义语言',
  series: '系列',
  match_records: '对局记录',
  match_games: '对局局数',
}

const DISPLAY_TABLES = Object.keys(TABLE_LABELS)

/**
 * 获取数据库统计：
 * - totalBytes 基于 PRAGMA page_count * page_size（文件真实占用，不依赖 dbstat 的 SUM(pgsize)）
 * - 各表 bytes 来自一次 dbstat 全量扫描，并将索引页按 sqlite_master 归并到其基表；
 *   存在点号命名（table.index）时按 substr 截取基表名兼容
 * - 各表 count 为 COUNT(*)（Promise.all 并行）
 */
export async function getDbStats(): Promise<DbStats> {
  const db = await getDatabase()

  const [pageCountRows, pageSizeRows, sizeRows, ...countRows] = await Promise.all([
    db.select<{ page_count: number }[]>('PRAGMA page_count'),
    db.select<{ page_size: number }[]>('PRAGMA page_size'),
    db.select<{ table_name: string; bytes: number }[]>(
      `SELECT
         CASE WHEN instr(d.name, '.') > 0
              THEN substr(d.name, 1, instr(d.name, '.') - 1)
              ELSE COALESCE(m.tbl_name, d.name)
         END AS table_name,
         SUM(d.pgsize) AS bytes
       FROM dbstat d
       LEFT JOIN (SELECT name, tbl_name FROM sqlite_master WHERE type = 'index') m
         ON m.name = d.name
       GROUP BY 1`
    ),
    ...DISPLAY_TABLES.map((t) =>
      db.select<{ count: number }[]>(`SELECT COUNT(*) AS count FROM ${t}`)
    ),
  ])

  const pageCount = pageCountRows[0]?.page_count ?? 0
  const pageSize = pageSizeRows[0]?.page_size ?? 0
  const totalBytes = pageCount * pageSize

  const sizeMap = new Map<string, number>()
  for (const row of sizeRows ?? []) {
    sizeMap.set(row.table_name, (sizeMap.get(row.table_name) ?? 0) + row.bytes)
  }

  const tables: DbTableStat[] = DISPLAY_TABLES.map((name, i) => ({
    name,
    label: TABLE_LABELS[name],
    count: countRows[i]?.[0]?.count ?? 0,
    bytes: sizeMap.get(name) ?? 0,
  }))

  return { totalBytes, tables }
}
