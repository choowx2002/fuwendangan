/**
 * 收藏数据仓储层
 * 收藏按「变体（card_no + card_no_extend）× 语言」记录普卡/闪卡数量；
 * 变体引用 cards_base.card_no（稳定编号，不依赖 id），语言使用标准语言码
 * （预设 EN/SC/TC/JP/KR + 自定义语言），状态按语言行记录
 * （owned/wishlist/ordered，当前 UI 仅使用 owned）。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type {
  CollectionItem,
  CollectionLang,
  CollectionStats,
  CollectionStatus,
  CompletionModeId,
  CustomPrintInput,
  MissingListRow,
  OwnershipCheckRow,
  RecentCollectionCard,
  SeriesStats,
} from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { getAllSeries } from './series-repository'
import { getCardById } from './card-repository'
import { normalizePresetCode } from '../config/languages'
import { isLanguageCodeValid } from './language-repository'
import {
  resolveStatus,
  shouldKeepLangRow,
  shouldDeleteVariant,
} from '../config/collection-rules'
import { getCompletionMode } from '../service/completion-modes'

const now = () => new Date().toISOString()

export interface UpsertLangQtyOptions {
  status?: CollectionStatus
}

/** 校验语言码：预设 5 码或已注册的自定义语言，非法则抛错 */
async function assertValidLanguageCode(language: string): Promise<string> {
  const code = normalizePresetCode(language)
  if (!code || !(await isLanguageCodeValid(code))) {
    throw new Error(`不支持的语言：${language}`)
  }
  return code
}

/** 校验变体（cards_base.card_no + card_prints.card_no_extend）确实存在 */
async function assertVariantExists(cardNo: string, cardNoExtend: string): Promise<void> {
  const db = await getDatabase()
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n
     FROM ${TABLES.CARD_PRINTS} p
     JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE cb.card_no = ? AND p.card_no_extend = ?`,
    [cardNo, cardNoExtend]
  )
  if (!(rows[0]?.n > 0)) {
    throw new Error(`该卡图变体不存在（${cardNoExtend}）`)
  }
}

// ==================== 数量编辑 ====================

/**
 * 设置某变体某语言的普卡/闪卡数量（传入 undefined 表示不修改该维度）。
 * - 写入前校验变体确实存在于 card_prints（经 cards_base.card_no 关联），语言码必须是预设或已注册的自定义语言；
 * - 任一数量 > 0 时状态自动提升为 owned；
 * - owned 双零时删除语言行，变体无任何语言行时删除变体行（wishlist/ordered 保留）。
 */
export async function upsertLangQty(
  cardNo: string,
  cardNoExtend: string,
  language: string,
  qty: { normal?: number; foil?: number },
  opts?: UpsertLangQtyOptions
): Promise<void> {
  const db = await getDatabase()

  await assertVariantExists(cardNo, cardNoExtend)
  const code = await assertValidLanguageCode(language)

  const colRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
    [cardNo, cardNoExtend]
  )
  const hadCollection = !!colRows[0]?.id
  let collectionId = colRows[0]?.id

  const langRows = collectionId
    ? await db.select<
        { id: string; status: string; normal_qty: number; foil_qty: number }[]
      >(
        `SELECT id, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS}
         WHERE collection_id = ? AND language_code = ?`,
        [collectionId, code]
      )
    : []

  const existing = langRows[0]
  const normal = qty.normal ?? existing?.normal_qty ?? 0
  const foil = qty.foil ?? existing?.foil_qty ?? 0
  const status = resolveStatus(
    opts?.status ?? (existing?.status as CollectionStatus) ?? 'owned',
    normal,
    foil
  )

  if (!collectionId) {
    collectionId = Snowflake.generate()
    const seriesCode = deriveSeriesCode(cardNoExtend)
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION}
       (id, card_no, card_no_extend, series_code, last_edited_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [collectionId, cardNo, cardNoExtend, seriesCode, now(), now(), now()]
    )
  }

  if (!shouldKeepLangRow(status, normal, foil)) {
    if (existing) {
      await db.execute(`DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE id = ?`, [existing.id])
      const remain = await db.select<
        { id: string; status: CollectionStatus; normal_qty: number; foil_qty: number }[]
      >(`SELECT id, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id = ?`, [
        collectionId,
      ])
      if (shouldDeleteVariant(remain)) {
        await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE id = ?`, [collectionId])
      }
    } else if (!hadCollection) {
      await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE id = ?`, [collectionId])
    }
    return
  }

  if (existing) {
    await db.execute(
      `UPDATE ${TABLES.COLLECTION_LANGS}
       SET normal_qty = ?, foil_qty = ?, status = ?, updated_at = ? WHERE id = ?`,
      [normal, foil, status, now(), existing.id]
    )
  } else {
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION_LANGS}
       (id, collection_id, language_code, status, normal_qty, foil_qty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [Snowflake.generate(), collectionId, code, status, normal, foil, now(), now()]
    )
  }
  await db.execute(
    `UPDATE ${TABLES.COLLECTION}
     SET updated_at = ?, last_edited_at = ?,
       series_code = COALESCE(series_code, ?)
     WHERE id = ?`,
    [now(), now(), deriveSeriesCode(cardNoExtend), collectionId]
  )
}

/** 由卡图印刷编号推导系列码（card_no_extend 前 3 位大写） */
function deriveSeriesCode(cardNoExtend: string): string {
  return cardNoExtend.toUpperCase().slice(0, 3)
}

/**
 * 设置某变体某语言的状态（wishlist/ordered 等；行不存在时创建空行）。
 * 当前 UI 不使用，供后续状态功能调用。
 */
export async function setLangStatus(
  cardNo: string,
  cardNoExtend: string,
  language: string,
  status: CollectionStatus
): Promise<void> {
  const db = await getDatabase()

  await assertVariantExists(cardNo, cardNoExtend)
  const code = await assertValidLanguageCode(language)

  const langRows = await db.select<{ id: string; collection_id: string }[]>(
    `SELECT cl.id, cl.collection_id FROM ${TABLES.COLLECTION_LANGS} cl
     JOIN ${TABLES.COLLECTION} col ON col.id = cl.collection_id
     WHERE col.card_no = ? AND col.card_no_extend = ? AND cl.language_code = ?`,
    [cardNo, cardNoExtend, code]
  )
  const existing = langRows[0]
  if (existing) {
    await db.execute(
      `UPDATE ${TABLES.COLLECTION_LANGS} SET status = ?, updated_at = ? WHERE id = ?`,
      [status, now(), existing.id]
    )
    return
  }

  const colRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
    [cardNo, cardNoExtend]
  )
  let collectionId = colRows[0]?.id
  if (!collectionId) {
    collectionId = Snowflake.generate()
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION}
       (id, card_no, card_no_extend, series_code, last_edited_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [collectionId, cardNo, cardNoExtend, deriveSeriesCode(cardNoExtend), now(), now(), now()]
    )
  }
  await db.execute(
    `INSERT INTO ${TABLES.COLLECTION_LANGS}
     (id, collection_id, language_code, status, normal_qty, foil_qty, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
    [Snowflake.generate(), collectionId, code, status, now(), now()]
  )
}

/** 获取某变体的语言数量明细 */
export async function getVariantLangs(
  cardNo: string,
  cardNoExtend: string
): Promise<CollectionLang[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT cl.id, cl.collection_id, cl.language_code, cl.status, cl.normal_qty, cl.foil_qty, cl.updated_at
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE col.card_no = ? AND col.card_no_extend = ?`,
    [cardNo, cardNoExtend]
  )
  return rows.map(mapLangRow)
}

/** 获取某卡全部变体的语言明细（详情弹窗用），key 为 card_no_extend */
export async function getCardCollection(cardNo: string): Promise<Map<string, CollectionLang[]>> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT col.card_no_extend, cl.id, cl.collection_id, cl.language_code, cl.status, cl.normal_qty, cl.foil_qty, cl.updated_at
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE col.card_no = ?
     ORDER BY col.card_no_extend ASC`,
    [cardNo]
  )
  const map = new Map<string, CollectionLang[]>()
  for (const r of rows) {
    if (!map.has(r.card_no_extend)) map.set(r.card_no_extend, [])
    map.get(r.card_no_extend)!.push(mapLangRow(r))
  }
  return map
}

function mapLangRow(r: any): CollectionLang {
  return {
    id: r.id,
    collection_id: r.collection_id,
    language_code: r.language_code,
    status: r.status as CollectionStatus,
    normal_qty: r.normal_qty,
    foil_qty: r.foil_qty,
    updated_at: r.updated_at,
  }
}

// ==================== 统计 ====================

/**
 * 收藏统计：按系列×五桶（base/alt/overnum/rune/token）聚合已拥有变体数，
 * 与 series 表预设计数合并；promo 变体全桶排除、单列统计。
 * 完成口径由 completion mode 决定（默认 base = 拥有任一普卡/闪卡数量）。
 */
export async function getCollectionStats(mode?: CompletionModeId): Promise<CollectionStats> {
  const db = await getDatabase()
  const cm = getCompletionMode(mode)
  const ownedCond = cm.ownedPredicate ?? '1=1'

  const seriesList = await getAllSeries()
  const seriesCodes = seriesList.map((s) => s.code.toUpperCase())
  const knownIn = seriesCodes.length > 0 ? seriesCodes.map(() => '?').join(',') : 'NULL'
  // 系列归属以冗余列 series_code 优先（旧数据回退 card_no_extend 前 3 位）；前缀非已知系列码时回退 cards_base.series_name
  const seriesExpr = `CASE
    WHEN col.series_code IS NOT NULL AND col.series_code != '' THEN col.series_code
    WHEN substr(upper(p.card_no_extend), 1, 3) IN (${knownIn})
      THEN substr(upper(p.card_no_extend), 1, 3)
    ELSE cb.series_name
  END`

  const ownedRows = await db.select<any[]>(
    `SELECT series, bucket, COUNT(*) AS owned FROM (
       SELECT ${seriesExpr} AS series,
         CASE
           WHEN cb.card_category LIKE '%符文%' THEN 'rune'
           WHEN cb.card_category LIKE '%指示物%' THEN 'token'
           WHEN MAX(p.extend_rarity_name) = '异画' THEN 'alt'
           WHEN MAX(p.extend_rarity_name) IN ('超编', '签名超编') THEN 'overnum'
           ELSE 'base'
         END AS bucket
       FROM ${TABLES.COLLECTION} col
       JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
       JOIN ${TABLES.CARD_PRINTS} p
         ON p.card_id = cb.id AND p.card_no_extend = col.card_no_extend
       JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
       WHERE COALESCE(p.is_promo, 0) != 1 AND ${ownedCond}
       GROUP BY col.card_no, col.card_no_extend
     )
     GROUP BY series, bucket
     ${cm.bucketPredicate ? `HAVING ${cm.bucketPredicate}` : ''}`,
    seriesCodes
  )

  const promoRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(DISTINCT col.card_no || '|' || col.card_no_extend) AS n
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
     JOIN ${TABLES.CARD_PRINTS} p
       ON p.card_id = cb.id AND p.card_no_extend = col.card_no_extend
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE COALESCE(p.is_promo, 0) = 1 AND ${ownedCond}`
  )

  const foilRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(DISTINCT col.card_no || '|' || col.card_no_extend) AS n
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE cl.status = 'owned' AND cl.foil_qty > 0`
  )

  const ownedMap = new Map<string, Partial<Record<string, number>>>()
  for (const r of ownedRows) {
    if (!ownedMap.has(r.series)) ownedMap.set(r.series, {})
    ownedMap.get(r.series)![r.bucket] = r.owned
  }

  const listed = new Set(seriesList.filter((s) => s.is_active).map((s) => s.code))

  const series: SeriesStats[] = seriesList
    .filter((s) => s.is_active)
    .map((s) => {
      const owned = ownedMap.get(s.code) || {}
      const counts = {
        base: s.base_count,
        alt: s.alt_count,
        overnum: s.overnum_count,
        rune: s.rune_count,
        token: s.token_count,
      }
      const o = {
        base: owned.base ?? 0,
        alt: owned.alt ?? 0,
        overnum: owned.overnum ?? 0,
        rune: owned.rune ?? 0,
        token: owned.token ?? 0,
      }
      const totalOwned = o.base + o.alt + o.overnum + o.rune + o.token
      const totalCount = counts.base + counts.alt + counts.overnum + counts.rune + counts.token
      return {
        code: s.code,
        nameCn: s.name_cn,
        coverImage: s.cover_image ?? null,
        owned: o,
        counts,
        totalOwned,
        totalCount,
      }
    })

  // 动态出现的其他系列（不在 series 表中，如用户自定义系列）
  for (const [code, o] of ownedMap) {
    if (listed.has(code)) continue
    const owned = {
      base: o.base ?? 0,
      alt: o.alt ?? 0,
      overnum: o.overnum ?? 0,
      rune: o.rune ?? 0,
      token: o.token ?? 0,
    }
    const totalOwned = owned.base + owned.alt + owned.overnum + owned.rune + owned.token
    series.push({
      code,
      nameCn: code,
      owned,
      counts: { base: 0, alt: 0, overnum: 0, rune: 0, token: 0 },
      totalOwned,
      totalCount: 0,
    })
  }

  const overallOwned = series.reduce((a, s) => a + s.totalOwned, 0)
  const overallCount = series.reduce((a, s) => a + s.totalCount, 0)

  return {
    series,
    promoOwned: promoRows[0]?.n ?? 0,
    foilOwned: foilRows[0]?.n ?? 0,
    overallOwned,
    overallCount,
  }
}

// ==================== 自定义 Promo 打印 ====================

/**
 * 创建自定义打印（is_promo=1, is_custom=1），继承基础卡稀有度，
 * 可选初始数量（默认普卡 1 / 闪卡 0 由调用方传入）。
 * 语言需为预设或已注册的自定义语言码。
 */
export async function createCustomPrint(input: CustomPrintInput): Promise<string> {
  const db = await getDatabase()
  const printId = Snowflake.generate()
  const t = now()

  const code = await assertValidLanguageCode(input.language)

  const card = await getCardById(input.cardId)
  if (!card?.card_no) {
    throw new Error(`基础卡不存在（${input.cardId}）`)
  }

  await db.execute(
    `INSERT INTO ${TABLES.CARD_PRINTS}
     (id, card_id, card_no_extend, rarity_name, extend_rarity_name, back_image,
      language, img_cdn, tts_cdn, artist, print_order, is_default, is_promo, is_custom,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      printId,
      input.cardId,
      input.cardNoExtend,
      card.rarity_name ?? null,
      input.extendRarityName,
      null,
      code,
      null,
      null,
      input.artist ?? null,
      null,
      0,
      1,
      1,
      t,
      t,
    ]
  )

  if (input.normalQty > 0 || input.foilQty > 0) {
    await upsertLangQty(card.card_no, input.cardNoExtend, code, {
      normal: input.normalQty,
      foil: input.foilQty,
    })
  }

  return printId
}

/** 设置自定义打印的本地图片 token（img_cdn = local://{token}，null 表示清除） */
export async function updateCustomPrintImg(printId: string, imgToken: string | null): Promise<void> {
  const db = await getDatabase()
  await db.execute(`UPDATE ${TABLES.CARD_PRINTS} SET img_cdn = ?, updated_at = ? WHERE id = ?`, [
    imgToken ? `local://${imgToken}` : null,
    now(),
    printId,
  ])
}

/** 更新自定义打印信息 */
export async function updateCustomPrint(
  printId: string,
  patch: {
    card_no_extend?: string
    extend_rarity_name?: string
    language?: string
    artist?: string | null
  }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    params.push(value)
  }
  params.push(printId)
  await db.execute(
    `UPDATE ${TABLES.CARD_PRINTS} SET ${sets.join(', ')} WHERE id = ?`,
    params
  )
}

/** 删除自定义打印（返回其图片 token 供调用方清理本地文件） */
export async function deleteCustomPrint(printId: string): Promise<string | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT cb.card_no AS card_no, p.card_no_extend AS card_no_extend, p.img_cdn AS img_cdn
     FROM ${TABLES.CARD_PRINTS} p
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE p.id = ?`,
    [printId]
  )
  const p = rows[0]
  if (!p) return null

  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE id = ?`, [printId])

  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id IN (
       SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?
     )`,
    [p.card_no, p.card_no_extend]
  )
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
    [p.card_no, p.card_no_extend]
  )

  const imgCdn: string | null = p.img_cdn
  if (imgCdn?.startsWith('local://')) {
    return imgCdn.slice('local://'.length)
  }
  return null
}

// ==================== 卡组持有检查 ====================

/**
 * 卡组持有检查：按卡牌聚合所有变体×语言的 owned 数量（含 promo/自定义打印）与卡组需求比较
 */
export async function checkDeckOwnership(
  items: { cardPrintId: string; quantity: number }[]
): Promise<OwnershipCheckRow[]> {
  if (items.length === 0) return []
  const db = await getDatabase()

  const printRows = await db.select<any[]>(
    `SELECT p.id AS print_id, p.card_id, cb.card_name_cn AS card_name, cb.card_no AS card_no
     FROM ${TABLES.CARD_PRINTS} p
     JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE p.id IN (${items.map(() => '?').join(',')})`,
    items.map((i) => i.cardPrintId)
  )
  const printToCard = new Map(printRows.map((r) => [r.print_id, r]))

  const needByCard = new Map<string, number>()
  for (const item of items) {
    const row = printToCard.get(item.cardPrintId)
    if (!row) continue
    needByCard.set(row.card_no, (needByCard.get(row.card_no) ?? 0) + item.quantity)
  }

  const cardNos = [...needByCard.keys()]
  const ownedByCard = new Map<string, number>()
  if (cardNos.length > 0) {
    const ownedRows = await db.select<any[]>(
      `SELECT col.card_no, SUM(cl.normal_qty + cl.foil_qty) AS owned
       FROM ${TABLES.COLLECTION} col
       JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
       WHERE col.card_no IN (${cardNos.map(() => '?').join(',')}) AND cl.status = 'owned'
       GROUP BY col.card_no`,
      cardNos
    )
    for (const r of ownedRows) ownedByCard.set(r.card_no, r.owned ?? 0)
  }

  const result: OwnershipCheckRow[] = []
  for (const [cardNo, needed] of needByCard) {
    const sample = printToCard.get(
      [...printToCard.keys()].find((k) => printToCard.get(k)!.card_no === cardNo)!
    )!
    result.push({
      cardId: sample.card_id,
      cardName: sample.card_name ?? '',
      cardNo,
      needed,
      owned: ownedByCard.get(cardNo) ?? 0,
    })
  }
  result.sort((a, b) => b.needed - a.needed || a.cardNo.localeCompare(b.cardNo))
  return result
}

// ==================== 维护 ====================

/** 清理孤儿收藏行（card_no 不在 cards_base，或 (card_no, card_no_extend) 组合不存在于 card_prints） */
export async function cleanupOrphans(): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION} WHERE card_no NOT IN (SELECT card_no FROM ${TABLES.CARDS_BASE})`
  )
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION} WHERE NOT EXISTS (
       SELECT 1 FROM ${TABLES.CARDS_BASE} cb
       JOIN ${TABLES.CARD_PRINTS} p ON p.card_id = cb.id
       WHERE cb.card_no = ${TABLES.COLLECTION}.card_no AND p.card_no_extend = ${TABLES.COLLECTION}.card_no_extend
     )`
  )
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id NOT IN (SELECT id FROM ${TABLES.COLLECTION})`
  )
}

// ==================== 批量操作 / 最近录入 / 缺卡清单 ====================

/** 批量校验 items 对应的变体确实存在于 card_prints（经 cards_base.card_no 关联），过滤无效项 */
async function filterValidItems(items: CollectionItem[]): Promise<CollectionItem[]> {
  const db = await getDatabase()
  const valid: CollectionItem[] = []
  const unique = new Map<string, CollectionItem>()
  for (const item of items) {
    const key = `${item.cardNo}|${item.cardNoExtend}`
    if (!unique.has(key)) unique.set(key, item)
  }
  const list = [...unique.values()]
  if (list.length === 0) return []
  const cardNos = [...new Set(list.map((i) => i.cardNo))]
  const rows = await db.select<{ card_no: string; card_no_extend: string }[]>(
    `SELECT DISTINCT cb.card_no AS card_no, p.card_no_extend AS card_no_extend
     FROM ${TABLES.CARDS_BASE} cb
     JOIN ${TABLES.CARD_PRINTS} p ON p.card_id = cb.id
     WHERE cb.card_no IN (${cardNos.map(() => '?').join(',')})`,
    cardNos
  )
  const exists = new Set(rows.map((r) => `${r.card_no}|${r.card_no_extend}`))
  for (const item of list) {
    if (exists.has(`${item.cardNo}|${item.cardNoExtend}`)) valid.push(item)
  }
  return valid
}

/** 预取 items 现有语言行（供批量判定使用） */
async function loadExistingLangs(
  items: CollectionItem[]
): Promise<Map<string, { language_code: string; status: string; normal_qty: number; foil_qty: number }[]>> {
  const db = await getDatabase()
  if (items.length === 0) return new Map()
  const conds = items.map(() => '(col.card_no = ? AND col.card_no_extend = ?)').join(' OR ')
  const params: any[] = []
  for (const i of items) params.push(i.cardNo, i.cardNoExtend)
  const rows = await db.select<any[]>(
    `SELECT col.card_no, col.card_no_extend, cl.language_code, cl.status, cl.normal_qty, cl.foil_qty
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE ${conds}`,
    params
  )
  const map = new Map<
    string,
    { language_code: string; status: string; normal_qty: number; foil_qty: number }[]
  >()
  for (const r of rows) {
    const key = `${r.card_no}|${r.card_no_extend}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return map
}

/**
 * 批量标记已拥有：对每个变体，若尚无任一 owned 数量行，则为默认语言 EN 写入普卡 1。
 * 返回实际更新的变体数。
 */
export async function bulkMarkOwned(items: CollectionItem[]): Promise<number> {
  const valid = await filterValidItems(items)
  const existing = await loadExistingLangs(valid)
  let updated = 0
  for (const item of valid) {
    const rows = existing.get(`${item.cardNo}|${item.cardNoExtend}`) ?? []
    if (rows.some((r) => r.status === 'owned' && (r.normal_qty > 0 || r.foil_qty > 0))) continue
    const enRow = rows.find((r) => r.language_code === 'EN')
    await upsertLangQty(item.cardNo, item.cardNoExtend, 'EN', {
      normal: Math.max(enRow?.normal_qty ?? 0, 1),
    })
    updated += 1
  }
  return updated
}

/**
 * 批量普卡 +1：对每个变体，在最近更新的 owned 语言行上加 1；无 owned 行时为 EN 建行加 1。
 * 返回实际更新的变体数。
 */
export async function bulkIncrement(items: CollectionItem[]): Promise<number> {
  const valid = await filterValidItems(items)
  const existing = await loadExistingLangs(valid)
  let updated = 0
  for (const item of valid) {
    const rows = existing.get(`${item.cardNo}|${item.cardNoExtend}`) ?? []
    const ownedRows = rows.filter((r) => r.status === 'owned' && (r.normal_qty > 0 || r.foil_qty > 0))
    if (ownedRows.length > 0) {
      const pick = ownedRows[0]
      await upsertLangQty(item.cardNo, item.cardNoExtend, pick.language_code, {
        normal: pick.normal_qty + 1,
      })
    } else {
      const enRow = rows.find((r) => r.language_code === 'SC')
      await upsertLangQty(item.cardNo, item.cardNoExtend, 'SC', {
        normal: (enRow?.normal_qty ?? 0) + 1,
      })
    }
    updated += 1
  }
  return updated
}

/** 批量删除收藏记录（变体行级联删除语言行），返回删除数 */
export async function bulkDeleteCollection(items: CollectionItem[]): Promise<number> {
  const db = await getDatabase()
  const valid = await filterValidItems(items)
  if (valid.length === 0) return 0
  const conds = valid.map(() => '(card_no = ? AND card_no_extend = ?)').join(' OR ')
  const params: any[] = []
  for (const i of valid) params.push(i.cardNo, i.cardNoExtend)
  await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE ${conds}`, params)
  return valid.length
}

/**
 * 最近录入的收藏卡片（总览 Hero 展示）
 */
export async function getRecentCollectionCards(limit = 6): Promise<RecentCollectionCard[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT col.card_no, col.card_no_extend, col.series_code, col.last_edited_at,
       cb.card_name_cn, cb.card_no,
       COALESCE((SELECT SUM(cl2.normal_qty) FROM ${TABLES.COLLECTION_LANGS} cl2 WHERE cl2.collection_id = col.id), 0) AS owned_normal,
       COALESCE((SELECT SUM(cl2.foil_qty) FROM ${TABLES.COLLECTION_LANGS} cl2 WHERE cl2.collection_id = col.id), 0) AS owned_foil,
       p.img_cdn, p.tts_cdn, p.id AS print_id, p.language AS print_lang
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
     LEFT JOIN ${TABLES.CARD_PRINTS} p ON p.card_id = cb.id AND p.is_default = 1
     WHERE col.last_edited_at IS NOT NULL
     ORDER BY col.last_edited_at DESC
     LIMIT ?`,
    [limit]
  )
  return rows.map((r) => ({
    cardId: r.card_no,
    cardNoExtend: r.card_no_extend,
    seriesCode: r.series_code ?? null,
    lastEditedAt: r.last_edited_at ?? null,
    cardNameCn: r.card_name_cn ?? null,
    cardNo: r.card_no ?? null,
    ownedNormal: r.owned_normal ?? 0,
    ownedFoil: r.owned_foil ?? 0,
    imgCdn: r.img_cdn ?? null,
    ttsCdn: r.tts_cdn ?? null,
    printId: r.print_id,
    printLang: r.print_lang ?? null
  }))
}

/**
 * 缺卡清单筛选（全部可选，不传则不过滤）
 * - seriesCode：按卡图印刷系列码（card_no_extend 前 3 位大写）过滤
 * - bucket：仅统计该桶（base/alt/overnum/rune/token）
 * - rarities：变体扩展稀有度（card_prints.extend_rarity_name：平卡/异画/超编/签名超编）
 * - categories：卡牌类型（cards_base.card_category，JSON 数组任一匹配）
 * - colors：卡牌颜色（cards_base.card_color_list，JSON 数组任一匹配）
 * - language：拥有数只统计指定语言（collection_langs.language_code）的行，不传则跨语言合计
 */
export interface MissingListFilter {
  seriesCode?: string
  bucket?: string
  rarities?: string[]
  categories?: string[]
  colors?: string[]
  language?: string
}

/** 缺卡清单稀有度选项（card_prints.extend_rarity_name 去重，固定顺序） */
export async function getMissingListRarityOptions(): Promise<string[]> {
  const db = await getDatabase()
  const rows = await db.select<{ rarity: string }[]>(
    `SELECT DISTINCT extend_rarity_name AS rarity FROM ${TABLES.CARD_PRINTS}
     WHERE extend_rarity_name IS NOT NULL AND extend_rarity_name != ''`
  )
  const order = ['平卡', '异画', '超编', '签名超编']
  const values = rows.map((r) => r.rarity)
  return order.filter((o) => values.includes(o)).concat(values.filter((v) => !order.includes(v)))
}

/**
 * 缺卡清单（按印刷变体逐行）：返回符合筛选条件的每个非 promo 变体一行，
 * 含拥有张数（所选语言行的普卡+闪卡合计，仅统计 owned 状态；不传语言则跨语言合计）。
 * 拥有数在 collection（UNIQUE(card_no, card_no_extend)，变体 1:1）外层聚合，
 * 避免 card_prints 多语言印刷行与 collection_langs 交叉造成笛卡尔积翻倍。
 */
export async function getMissingVariants(opts?: MissingListFilter): Promise<MissingListRow[]> {
  const db = await getDatabase()
  const innerConds: string[] = ['COALESCE(p3.is_promo, 0) != 1']
  const params: any[] = []

  if (opts?.seriesCode) {
    innerConds.push(`substr(upper(p3.card_no_extend), 1, 3) = ?`)
    params.push(opts.seriesCode.toUpperCase())
  }
  if (opts?.rarities?.length) {
    const ph = opts.rarities.map(() => '?').join(',')
    innerConds.push(`p3.extend_rarity_name IN (${ph})`)
    params.push(...opts.rarities)
  }
  if (opts?.categories?.length) {
    const ph = opts.categories.map(() => '?').join(',')
    innerConds.push(`EXISTS (SELECT 1 FROM json_each(cb3.card_category) WHERE value IN (${ph}))`)
    params.push(...opts.categories)
  }
  if (opts?.colors?.length) {
    const ph = opts.colors.map(() => '?').join(',')
    innerConds.push(`EXISTS (SELECT 1 FROM json_each(cb3.card_color_list) WHERE value IN (${ph}))`)
    params.push(...opts.colors)
  }

  const langCond = opts?.language ? ' AND cl.language_code = ?' : ''
  if (opts?.language) params.push(opts.language)

  const sql = `SELECT cb.id AS card_id, cb.card_no, cb.card_name_cn,
       v.card_no_extend AS card_no_extend, v.rarity AS rarity,
       COALESCE(q.owned_qty, 0) AS owned_qty
     FROM (
       SELECT p3.card_id AS card_id, p3.card_no_extend,
         MAX(p3.extend_rarity_name) AS rarity,
         CASE
           WHEN MAX(cb3.card_category) LIKE '%符文%' THEN 'rune'
           WHEN MAX(cb3.card_category) LIKE '%指示物%' THEN 'token'
           WHEN MAX(p3.extend_rarity_name) = '异画' THEN 'alt'
           WHEN MAX(p3.extend_rarity_name) IN ('超编', '签名超编') THEN 'overnum'
           ELSE 'base'
         END AS bucket
       FROM ${TABLES.CARD_PRINTS} p3
       JOIN ${TABLES.CARDS_BASE} cb3 ON cb3.id = p3.card_id
       WHERE ${innerConds.join(' AND ')}
       GROUP BY p3.card_id, p3.card_no_extend
     ) v
     JOIN ${TABLES.CARDS_BASE} cb ON cb.id = v.card_id
     LEFT JOIN ${TABLES.COLLECTION} col
       ON col.card_no = cb.card_no AND col.card_no_extend = v.card_no_extend
     LEFT JOIN (
       SELECT cl.collection_id AS cid,
         SUM(CASE WHEN cl.status = 'owned'${langCond} THEN cl.normal_qty + cl.foil_qty ELSE 0 END) AS owned_qty
       FROM ${TABLES.COLLECTION_LANGS} cl
       GROUP BY cl.collection_id
     ) q ON q.cid = col.id
     ${opts?.bucket ? 'WHERE v.bucket = ?' : ''}
     ORDER BY cb.card_no COLLATE NOCASE ASC, v.card_no_extend COLLATE NOCASE ASC`
  if (opts?.bucket) params.push(opts.bucket)

  const rows = await db.select<any[]>(sql, params)
  return rows.map((r) => ({
    cardId: r.card_id,
    cardNo: r.card_no ?? null,
    cardNoExtend: r.card_no_extend,
    cardNameCn: r.card_name_cn ?? null,
    rarity: r.rarity ?? null,
    ownedQty: r.owned_qty ?? 0,
  }))
}
