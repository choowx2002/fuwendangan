/**
 * 筛选选项仓储层
 */

import type { FilterOptions } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 保存或更新筛选选项
 */
export async function saveFilterOptions(
  options: Omit<FilterOptions, 'id' | 'updated_at'>
): Promise<void> {
  const db = await getDatabase()

  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.FILTER_OPTIONS}
     (id, regions, tags, keywords, advanced_tags, colors, categories, series, rarities, champions,
      energy_min, energy_max, power_min, power_max, return_energy_min, return_energy_max, updated_at)
     VALUES (1, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      JSON.stringify(options.regions),
      JSON.stringify(options.tags),
      JSON.stringify(options.keywords),
      JSON.stringify(options.advanced_tags),
      JSON.stringify(options.colors),
      JSON.stringify(options.categories),
      JSON.stringify(options.series),
      JSON.stringify(options.rarities),
      JSON.stringify(options.champions),
      options.energy_range.min,
      options.energy_range.max,
      options.power_range.min,
      options.power_range.max,
      options.return_energy_range.min,
      options.return_energy_range.max,
      new Date().toISOString(),
    ]
  )
}

/**
 * 获取筛选选项
 */
export async function getFilterOptions(): Promise<FilterOptions | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(`SELECT * FROM ${TABLES.FILTER_OPTIONS} WHERE id = 1`)

  if (rows.length === 0) return null

  const row = rows[0]
  return {
    id: row.id,
    regions: JSON.parse(row.regions || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    keywords: JSON.parse(row.keywords || '[]'),
    advanced_tags: JSON.parse(row.advanced_tags || '[]'),
    colors: JSON.parse(row.colors || '[]'),
    categories: JSON.parse(row.categories || '[]'),
    series: JSON.parse(row.series || '[]'),
    rarities: JSON.parse(row.rarities || '[]'),
    champions: JSON.parse(row.champions || '[]'),
    energy_range: { min: row.energy_min, max: row.energy_max },
    power_range: { min: row.power_min, max: row.power_max },
    return_energy_range: {
      min: row.return_energy_min,
      max: row.return_energy_max,
    },
    updated_at: row.updated_at,
  }
}

/**
 * 删除筛选选项
 */
export async function clearFilterOptions(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.FILTER_OPTIONS} WHERE id = 1`)
}
