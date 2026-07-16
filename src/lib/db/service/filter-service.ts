/**
 * 筛选选项服务层
 */

import { getDatabase } from '../repository/database'
import { TABLES } from '../config/constants'
import type { FilterOptions } from '../types'
import { saveFilterOptions as saveFilterOptionsRepo } from '../repository/filter-repository'

/**
 * 计算并更新筛选选项
 */
export async function updateFilterOptions(): Promise<void> {
  console.log('[SQLite] 开始计算 Filter Options...')

  const db = await getDatabase()

  // 1. 获取所有数组和文本类的去重选项
  const optionsSql = `
    SELECT
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM ${TABLES.CARDS_BASE}, json_each(region) WHERE value IS NOT NULL)) as regions,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM ${TABLES.CARDS_BASE}, json_each(tag) WHERE value IS NOT NULL)) as tags,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM ${TABLES.CARDS_BASE}, json_each(keyword) WHERE value IS NOT NULL)) as keywords,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM ${TABLES.CARDS_BASE}, json_each(advanced_tag) WHERE value IS NOT NULL)) as advanced_tags,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM ${TABLES.CARDS_BASE}, json_each(card_color_list) WHERE value IS NOT NULL)) as colors,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM ${TABLES.CARDS_BASE}, json_each(card_category) WHERE value IS NOT NULL)) as categories,
      
      (SELECT json_group_array(val) FROM (SELECT DISTINCT series_name as val FROM ${TABLES.CARDS_BASE} WHERE series_name IS NOT NULL)) as series,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT rarity_name as val FROM ${TABLES.CARDS_BASE} WHERE rarity_name IS NOT NULL)) as rarities,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT champion_tag as val FROM ${TABLES.CARDS_BASE} WHERE champion_tag IS NOT NULL)) as champions
    ;
  `
  const optionsRow = await db.select<any[]>(optionsSql)
  const opts = optionsRow[0] || {}

  // 2. 获取数值字段的极值
  const rangeSql = `
    SELECT
      COALESCE(min(energy), 0) as energy_min, COALESCE(max(energy), 0) as energy_max,
      COALESCE(min(power), 0) as power_min, COALESCE(max(power), 0) as power_max,
      COALESCE(min(return_energy), 0) as return_energy_min, COALESCE(max(return_energy), 0) as return_energy_max
    FROM ${TABLES.CARDS_BASE};
  `
  const rangeRow = await db.select<any[]>(rangeSql)
  const ranges = rangeRow[0] || {}

  // 3. 组装并保存
  await saveFilterOptionsRepo({
    regions: JSON.parse(opts.regions || '[]'),
    tags: JSON.parse(opts.tags || '[]'),
    keywords: JSON.parse(opts.keywords || '[]'),
    advanced_tags: JSON.parse(opts.advanced_tags || '[]'),
    colors: JSON.parse(opts.colors || '[]'),
    categories: JSON.parse(opts.categories || '[]'),
    series: JSON.parse(opts.series || '[]'),
    rarities: JSON.parse(opts.rarities || '[]'),
    champions: JSON.parse(opts.champions || '[]'),
    energy_range: { min: ranges.energy_min, max: ranges.energy_max },
    power_range: { min: ranges.power_min, max: ranges.power_max },
    return_energy_range: {
      min: ranges.return_energy_min,
      max: ranges.return_energy_max,
    },
  })

  console.log('[SQLite] Filter Options 更新完成')
}

/**
 * 获取筛选选项（代理到 repository）
 */
export { getFilterOptions } from '../repository/filter-repository'
