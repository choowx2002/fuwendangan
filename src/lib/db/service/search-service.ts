/**
 * 卡牌搜索服务层
 * 提供统一的搜索接口，封装复杂的查询逻辑
 */

import type {
  CardPrint,
  CardSearchParams,
  CardSearchResult,
  CardVariantSearchParams,
  CardVariantSearchResult,
  CardWithOwned,
  CollectionSort,
  VariantWithOwned,
} from '../types'
import type { VariantBucket } from '$lib/cards/utils/variant-utils'
import { getDatabase } from '../repository/database'
import { buildOrderBy, mapRowToCard, mapRowToPrint } from '../helper'
import { TABLES } from '../config/constants'
import { getCompletionMode } from './completion-modes'
import { getAllSeries } from '../repository/series-repository'

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
      OR ${TABLES.CARDS_BASE}.sub_title_cn LIKE ? OR ${TABLES.CARDS_BASE}.card_no LIKE ?
    )`)
    queryParams.push(safeText, safeText, safeText, safeText, safeText, safeText, safeText)
  }

  // 2. 数组字段过滤
  const arrayFields = [
    'region',
    'tag',
    'keyword',
    'advanced_tag',
    'card_color_list',
    'card_category',
  ] as const

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
  const textFields = ['series_name', 'rarity_name'] as const
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

  // 3.5 收藏页：按卡图印刷系列过滤（card_no_extend 前 3 位，不依赖 cards_base.series_name）。
  // 回退：该卡没有任何已知系列码前缀的非 promo 印刷时，才按 cards_base.series_name 匹配（防御）。
  if (params.seriesCode && params.seriesCode.trim() !== '') {
    const seriesList = await getAllSeries()
    const knownCodes = seriesList.map((s) => s.code.toUpperCase())
    const code = params.seriesCode.trim().toUpperCase()

    const knownIn =
      knownCodes.length > 0 ? knownCodes.map(() => '?').join(',') : 'NULL'
    whereClauses.push(`(
      EXISTS (
        SELECT 1 FROM ${TABLES.CARD_PRINTS} cp
        WHERE cp.card_id = ${TABLES.CARDS_BASE}.id
          AND COALESCE(cp.is_promo, 0) != 1
          AND substr(upper(cp.card_no_extend), 1, 3) = ?
      )
      OR (
        ${TABLES.CARDS_BASE}.series_name = ?
        AND NOT EXISTS (
          SELECT 1 FROM ${TABLES.CARD_PRINTS} cp2
          WHERE cp2.card_id = ${TABLES.CARDS_BASE}.id
            AND COALESCE(cp2.is_promo, 0) != 1
            AND substr(upper(cp2.card_no_extend), 1, 3) IN (${knownIn})
        )
      )
    )`)
    queryParams.push(code, code, ...knownCodes)
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

  if (params.champion_tag && params.champion_tag.trim() !== '') {
    const safeText = `%${params.champion_tag.trim()}%`
    whereClauses.push(`(
      COALESCE(${TABLES.CARDS_BASE}.card_category, '') NOT LIKE '%专属%' 
      OR ${TABLES.CARDS_BASE}.champion_tag LIKE ?
    )`)
    queryParams.push(safeText)
  }

  // 收藏聚合子查询：按卡聚合已拥有数量（仅 owned 状态，所有变体×语言）
  const ownedAgg = `
    SELECT cb.id AS oc_card_id,
      SUM(cl.normal_qty) AS owned_normal,
      SUM(cl.foil_qty) AS owned_foil,
      SUM(cl.normal_qty + cl.foil_qty) AS owned_total,
      MAX(col.last_edited_at) AS oc_last_edited
    FROM ${TABLES.COLLECTION} col
    JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
    JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
    WHERE cl.status = 'owned'
    GROUP BY cb.id
  `

  // 变体完成度聚合：按完成度模式（默认 base）判定变体是否已拥有。
  // 外层按卡聚合 total/owned 变体数，谓词来自 completion-modes 注册表。
  const completion = getCompletionMode(params.completionMode)
  const bucketCase = `CASE
    WHEN cb.card_category LIKE '%符文%' THEN 'rune'
    WHEN cb.card_category LIKE '%指示物%' THEN 'token'
    WHEN MAX(p.extend_rarity_name) = '异画' THEN 'alt'
    WHEN MAX(p.extend_rarity_name) IN ('超编', '签名超编') THEN 'overnum'
    ELSE 'base'
  END`
  const variantAgg = `
    SELECT vc.card_id AS vc_card_id,
      COUNT(*) AS total_variants,
      COUNT(CASE WHEN vc.owned = 1 THEN 1 END) AS owned_variants
    FROM (
      SELECT p.card_id AS card_id, p.card_no_extend AS card_no_extend,
        ${bucketCase} AS bucket,
        MAX(CASE WHEN ${completion.ownedPredicate ?? '1=1'} THEN 1 ELSE 0 END) AS owned
      FROM ${TABLES.CARD_PRINTS} p
      LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
      LEFT JOIN ${TABLES.COLLECTION} col
        ON col.card_no = cb.card_no AND col.card_no_extend = p.card_no_extend
      LEFT JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
      WHERE COALESCE(p.is_promo, 0) != 1
      GROUP BY p.card_id, p.card_no_extend
    ) vc
    WHERE ${completion.bucketPredicate ?? '1=1'}
    GROUP BY vc.card_id
  `

  const baseAlias = TABLES.CARDS_BASE

  // 5. 收藏状态过滤（按卡聚合）
  if (params.ownership && params.ownership !== 'all') {
    const alias = 'oc_agg'
    const inner = `(SELECT 1 FROM (${ownedAgg}) ${alias} WHERE ${alias}.oc_card_id = ${baseAlias}.id`
    if (params.ownership === 'owned') {
      whereClauses.push(`EXISTS ${inner} AND ${alias}.owned_total > 0)`)
    } else if (params.ownership === 'missing') {
      whereClauses.push(`NOT EXISTS ${inner})`)
    } else {
      whereClauses.push(`EXISTS ${inner} AND ${alias}.owned_foil > 0)`)
    }
  }

  // 5.5 收藏页：按变体桶过滤（与 variantAgg 相同的桶分类口径）
  if (params.bucket && params.bucket.trim() !== '') {
    const bucket = params.bucket.trim()
    whereClauses.push(`EXISTS (
      SELECT 1 FROM (
        SELECT p.card_id AS card_id,
          ${bucketCase} AS bucket
        FROM ${TABLES.CARD_PRINTS} p
        JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
        WHERE p.card_id = ${baseAlias}.id AND COALESCE(p.is_promo, 0) != 1
        GROUP BY p.card_id, p.card_no_extend
      ) b WHERE b.bucket = ?
    )`)
    queryParams.push(bucket)
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  // 5. 获取总数
  const countSql = `SELECT COUNT(*) as total FROM ${baseAlias} ${whereStr}`
  const countResult = await db.select<{ total: number }[]>(countSql, queryParams)
  const total = countResult[0]?.total || 0

  // 6. 获取分页数据
  const offset = (page - 1) * pageSize
  const orderBy = params.collectionSort
    ? buildCollectionOrderBy(params.collectionSort, variantAgg)
    : buildOrderBy(params.sortByList)
  const dataSql = `
    SELECT ${baseAlias}.*,
      COALESCE(oc_agg.owned_normal, 0) AS owned_normal,
      COALESCE(oc_agg.owned_foil, 0) AS owned_foil,
      COALESCE(oc_agg.owned_total, 0) AS owned_total,
      COALESCE(vc_agg.owned_variants, 0) AS owned_variants,
      COALESCE(vc_agg.total_variants, 0) AS total_variants,
      oc_agg.oc_last_edited AS last_edited
    FROM ${baseAlias}
    LEFT JOIN (${ownedAgg}) oc_agg ON oc_agg.oc_card_id = ${baseAlias}.id
    LEFT JOIN (${variantAgg}) vc_agg ON vc_agg.vc_card_id = ${baseAlias}.id
    LEFT JOIN ${TABLES.CARD_PRINTS} ON ${baseAlias}.id = ${TABLES.CARD_PRINTS}.card_id
      AND ${TABLES.CARD_PRINTS}.is_default = 1
    ${whereStr}
    ${orderBy}
    LIMIT ? OFFSET ?
  `
  const dataParams = [...queryParams, pageSize, offset]
  const rows = await db.select<any[]>(dataSql, dataParams)

  // 7. 反序列化主表数据
  let cards: CardWithOwned[] = rows.map((row) => ({
    ...mapRowToCard(row),
    ownedNormal: row.owned_normal ?? 0,
    ownedFoil: row.owned_foil ?? 0,
    ownedTotal: row.owned_total ?? 0,
    ownedVariants: row.owned_variants ?? 0,
    totalVariants: row.total_variants ?? 0,
    lastEdited: row.last_edited ?? null,
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

/**
 * 收藏页排序：
 * - card_no：按卡号
 * - rarity：按稀有度层级（普通 < 不凡 < 稀有 < 史诗 < 异画 < 超编 < 签名超编）
 * - owned：按已拥有数量
 * - progress：按拥有进度（已拥有变体 / 全部非 promo 变体）
 * - recent：按最近录入时间（无记录排最后）
 */
function buildCollectionOrderBy(
  sort: { key: string; isAsc: boolean },
  variantAgg: string
): string {
  const dir = sort.isAsc ? 'ASC' : 'DESC'
  const baseAlias = TABLES.CARDS_BASE

  switch (sort.key) {
    case 'card_no':
      return `ORDER BY ${baseAlias}.card_no COLLATE NOCASE ${dir}`
    case 'rarity':
      return `ORDER BY CASE
        WHEN ${baseAlias}.card_category LIKE '%指示物%' THEN 0
        WHEN ${baseAlias}.card_category LIKE '%符文%' THEN 1
        WHEN ${TABLES.CARD_PRINTS}.extend_rarity_name = '异画' THEN 6
        WHEN ${TABLES.CARD_PRINTS}.extend_rarity_name = '超编' THEN 7
        WHEN ${TABLES.CARD_PRINTS}.extend_rarity_name = '签名超编' THEN 8
        WHEN ${TABLES.CARD_PRINTS}.rarity_name = '普通' THEN 2
        WHEN ${TABLES.CARD_PRINTS}.rarity_name = '不凡' THEN 3
        WHEN ${TABLES.CARD_PRINTS}.rarity_name = '稀有' THEN 4
        WHEN ${TABLES.CARD_PRINTS}.rarity_name = '史诗' THEN 5
        ELSE 9
      END ${dir}, ${baseAlias}.card_no COLLATE NOCASE ASC`
    case 'owned':
      return `ORDER BY oc_agg.owned_total ${dir}, ${baseAlias}.card_no COLLATE NOCASE ASC`
    case 'progress':
      return `ORDER BY CASE
        WHEN vc_agg.total_variants IS NULL OR vc_agg.total_variants = 0 THEN NULL
        ELSE vc_agg.owned_variants * 1.0 / vc_agg.total_variants
      END ${dir === 'ASC' ? 'ASC NULLS LAST' : 'DESC'}, ${baseAlias}.card_no COLLATE NOCASE ASC`
    case 'recent':
      return `ORDER BY oc_agg.oc_last_edited ${dir === 'ASC' ? 'ASC' : 'DESC'} NULLS LAST,
        ${baseAlias}.card_no COLLATE NOCASE ASC`
    default:
      return `ORDER BY ${baseAlias}.card_no COLLATE NOCASE ASC`
  }
}

// ==================== 收藏页变体搜索（card_prints 数据源） ====================

/**
 * 收藏页变体搜索：以 card_prints 为数据源，一个变体（card_id + card_no_extend）一行。
 * 内层单次扫描聚合出每变体的代表稀有度与过滤标志，外层无任何关联子查询，
 * 总数用 COUNT(*) OVER () 并入数据查询，减少往返与整表重建。
 * cards_base 仅内部用于桶分类（符文/指示物）与系列回退，不参与展示；
 * 卡片详情在打开弹窗时按需关联。
 */
export async function searchCardVariants(
  params: CardVariantSearchParams
): Promise<CardVariantSearchResult> {
  const db = await getDatabase()
  const { page = 1, pageSize = 30 } = params

  const seriesList = await getAllSeries()
  const knownCodes = seriesList.map((s) => s.code.toUpperCase())
  const code = params.seriesCode?.trim().toUpperCase() ?? ''
  const searchText = params.searchText?.trim() ?? ''
  const hasSearch = searchText !== ''
  const safeText = `%${searchText}%`
  const bucket = params.bucket?.trim() ?? ''

  // 内层单次扫描计算的聚合列（MAX(CASE...) 为 0/1 标志，避免 EXISTS 子查询）
  const innerSelects = [
    `MAX(extend_rarity_name) AS extend_rarity`,
    `MAX(rarity_name) AS rarity`,
  ]
  const innerParams: unknown[] = []

  if (code) {
    innerSelects.push(
      `MAX(CASE WHEN substr(upper(card_no_extend), 1, 3) = ? THEN 1 ELSE 0 END) AS prefix_match`
    )
    innerParams.push(code)
    const knownIn =
      knownCodes.length > 0 ? knownCodes.map(() => '?').join(',') : 'NULL'
    innerSelects.push(
      `MAX(CASE WHEN substr(upper(card_no_extend), 1, 3) IN (${knownIn}) THEN 1 ELSE 0 END) AS has_known`
    )
    innerParams.push(...knownCodes)
  }
  if (hasSearch) {
    innerSelects.push(
      `MAX(CASE WHEN (card_no_extend LIKE ? OR extend_rarity_name LIKE ?
             OR rarity_name LIKE ? OR artist LIKE ?) THEN 1 ELSE 0 END) AS text_match`
    )
    innerParams.push(safeText, safeText, safeText, safeText)
  }

  const outerWheres: string[] = []
  const outerParams: unknown[] = []
  if (code) {
    // 前缀匹配；回退：没有任何已知前缀时按 cards_base.series_name 匹配（防御 R--/T-- 类编号）
    outerWheres.push(`(v.prefix_match = 1 OR (v.has_known = 0 AND cb.series_name = ?))`)
    outerParams.push(code)
  }
  if (hasSearch) {
    outerWheres.push(`v.text_match = 1`)
  }

  const havings: string[] = []
  const ownedSumExpr = `SUM(cl.normal_qty) > 0 OR SUM(cl.foil_qty) > 0`
  if (params.ownership && params.ownership !== 'all') {
    if (params.ownership === 'owned') {
      havings.push(`(${ownedSumExpr})`)
    } else if (params.ownership === 'missing') {
      havings.push(`NOT (${ownedSumExpr})`)
    } else {
      havings.push(`SUM(cl.foil_qty) > 0`)
    }
  }
  if (bucket) {
    havings.push(`bucket = ?`)
    outerParams.push(bucket)
  }

  const whereStr = outerWheres.length > 0 ? `WHERE ${outerWheres.join(' AND ')}` : ''
  const havingStr = havings.length > 0 ? `HAVING ${havings.join(' AND ')}` : ''
  const offset = (page - 1) * pageSize

  const dataSql = `
    SELECT v.card_id,
      v.card_no_extend,
      v.extend_rarity,
      v.rarity,
      cb.card_no AS card_no,
      COALESCE(SUM(cl.normal_qty), 0) AS owned_normal,
      COALESCE(SUM(cl.foil_qty), 0) AS owned_foil,
      COALESCE(SUM(cl.normal_qty), 0) + COALESCE(SUM(cl.foil_qty), 0) AS owned_total,
      MAX(col.last_edited_at) AS last_edited,
      COUNT(*) OVER () AS total,
      CASE
        WHEN cb.card_category LIKE '%符文%' THEN 'rune'
        WHEN cb.card_category LIKE '%指示物%' THEN 'token'
        WHEN v.extend_rarity = '异画' THEN 'alt'
        WHEN v.extend_rarity IN ('超编', '签名超编') THEN 'overnum'
        ELSE 'base'
      END AS bucket,
      cb.card_category AS raw_category
    FROM (
      SELECT card_id, card_no_extend,
        ${innerSelects.join(',\n        ')}
      FROM ${TABLES.CARD_PRINTS}
      WHERE COALESCE(is_promo, 0) != 1
      GROUP BY card_id, card_no_extend
    ) v
    LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.id = v.card_id
    LEFT JOIN ${TABLES.COLLECTION} col ON col.card_no = cb.card_no AND col.card_no_extend = v.card_no_extend
    LEFT JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id AND cl.status = 'owned'
    ${whereStr}
    GROUP BY v.card_id, v.card_no_extend
    ${havingStr}
    ${buildVariantOrderBy(params.collectionSort)}
    LIMIT ? OFFSET ?
  `
  const rows = await db.select<any[]>(dataSql, [...innerParams, ...outerParams, pageSize, offset])
  const total = rows.length > 0 ? Number(rows[0].total) : 0

  // 代表印刷：排除 promo 后按 SC > is_default > 首张（行值 IN 精确限定到本页变体）
  const repMap = new Map<string, CardPrint>()
  if (rows.length > 0) {
    const rowValueIn = rows.map(() => '(?, ?)').join(',')
    const printsRows = await db.select<any[]>(
      `SELECT id, card_id, card_no_extend, language, is_default, is_promo,
        img_cdn, tts_cdn, rarity_name, extend_rarity_name
       FROM ${TABLES.CARD_PRINTS}
       WHERE (card_id, card_no_extend) IN (${rowValueIn})`,
      rows.flatMap((r) => [r.card_id, r.card_no_extend])
    )
    const byVariant = new Map<string, CardPrint[]>()
    for (const p of printsRows.map(mapRowToPrint)) {
      const key = `${p.card_id}:${p.card_no_extend}`
      if (!byVariant.has(key)) byVariant.set(key, [])
      byVariant.get(key)!.push(p)
    }
    for (const [key, list] of byVariant) {
      const nonPromo = list.filter((p) => !p.is_promo)
      const pool = nonPromo.length > 0 ? nonPromo : list
      repMap.set(
        key,
        pool.find((p) => (p.language ?? '').toLowerCase() === 'sc') ??
          pool.find((p) => p.is_default) ??
          pool[0]
      )
    }
  }

  const data: VariantWithOwned[] = rows.map((row) => {
    const rep = repMap.get(`${row.card_id}:${row.card_no_extend}`)
    return {
      cardId: row.card_id,
      cardNo: row.card_no,
      cardNoExtend: row.card_no_extend,
      printId: rep?.id ?? null,
      printLanguage: rep?.language ?? null,
      imgCdn: rep?.img_cdn ?? null,
      ttsCdn: rep?.tts_cdn ?? null,
      rarityName: rep?.rarity_name ?? null,
      extendRarityName: rep?.extend_rarity_name ?? null,
      bucket: row.bucket as VariantBucket,
      cardCategory: row.raw_category ? JSON.parse(row.raw_category) : null,
      ownedNormal: row.owned_normal ?? 0,
      ownedFoil: row.owned_foil ?? 0,
      ownedTotal: row.owned_total ?? 0,
      lastEdited: row.last_edited ?? null,
    }
  })

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

/**
 * 收藏页变体排序：
 * - card_no：按扩展卡号
 * - rarity：按稀有度层级（普通 < 不凡 < 稀有 < 史诗 < 异画 < 超编 < 签名超编，符文/指示物置顶）
 * - owned：按该变体已拥有数量
 * - progress：按该变体是否已拥有（升序 = 未拥有优先）
 * - recent：按最近录入时间（无记录排最后）
 */
function buildVariantOrderBy(sort?: CollectionSort): string {
  if (!sort) return `ORDER BY v.card_no_extend COLLATE NOCASE ASC`
  const dir = sort.isAsc ? 'ASC' : 'DESC'
  const ownedExpr = `COALESCE(SUM(cl.normal_qty), 0) + COALESCE(SUM(cl.foil_qty), 0)`

  switch (sort.key) {
    case 'card_no':
      return `ORDER BY v.card_no_extend COLLATE NOCASE ${dir}`
    case 'rarity':
      return `ORDER BY CASE
        WHEN cb.card_category LIKE '%指示物%' THEN 0
        WHEN cb.card_category LIKE '%符文%' THEN 1
        WHEN v.extend_rarity = '异画' THEN 6
        WHEN v.extend_rarity IN ('超编', '签名超编') THEN 7
        WHEN v.rarity = '普通' THEN 2
        WHEN v.rarity = '不凡' THEN 3
        WHEN v.rarity = '稀有' THEN 4
        WHEN v.rarity = '史诗' THEN 5
        ELSE 9
      END ${dir}, v.card_no_extend COLLATE NOCASE ASC`
    case 'owned':
      return `ORDER BY ${ownedExpr} ${dir}, v.card_no_extend COLLATE NOCASE ASC`
    case 'progress':
      return `ORDER BY CASE WHEN ${ownedExpr} > 0 THEN 1 ELSE 0 END ${dir},
        v.card_no_extend COLLATE NOCASE ASC`
    case 'recent':
      return `ORDER BY MAX(col.last_edited_at) ${dir === 'ASC' ? 'ASC' : 'DESC'} NULLS LAST,
        v.card_no_extend COLLATE NOCASE ASC`
    default:
      return `ORDER BY v.card_no_extend COLLATE NOCASE ASC`
  }
}
