/**
 * 卡牌搜索服务层
 * 提供统一的搜索接口，封装复杂的查询逻辑
 */

import type { CardBase, CardPrint, CardSearchParams, CardSearchResult } from '../types'
import { getDatabase } from '../repository/database'
import { buildOrderBy } from '../helper'
import { TABLES } from '../config/constants'

/**
 * 执行卡牌搜索
 */
export async function searchCards(params: CardSearchParams): Promise<CardSearchResult> {
  const db = await getDatabase()

  const { page = 1, pageSize = 30, searchText, is_banned = false } = params
  const whereClauses: string[] = []
  const queryParams: any[] = []

  // 1. 模糊搜索
  if (searchText && searchText.trim() !== '') {
    const safeText = `%${searchText.trim()}%`
    whereClauses.push(`(
      ${TABLES.CARDS_BASE}.card_name_cn LIKE ? OR ${TABLES.CARDS_BASE}.card_name_en LIKE ? OR
      ${TABLES.CARDS_BASE}.effect_cn LIKE ? OR ${TABLES.CARDS_BASE}.champion_tag LIKE ? OR ${TABLES.CARDS_BASE}.effect_en LIKE ?
      OR ${TABLES.CARDS_BASE}.sub_title_cn LIKE ?
    )`)
    queryParams.push(safeText, safeText, safeText, safeText, safeText,safeText)
  }

  // 2. 数组字段过滤
  const arrayFields = ['region', 'tag', 'keyword', 'advanced_tag', 'card_color_list'] as const

  for (const field of arrayFields) {
    const filterParam = params[field] as
      { include?: string[]; must?: string[]; exclude?: string[] } | undefined
    if (!filterParam) continue

    if (filterParam.include && filterParam.include.length > 0) {
      const placeholders = filterParam.include.map(() => '?').join(',')
      whereClauses.push(
        `EXISTS (SELECT 1 FROM json_each(${TABLES.CARDS_BASE}.${field}) WHERE value IN (${placeholders}))`
      )
      queryParams.push(...filterParam.include)
    }

    if (filterParam.must && filterParam.must.length > 0) {
      for (const val of filterParam.must) {
        whereClauses.push(
          `EXISTS (SELECT 1 FROM json_each(${TABLES.CARDS_BASE}.${field}) WHERE value = ?)`
        )
        queryParams.push(val)
      }
    }

    if (filterParam.exclude && filterParam.exclude.length > 0) {
      for (const val of filterParam.exclude) {
        whereClauses.push(
          `NOT EXISTS (SELECT 1 FROM json_each(${TABLES.CARDS_BASE}.${field}) WHERE value = ?)`
        )
        queryParams.push(val)
      }
    }
  }

  // 3. 文本字段精确过滤
  const textFields = ['card_category', 'series_name', 'rarity_name'] as const
  for (const field of textFields) {
    const filterParam = params[field] as
      { include?: string[]; must?: string[]; exclude?: string[] } | undefined
    if (!filterParam) continue

    const includeVals = filterParam.include || []
    const mustVals = filterParam.must || []
    const excludeVals = filterParam.exclude || []

    const matchVals = [...new Set([...includeVals, ...mustVals])]
    if (matchVals.length > 0) {
      const placeholders = matchVals.map(() => '?').join(',')
      whereClauses.push(`${TABLES.CARDS_BASE}.${field} IN (${placeholders})`)
      queryParams.push(...matchVals)
    }

    if (excludeVals.length > 0) {
      const placeholders = excludeVals.map(() => '?').join(',')
      whereClauses.push(`${TABLES.CARDS_BASE}.${field} NOT IN (${placeholders})`)
      queryParams.push(...excludeVals)
    }
  }

  // 4. 数值范围过滤
  const numberFields = ['power', 'energy', 'return_energy'] as const
  for (const field of numberFields) {
    const val = params[field as keyof CardSearchParams] as
      number | { min?: number; max?: number } | undefined
    if (val !== undefined && val !== null) {
      if (typeof val === 'number') {
        whereClauses.push(`${TABLES.CARDS_BASE}.${field} = ?`)
        queryParams.push(val)
      } else {
        if (val.min !== undefined) {
          whereClauses.push(`${TABLES.CARDS_BASE}.${field} >= ?`)
          queryParams.push(val.min)
        }
        if (val.max !== undefined) {
          whereClauses.push(`${TABLES.CARDS_BASE}.${field} <= ?`)
          queryParams.push(val.max)
        }
      }
    }
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  // 5. 获取总数
  const countSql = `SELECT COUNT(*) as total FROM ${TABLES.CARDS_BASE} ${whereStr}`
  const countResult = await db.select<{ total: number }[]>(countSql, queryParams)
  const total = countResult[0]?.total || 0

  // 6. 获取分页数据
  const offset = (page - 1) * pageSize
  const orderBy = buildOrderBy(params.sortByList)
  const dataSql = `
    SELECT ${TABLES.CARDS_BASE}.*
    FROM ${TABLES.CARDS_BASE}
    LEFT JOIN ${TABLES.CARD_PRINTS} ON ${TABLES.CARDS_BASE}.id = ${TABLES.CARD_PRINTS}.card_id
      AND ${TABLES.CARD_PRINTS}.is_default = 1
    ${whereStr}
    ${orderBy}
    LIMIT ? OFFSET ?
  `
  const dataParams = [...queryParams, pageSize, offset]
  const rows = await db.select<any[]>(dataSql, dataParams)

  // 7. 反序列化主表数据
  let cards = rows.map((row) => ({
    ...row,
    card_color_list: row.card_color_list ? JSON.parse(row.card_color_list) : null,
    region: row.region ? JSON.parse(row.region) : null,
    tag: row.tag ? JSON.parse(row.tag) : null,
    keyword: row.keyword ? JSON.parse(row.keyword) : null,
    advanced_tag: row.advanced_tag ? JSON.parse(row.advanced_tag) : null,
    is_banned: row.is_banned === 1,
  }))

  // 8. 获取关联的卡图
  if (cards.length > 0) {
    const idPlaceholders = cards.map(() => '?').join(',')
    const printsSql = `SELECT * FROM ${TABLES.CARD_PRINTS} WHERE card_id IN (${idPlaceholders}) ORDER BY print_order ASC`
    const printsRows = await db.select<any[]>(
      printsSql,
      cards.map((c) => c.id)
    )

    const prints = printsRows.map((row) => ({
      ...row,
      is_default: row.is_default === null ? null : row.is_default === 1,
    }))

    const printsMap = new Map<string, CardPrint[]>()
    for (const p of prints) {
      if (!printsMap.has(p.card_id!)) printsMap.set(p.card_id!, [])
      printsMap.get(p.card_id!)!.push(p)
    }

    cards = cards.map((c) => ({
      ...c,
      card_prints: printsMap.get(c.id) || [],
    }))
  }

  return {
    data: cards,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}
