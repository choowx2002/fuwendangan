/**
 * 系列数据仓储层（Supabase → 本地单向同步）
 */

import type { Series } from '../types'
import { getDatabase } from './database'
import { buildUpsertStatements } from './batch'
import { TABLES } from '../config/constants'

let seriesCache: Series[] | null = null

function mapRowToSeries(row: any): Series {
  return {
    ...row,
    is_standard: row.is_standard === 1,
    is_active: row.is_active === 1,
    base_count: row.base_count ?? 0,
    alt_count: row.alt_count ?? 0,
    overnum_count: row.overnum_count ?? 0,
    rune_count: row.rune_count ?? 0,
    token_count: row.token_count ?? 0,
    cover_image: row.cover_image ?? null,
  }
}

/** series 列顺序 */
const SERIES_COLUMNS = [
  'code',
  'name_cn',
  'name_en',
  'release_order',
  'is_standard',
  'is_active',
  'base_count',
  'alt_count',
  'overnum_count',
  'rune_count',
  'token_count',
  'cover_image',
  'created_at',
  'updated_at',
]

function toSeriesRow(s: Series): unknown[] {
  return [
    s.code,
    s.name_cn,
    s.name_en,
    s.release_order,
    s.is_standard ? 1 : 0,
    s.is_active ? 1 : 0,
    s.base_count,
    s.alt_count,
    s.overnum_count,
    s.rune_count,
    s.token_count,
    s.cover_image ?? null,
    s.created_at,
    s.updated_at,
  ]
}

/**
 * 批量保存系列（分块多行 INSERT OR REPLACE，单语句隐式事务）
 */
export async function saveSeries(series: Series[]): Promise<void> {
  seriesCache = null
  const db = await getDatabase()
  const statements = buildUpsertStatements(TABLES.SERIES, SERIES_COLUMNS, series.map(toSeriesRow))
  for (const stmt of statements) {
    await db.execute(stmt.sql, stmt.params)
  }
}

/**
 * 清空系列数据
 */
export async function clearAllSeries(): Promise<void> {
  seriesCache = null
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.SERIES}`)
}

/**
 * 获取全部系列（启用中的排前，其余按 release_order）
 */
export async function getAllSeries(): Promise<Series[]> {
  if (seriesCache) return seriesCache
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT * FROM ${TABLES.SERIES} ORDER BY is_active DESC, release_order DESC, code ASC`
  )
  seriesCache = rows.map(mapRowToSeries)
  return seriesCache
}

/**
 * 清空系列内存缓存（数据库整体重置时调用）
 */
export function clearSeriesCache(): void {
  seriesCache = null
}
