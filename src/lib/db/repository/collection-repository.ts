/**
 * 收藏数据仓储层
 * 收藏按「卡牌（card_no + card_no_extend）× 语言」记录普卡/闪卡数量；
 * 卡牌引用 cards_base.card_no（稳定编号，不依赖 id），语言使用标准语言码
 * （预设 EN/SC/TC/JP/KR + 自定义语言），状态按语言行记录
 * （owned/wishlist/ordered，当前 UI 仅使用 owned）。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type {
  CardPrint,
  CollectionHistoryItemAction,
  CollectionItem,
  CollectionLang,
  CollectionStats,
  CollectionStatus,
  CompletionModeId,
  CustomPrintInput,
  MissingListRow,
  OwnershipCheckRow,
  OwnershipMatchMode,
  RecentCollectionCard,
  SeriesStats,
} from '../types'
import { getDatabase, withTransaction } from './database'
import { mapRowToPrint } from '../helper'
import { TABLES } from '../config/constants'
import { getAllSeries } from './series-repository'
import { getCardById } from './card-repository'
import { normalizePresetCode } from '../config/languages'
import { getValidLanguageCodes, isLanguageCodeValid } from './language-repository'
import { combineCardName } from '$lib/collection/collection-utils'
import { resolveStatus, shouldKeepLangRow, shouldDeleteVariant } from '../config/collection-rules'
import { getCompletionMode } from '../service/completion-modes'
import { getActiveLoanQty } from './loan-repository'
import { get } from 'svelte/store'
import { defaultLanguage } from '$lib/stores/settings'
import {
  logCollectionHistory,
  logCollectionHistoryNote,
  type HistoryItemInput,
} from './collection-history-repository'
import { captureCollectionSnapshot } from './collection-snapshot-repository'

const now = () => new Date().toISOString()

export interface UpsertLangQtyOptions {
  status?: CollectionStatus
  /** 操作来源（history 记录用）：modal / series_page / status 等 */
  source?: string
}

/** 校验语言码：预设 5 码或已注册的自定义语言，非法则抛错 */
async function assertValidLanguageCode(language: string): Promise<string> {
  const code = normalizePresetCode(language)
  if (!code || !(await isLanguageCodeValid(code))) {
    throw new Error(`不支持的语言：${language}`)
  }
  return code
}

/** 校验卡牌（cards_base.card_no + card_prints.card_no_extend）确实存在 */
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
    throw new Error(`该卡图卡牌不存在（${cardNoExtend}）`)
  }
}

// ==================== 数量编辑 ====================

interface LangQtyWriteResult {
  before: { status: string; normalQty: number; foilQty: number } | null
  after: { status: string; normalQty: number; foilQty: number } | null
  action: CollectionHistoryItemAction
}

/**
 * 核心写入：把某卡牌某语言行的数量/状态写为给定值（不校验、不记录日志、不触发快照）。
 * - 由调用方保证卡牌存在、语言合法；
 * - 任一数量 > 0 时状态自动提升为 owned（resolveStatus）；
 * - owned 双零时删除语言行，卡牌无任何语言行时删除卡牌行（wishlist/ordered 保留）。
 * 返回该语言行写入前后的状态，供上层记录历史。
 */
async function _applyLangQtyWrite(
  cardNo: string,
  cardNoExtend: string,
  code: string,
  qty: { normal?: number; foil?: number },
  statusHint?: CollectionStatus
): Promise<LangQtyWriteResult> {
  const db = await getDatabase()

  const colRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
    [cardNo, cardNoExtend]
  )
  const hadCollection = !!colRows[0]?.id
  let collectionId = colRows[0]?.id

  const langRows = collectionId
    ? await db.select<{ id: string; status: string; normal_qty: number; foil_qty: number }[]>(
        `SELECT id, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS}
         WHERE collection_id = ? AND language_code = ?`,
        [collectionId, code]
      )
    : []

  const existing = langRows[0]
  const before = existing
    ? { status: existing.status, normalQty: existing.normal_qty, foilQty: existing.foil_qty }
    : null

  const normal = qty.normal ?? existing?.normal_qty ?? 0
  const foil = qty.foil ?? existing?.foil_qty ?? 0
  const status = resolveStatus(
    statusHint ?? (existing?.status as CollectionStatus) ?? 'owned',
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
      >(
        `SELECT id, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id = ?`,
        [collectionId]
      )
      if (shouldDeleteVariant(remain)) {
        await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE id = ?`, [collectionId])
        return { before, after: null, action: 'delete_variant' }
      }
      return { before, after: null, action: 'remove' }
    }
    if (!hadCollection) {
      await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE id = ?`, [collectionId])
    }
    return { before, after: null, action: 'remove' }
  }

  const after = { status, normalQty: normal, foilQty: foil }
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
  return { before, after, action: before ? 'set' : 'add' }
}

function toHistoryItem(
  cardNo: string,
  cardNoExtend: string,
  code: string,
  result: LangQtyWriteResult
): HistoryItemInput {
  return {
    cardNo,
    cardNoExtend,
    languageCode: code,
    action: result.action,
    oldStatus: result.before?.status ?? null,
    oldNormalQty: result.before?.normalQty ?? null,
    oldFoilQty: result.before?.foilQty ?? null,
    newStatus: result.after?.status ?? null,
    newNormalQty: result.after?.normalQty ?? null,
    newFoilQty: result.after?.foilQty ?? null,
  }
}

/**
 * 设置某卡牌某语言的普卡/闪卡数量（传入 undefined 表示不修改该维度）。
 * - 写入前校验卡牌确实存在于 card_prints（经 cards_base.card_no 关联），语言码必须是预设或已注册的自定义语言；
 * - 任一数量 > 0 时状态自动提升为 owned；
 * - owned 双零时删除语言行，卡牌无任何语言行时删除卡牌行（wishlist/ordered 保留）。
 * - 记录一条 upsert 操作历史，并触发进度快照。
 */
export async function upsertLangQty(
  cardNo: string,
  cardNoExtend: string,
  language: string,
  qty: { normal?: number; foil?: number },
  opts?: UpsertLangQtyOptions
): Promise<void> {
  await assertVariantExists(cardNo, cardNoExtend)
  const code = await assertValidLanguageCode(language)

  const result = await _applyLangQtyWrite(cardNo, cardNoExtend, code, qty, opts?.status)
  await logCollectionHistory('upsert', opts?.source ?? 'modal', [
    toHistoryItem(cardNo, cardNoExtend, code, result),
  ])
  void captureCollectionSnapshot('auto')
}

/** 由卡图印刷编号推导系列码（card_no_extend 前 3 位大写） */
function deriveSeriesCode(cardNoExtend: string): string {
  return cardNoExtend.toUpperCase().slice(0, 3)
}

/**
 * 设置某卡牌某语言的状态（wishlist/ordered 等；行不存在时创建空行）。
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

  const langRows = await db.select<
    { id: string; collection_id: string; status: string; normal_qty: number; foil_qty: number }[]
  >(
    `SELECT cl.id, cl.collection_id, cl.status, cl.normal_qty, cl.foil_qty
     FROM ${TABLES.COLLECTION_LANGS} cl
     JOIN ${TABLES.COLLECTION} col ON col.id = cl.collection_id
     WHERE col.card_no = ? AND col.card_no_extend = ? AND cl.language_code = ?`,
    [cardNo, cardNoExtend, code]
  )
  const existing = langRows[0]
  const before = existing
    ? { status: existing.status, normalQty: existing.normal_qty, foilQty: existing.foil_qty }
    : null

  if (existing) {
    await db.execute(
      `UPDATE ${TABLES.COLLECTION_LANGS} SET status = ?, updated_at = ? WHERE id = ?`,
      [status, now(), existing.id]
    )
  } else {
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

  await logCollectionHistory('upsert', 'status', [
    {
      cardNo,
      cardNoExtend,
      languageCode: code,
      action: before ? 'set' : 'add',
      oldStatus: before?.status ?? null,
      oldNormalQty: before?.normalQty ?? null,
      oldFoilQty: before?.foilQty ?? null,
      newStatus: status,
      newNormalQty: before?.normalQty ?? 0,
      newFoilQty: before?.foilQty ?? 0,
    },
  ])
  void captureCollectionSnapshot('auto')
}

/** 获取某卡牌的语言数量明细 */
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

/** 获取某卡全部卡牌的语言明细（详情弹窗用），key 为 card_no_extend */
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
 * 收藏统计：按系列×五桶（base/alt/overnum/rune/token）聚合已拥有卡牌数，
 * 与 series 表预设计数合并；promo 卡牌全桶排除、单列统计。
 * 完成口径由 completion mode 决定（默认 base = 拥有任一普卡/闪卡数量）。
 */
export async function getCollectionStats(mode?: CompletionModeId): Promise<CollectionStats> {
  const db = await getDatabase()
  const cm = getCompletionMode(mode)
  const ownedCond = cm.ownedPredicate ?? '1=1'

  const seriesList = await getAllSeries()
  const seriesCodes = seriesList.map((s) => s.code.toUpperCase())
  const knownIn = seriesCodes.length > 0 ? seriesCodes.map(() => '?').join(',') : 'NULL'
  // 系列归属：自建打印（is_custom）一律按原型卡所在系列（series_name），
  // 其余以冗余列 series_code 优先（旧数据回退 card_no_extend 前 3 位）；前缀非已知系列码时回退 cards_base.series_name
  const seriesExpr = `CASE
    WHEN MAX(p.is_custom) = 1 THEN cb.series_name
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
       WHERE (COALESCE(p.is_promo, 0) != 1 OR p.is_custom = 1) AND ${ownedCond}
       GROUP BY col.card_no, col.card_no_extend
     )
     GROUP BY series, bucket
     ${cm.bucketPredicate ? `HAVING ${cm.bucketPredicate}` : ''}`,
    seriesCodes
  )

  // 自建打印总数（每系列×桶），并入收藏总数与进度分母
  const customRows = await db.select<any[]>(
    `SELECT series, bucket, COUNT(*) AS n FROM (
       SELECT cb.series_name AS series,
         CASE
           WHEN cb.card_category LIKE '%符文%' THEN 'rune'
           WHEN cb.card_category LIKE '%指示物%' THEN 'token'
           WHEN MAX(p.extend_rarity_name) = '异画' THEN 'alt'
           WHEN MAX(p.extend_rarity_name) IN ('超编', '签名超编') THEN 'overnum'
           ELSE 'base'
         END AS bucket
       FROM ${TABLES.CARD_PRINTS} p
       JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
       WHERE p.is_custom = 1
       GROUP BY cb.card_no, p.card_no_extend
     )
     GROUP BY series, bucket`
  )

  const promoRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(DISTINCT col.card_no || '|' || col.card_no_extend) AS n
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
     JOIN ${TABLES.CARD_PRINTS} p
       ON p.card_id = cb.id AND p.card_no_extend = col.card_no_extend
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE COALESCE(p.is_promo, 0) = 1 AND COALESCE(p.is_custom, 0) != 1 AND ${ownedCond}`
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

  const customCountMap = new Map<string, Partial<Record<string, number>>>()
  for (const r of customRows) {
    if (!customCountMap.has(r.series)) customCountMap.set(r.series, {})
    customCountMap.get(r.series)![r.bucket] = r.n
  }

  const listed = new Set(seriesList.filter((s) => s.is_active).map((s) => s.code))

  const series: SeriesStats[] = seriesList
    .filter((s) => s.is_active)
    .map((s) => {
      const owned = ownedMap.get(s.code) || {}
      const custom = customCountMap.get(s.code) || {}
      const counts = {
        base: s.base_count + (custom.base ?? 0),
        alt: s.alt_count + (custom.alt ?? 0),
        overnum: s.overnum_count + (custom.overnum ?? 0),
        rune: s.rune_count + (custom.rune ?? 0),
        token: s.token_count + (custom.token ?? 0),
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
     (id, card_id, card_no, card_no_extend, rarity_name, extend_rarity_name, back_image,
      language, img_cdn, tts_cdn, artist, print_order, is_default, is_promo, is_custom,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      printId,
      input.cardId,
      card.card_no,
      input.cardNoExtend,
      card.rarity_name ?? null,
      input.extendRarityName,
      null,
      code,
      input.imgToken ? `local://${input.imgToken}` : null,
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
    const result = await _applyLangQtyWrite(card.card_no, input.cardNoExtend, code, {
      normal: input.normalQty,
      foil: input.foilQty,
    })
    await logCollectionHistory('custom_print_create', 'custom_print', [
      toHistoryItem(card.card_no, input.cardNoExtend, code, result),
    ])
    void captureCollectionSnapshot('auto')
  }

  return printId
}

/** 设置自定义打印的本地图片 token（img_cdn = local://{token}，null 表示清除） */
export async function updateCustomPrintImg(
  printId: string,
  imgToken: string | null
): Promise<void> {
  const db = await getDatabase()
  await db.execute(`UPDATE ${TABLES.CARD_PRINTS} SET img_cdn = ?, updated_at = ? WHERE id = ?`, [
    imgToken ? `local://${imgToken}` : null,
    now(),
    printId,
  ])
}

/** 更新自定义打印信息；卡牌号/语言变更时自动迁移既有收藏数量到新键 */
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

  const oldRows = await db.select<any[]>(
    `SELECT p.card_no_extend AS card_no_extend, p.language AS language, cb.card_no AS card_no
     FROM ${TABLES.CARD_PRINTS} p
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE p.id = ?`,
    [printId]
  )
  const old = oldRows[0]

  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    params.push(value)
  }
  params.push(printId)
  await db.execute(`UPDATE ${TABLES.CARD_PRINTS} SET ${sets.join(', ')} WHERE id = ?`, params)

  if (old) {
    const oldExtend = (old.card_no_extend as string | null) ?? ''
    const oldLang = (old.language as string | null) ?? ''
    const newExtend = patch.card_no_extend ?? oldExtend
    const newLang = patch.language ?? oldLang
    if (
      (oldExtend && newExtend && oldExtend !== newExtend) ||
      (oldLang && newLang && oldLang !== newLang)
    ) {
      await migrateCustomPrintCollection(
        (old.card_no as string | null) ?? '',
        oldExtend,
        newExtend,
        oldLang,
        newLang
      )
      await logCollectionHistoryNote(
        'custom_print_migrate',
        'custom_print',
        '自定义打印变更，收藏数量已迁移（仅可查看）'
      )
    }
  }
}

/**
 * 自定打印编辑引起卡牌号/语言变更时，迁移收藏数量行到新键。
 * - 卡牌号变更：迁移 collection 行（重算 series_code）；新键已有 collection 则按语言合并后删除旧行。
 * - 语言变更：迁移 collection_langs 旧语言行到新语言；新语言行已存在则合并数量并按状态规则重算。
 * - 两个变更可叠加：先迁卡牌号，再迁语言。
 */
async function migrateCustomPrintCollection(
  baseCardNo: string,
  oldExtend: string,
  newExtend: string,
  oldLang: string,
  newLang: string
): Promise<void> {
  const db = await getDatabase()

  const affectedIds: string[] = []

  if (oldExtend && newExtend && oldExtend !== newExtend) {
    const oldCols = await db.select<{ id: string }[]>(
      `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
      [baseCardNo, oldExtend]
    )
    const oldColId = oldCols[0]?.id
    if (oldColId) {
      const newCols = await db.select<{ id: string }[]>(
        `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
        [baseCardNo, newExtend]
      )
      const newColId = newCols[0]?.id
      if (newColId) {
        await mergeCollectionLangs(oldColId, newColId)
        await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE id = ?`, [oldColId])
      } else {
        await db.execute(
          `UPDATE ${TABLES.COLLECTION}
           SET card_no_extend = ?, series_code = ?, updated_at = ? WHERE id = ?`,
          [newExtend, deriveSeriesCode(newExtend), now(), oldColId]
        )
        affectedIds.push(oldColId)
      }
    }
  }

  if (oldLang && newLang && oldLang !== newLang) {
    let targetIds = affectedIds
    if (targetIds.length === 0) {
      const cols = await db.select<{ id: string }[]>(
        `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
        [baseCardNo, oldExtend !== newExtend ? newExtend : oldExtend]
      )
      targetIds = cols.map((c) => c.id)
    }
    for (const colId of targetIds) {
      const oldLangs = await db.select<any[]>(
        `SELECT id, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS}
         WHERE collection_id = ? AND language_code = ?`,
        [colId, oldLang]
      )
      const oldRow = oldLangs[0]
      if (!oldRow) continue
      const newLangs = await db.select<any[]>(
        `SELECT id, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS}
         WHERE collection_id = ? AND language_code = ?`,
        [colId, newLang]
      )
      const newRow = newLangs[0]
      if (newRow) {
        const normal = (newRow.normal_qty ?? 0) + (oldRow.normal_qty ?? 0)
        const foil = (newRow.foil_qty ?? 0) + (oldRow.foil_qty ?? 0)
        await db.execute(
          `UPDATE ${TABLES.COLLECTION_LANGS}
           SET normal_qty = ?, foil_qty = ?, status = ?, updated_at = ? WHERE id = ?`,
          [normal, foil, resolveStatus(newRow.status, normal, foil), now(), newRow.id]
        )
        await db.execute(`DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE id = ?`, [oldRow.id])
      } else {
        await db.execute(
          `UPDATE ${TABLES.COLLECTION_LANGS}
           SET language_code = ?, updated_at = ? WHERE id = ?`,
          [newLang, now(), oldRow.id]
        )
      }
    }
  }
}

/** 把 src 集合的语言行合并进 dest 集合（同名语言数量相加），供卡牌号合并场景使用 */
async function mergeCollectionLangs(srcId: string, destId: string): Promise<void> {
  const db = await getDatabase()
  const srcLangs = await db.select<any[]>(
    `SELECT id, language_code, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS}
     WHERE collection_id = ?`,
    [srcId]
  )
  for (const row of srcLangs) {
    const destLangs = await db.select<any[]>(
      `SELECT id, status, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS}
       WHERE collection_id = ? AND language_code = ?`,
      [destId, row.language_code]
    )
    const dest = destLangs[0]
    if (dest) {
      const normal = (dest.normal_qty ?? 0) + (row.normal_qty ?? 0)
      const foil = (dest.foil_qty ?? 0) + (row.foil_qty ?? 0)
      await db.execute(
        `UPDATE ${TABLES.COLLECTION_LANGS}
         SET normal_qty = ?, foil_qty = ?, status = ?, updated_at = ? WHERE id = ?`,
        [normal, foil, resolveStatus(dest.status, normal, foil), now(), dest.id]
      )
      await db.execute(`DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE id = ?`, [row.id])
    } else {
      await db.execute(
        `UPDATE ${TABLES.COLLECTION_LANGS} SET collection_id = ?, updated_at = ? WHERE id = ?`,
        [destId, now(), row.id]
      )
    }
  }
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

  const langRows = await db.select<any[]>(
    `SELECT cl.language_code AS language_code, cl.status AS status,
       cl.normal_qty AS normal_qty, cl.foil_qty AS foil_qty
     FROM ${TABLES.COLLECTION_LANGS} cl
     JOIN ${TABLES.COLLECTION} col ON col.id = cl.collection_id
     WHERE col.card_no = ? AND col.card_no_extend = ?`,
    [p.card_no, p.card_no_extend]
  )

  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE id = ?`, [printId])

  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id IN (
       SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?
     )`,
    [p.card_no, p.card_no_extend]
  )
  await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`, [
    p.card_no,
    p.card_no_extend,
  ])

  if (langRows.length > 0) {
    await logCollectionHistory(
      'custom_print_delete',
      'custom_print',
      langRows.map((l) => ({
        cardNo: p.card_no,
        cardNoExtend: p.card_no_extend,
        languageCode: l.language_code,
        action: 'delete_variant' as CollectionHistoryItemAction,
        oldStatus: l.status ?? null,
        oldNormalQty: l.normal_qty ?? null,
        oldFoilQty: l.foil_qty ?? null,
        newStatus: null,
        newNormalQty: null,
        newFoilQty: null,
      }))
    )
    void captureCollectionSnapshot('auto')
  }

  const imgCdn: string | null = p.img_cdn
  if (imgCdn?.startsWith('local://')) {
    return imgCdn.slice('local://'.length)
  }
  return null
}

// ==================== 卡组持有检查 ====================

/**
 * 卡组持有检查：按卡牌聚合收集（含 promo/自定义打印）与卡组需求比较。
 * 可用数量 = owned - 生效借出（active/overdue 的 out）+ 生效借入（active/overdue 的 in），
 * 缺卡数量 = max(0, 需求 - 可用)。
 *
 * @param items 卡组需求（cardPrintId：deck_cards 引用的 card_prints.id；quantity：需求数量）
 * @param opts.matchMode 匹配模式：
 *   - 'print'（默认）：按印刷号精确匹配，即卡牌 ×（card_no + card_no_extend）逐行比较；
 *   - 'card'：仅按基础卡号（cards_base.card_no）聚合，同一张卡的不同印刷异画合并比较。
 */
export async function checkDeckOwnership(
  items: { cardPrintId: string; quantity: number }[],
  opts?: { matchMode?: OwnershipMatchMode }
): Promise<OwnershipCheckRow[]> {
  const matchMode = opts?.matchMode ?? 'print'
  if (items.length === 0) return []
  const db = await getDatabase()

  const printRows = await db.select<any[]>(
    `SELECT p.id AS print_id, p.card_id, cb.card_no AS card_no,
       cb.card_name_cn AS card_name, p.card_no_extend AS card_no_extend
     FROM ${TABLES.CARD_PRINTS} p
     JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE p.id IN (${items.map(() => '?').join(',')})`,
    items.map((i) => i.cardPrintId)
  )
  const printToCard = new Map(printRows.map((r) => [r.print_id, r]))

  const keyOf = (r: any) =>
    matchMode === 'print' ? `${r.card_no}|${r.card_no_extend}` : `${r.card_no}`

  const needByKey = new Map<string, number>()
  for (const item of items) {
    const row = printToCard.get(item.cardPrintId)
    if (!row) continue
    const key = keyOf(row)
    needByKey.set(key, (needByKey.get(key) ?? 0) + item.quantity)
  }

  const keys = [...needByKey.keys()]
  const ownedByKey = new Map<string, number>()
  if (keys.length > 0) {
    if (matchMode === 'print') {
      const conds = keys.map(() => '(col.card_no = ? AND col.card_no_extend = ?)').join(' OR ')
      const params: any[] = []
      for (const key of keys) {
        const [cardNo, cardNoExtend] = key.split('|')
        params.push(cardNo, cardNoExtend)
      }
      const ownedRows = await db.select<any[]>(
        `SELECT col.card_no, col.card_no_extend,
           SUM(cl.normal_qty + cl.foil_qty) AS owned
         FROM ${TABLES.COLLECTION} col
         JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
         WHERE ${conds} AND cl.status = 'owned'
         GROUP BY col.card_no, col.card_no_extend`,
        params
      )
      for (const r of ownedRows) {
        ownedByKey.set(`${r.card_no}|${r.card_no_extend}`, r.owned ?? 0)
      }
    } else {
      const ownedRows = await db.select<any[]>(
        `SELECT col.card_no, SUM(cl.normal_qty + cl.foil_qty) AS owned
         FROM ${TABLES.COLLECTION} col
         JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
         WHERE col.card_no IN (${keys.map(() => '?').join(',')}) AND cl.status = 'owned'
         GROUP BY col.card_no`,
        keys
      )
      for (const r of ownedRows) ownedByKey.set(r.card_no, r.owned ?? 0)
    }
  }

  // 生效中借出/借入聚合（status active/overdue）：available = owned - loan_out + loan_in
  const loanByKey = await getActiveLoanQty(keys, matchMode)

  const result: OwnershipCheckRow[] = []
  for (const key of keys) {
    const sample = printToCard.get(
      [...printToCard.keys()].find((k) => keyOf(printToCard.get(k)!) === key)!
    )!
    const [cardNo, cardNoExtend] = key.split('|')
    const owned = ownedByKey.get(key) ?? 0
    const loanedOut = loanByKey.get(key)?.loanedOut ?? 0
    const borrowedIn = loanByKey.get(key)?.borrowedIn ?? 0
    const available = owned - loanedOut + borrowedIn
    const needed = needByKey.get(key)!
    result.push({
      cardId: sample.card_id,
      cardName: sample.card_name ?? '',
      cardNo: cardNo,
      cardNoExtend: matchMode === 'print' ? (cardNoExtend ?? '') : '',
      needed,
      owned,
      loanedOut,
      borrowedIn,
      available,
      qtyToBuy: Math.max(0, needed - available),
    })
  }
  result.sort(
    (a, b) =>
      b.needed - a.needed ||
      (a.cardNoExtend || a.cardNo).localeCompare(b.cardNoExtend || b.cardNo, undefined, {
        numeric: true,
      })
  )
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

/** 批量校验 items 对应的卡牌确实存在于 card_prints（经 cards_base.card_no 关联），过滤无效项 */
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
): Promise<
  Map<string, { language_code: string; status: string; normal_qty: number; foil_qty: number }[]>
> {
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
 * 批量标记已拥有：对每个卡牌，若尚无任一 owned 数量行，则为默认语言 EN 写入普卡 1。
 * 返回实际更新的卡牌数。整批合并为一条 history 记录。
 */
export async function bulkMarkOwned(items: CollectionItem[]): Promise<number> {
  const valid = await filterValidItems(items)
  const existing = await loadExistingLangs(valid)
  let updated = 0
  const historyItems: HistoryItemInput[] = []
  for (const item of valid) {
    const rows = existing.get(`${item.cardNo}|${item.cardNoExtend}`) ?? []
    if (rows.some((r) => r.status === 'owned' && (r.normal_qty > 0 || r.foil_qty > 0))) continue
    const enRow = rows.find((r) => r.language_code === 'EN')
    const result = await _applyLangQtyWrite(item.cardNo, item.cardNoExtend, 'EN', {
      normal: Math.max(enRow?.normal_qty ?? 0, 1),
      foil: enRow?.foil_qty ?? 0,
    })
    historyItems.push(toHistoryItem(item.cardNo, item.cardNoExtend, 'EN', result))
    updated += 1
  }
  if (historyItems.length > 0) {
    await logCollectionHistory(
      'bulk_mark_owned',
      'batch',
      historyItems,
      `批量标记已拥有 × ${updated}`
    )
    void captureCollectionSnapshot('auto')
  }
  return updated
}

/**
 * 批量普卡 +1：对每个卡牌，在最近更新的 owned 语言行上加 1；无 owned 行时为 SC 建行加 1。
 * 返回实际更新的卡牌数。整批合并为一条 history 记录。
 */
export async function bulkIncrement(items: CollectionItem[]): Promise<number> {
  const valid = await filterValidItems(items)
  const existing = await loadExistingLangs(valid)
  let updated = 0
  const historyItems: HistoryItemInput[] = []
  for (const item of valid) {
    const rows = existing.get(`${item.cardNo}|${item.cardNoExtend}`) ?? []
    const ownedRows = rows.filter(
      (r) => r.status === 'owned' && (r.normal_qty > 0 || r.foil_qty > 0)
    )
    if (ownedRows.length > 0) {
      const pick = ownedRows[0]
      const result = await _applyLangQtyWrite(item.cardNo, item.cardNoExtend, pick.language_code, {
        normal: pick.normal_qty + 1,
        foil: pick.foil_qty,
      })
      historyItems.push(toHistoryItem(item.cardNo, item.cardNoExtend, pick.language_code, result))
    } else {
      const scRow = rows.find((r) => r.language_code === 'SC')
      const result = await _applyLangQtyWrite(item.cardNo, item.cardNoExtend, 'SC', {
        normal: (scRow?.normal_qty ?? 0) + 1,
        foil: scRow?.foil_qty ?? 0,
      })
      historyItems.push(toHistoryItem(item.cardNo, item.cardNoExtend, 'SC', result))
    }
    updated += 1
  }
  if (historyItems.length > 0) {
    await logCollectionHistory('bulk_increment', 'batch', historyItems, `批量普卡 +1 × ${updated}`)
    void captureCollectionSnapshot('auto')
  }
  return updated
}

/**
 * 写回收藏（max 语义，幂等）：确保某卡牌至少拥有 qty 张指定版本。
 * 用于心愿单「标记已拥有」写回——重复标记/来回切换不会重复叠加数量。
 * 语言偏好 '*' → EN，自定义语言未注册时回退 EN；finish 决定普卡/闪卡维度（any 按普卡）。
 * 返回本次实际发生写入的卡牌数（0 = 已有足够数量，未变动）。
 */
export async function writebackOwned(input: {
  cardNo: string
  cardNoExtend?: string
  language?: string
  finish?: string
  qty?: number
}): Promise<number> {
  const { cardNo } = input
  const qty = input.qty ?? 1
  const finish = input.finish ?? 'any'
  const cardNoExtend = await resolveVariantForWriteback(cardNo, input.cardNoExtend)

  let code = normalizePresetCode(
    input.language && input.language !== '*' ? input.language : get(defaultLanguage)
  )
  if (!code || !(await isLanguageCodeValid(code))) code = get(defaultLanguage)

  const rows = await loadExistingLangs([{ cardNo, cardNoExtend }])
  const existing = rows.get(`${cardNo}|${cardNoExtend}`) ?? []
  const ownedRow = existing.find(
    (r) => r.status === 'owned' && (r.normal_qty > 0 || r.foil_qty > 0)
  )
  const target = ownedRow ?? existing.find((r) => r.language_code === code)
  const lang = target?.language_code ?? code

  const curNormal = target?.language_code === lang ? (target.normal_qty ?? 0) : 0
  const curFoil = target?.language_code === lang ? (target.foil_qty ?? 0) : 0
  const isFoil = finish === 'foil'
  const normal = isFoil ? curNormal : Math.max(curNormal, qty)
  const foil = isFoil ? Math.max(curFoil, qty) : curFoil
  if (ownedRow && normal === curNormal && foil === curFoil) return 0

  const result = await _applyLangQtyWrite(cardNo, cardNoExtend, lang, { normal, foil })
  await logCollectionHistory('upsert', 'wishlist', [
    toHistoryItem(cardNo, cardNoExtend, lang, result),
  ])
  void captureCollectionSnapshot('auto')
  return 1
}

/** 某卡牌当前收藏的 owned 总数（各语言行合计，foil 并入）。无记录时返回 0。 */
export async function getCardOwnedQty(cardNo: string, cardNoExtend: string): Promise<number> {
  const db = await getDatabase()
  const rows = await db.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(cl.normal_qty + cl.foil_qty), 0) AS n
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE col.card_no = ? AND col.card_no_extend = ? AND cl.status = 'owned'`,
    [cardNo, cardNoExtend]
  )
  return rows[0]?.n ?? 0
}

/**
 * 累加写回收藏：给某卡牌指定语言行的普卡数量 +qty（真实购入数量）。
 * 用于购买清单「已购买」写回。语言偏好 '*' → SC，自定义语言未注册时回退 SC。
 * 空印刷号（卡牌合并）自动解析为默认印刷。返回本次累加的数量。
 */
export async function incrementOwned(input: {
  cardNo: string
  cardNoExtend?: string
  language?: string
  qty: number
}): Promise<number> {
  const { cardNo } = input
  const qty = input.qty ?? 0
  if (qty <= 0) return 0
  const cardNoExtend = await resolveVariantForWriteback(cardNo, input.cardNoExtend)

  let code = normalizePresetCode(input.language && input.language !== '*' ? input.language : 'SC')
  if (!code || !(await isLanguageCodeValid(code))) code = 'SC'

  const rows = await loadExistingLangs([{ cardNo, cardNoExtend }])
  const existing = rows.get(`${cardNo}|${cardNoExtend}`) ?? []
  const pick = existing.find((r) => r.language_code === code)
  const result = await _applyLangQtyWrite(cardNo, cardNoExtend, code, {
    normal: (pick?.normal_qty ?? 0) + qty,
    foil: pick?.foil_qty ?? 0,
  })
  await logCollectionHistory('upsert', 'purchase_list', [
    toHistoryItem(cardNo, cardNoExtend, code, result),
  ])
  void captureCollectionSnapshot('auto')
  return qty
}

/**
 * 解析卡牌的代表印刷 card_no_extend（非 promo → SC → is_default → print_order 升序）。
 * 用于「按卡牌合并」条目（card_no_extend=''）写回时落到具体印刷；无可用印刷返回 null。
 */
export async function resolveDefaultVariant(
  cardNo: string
): Promise<{ card_no_extend: string } | null> {
  const db = await getDatabase()
  const rows = await db.select<{ card_no_extend: string }[]>(
    `SELECT p.card_no_extend AS card_no_extend
     FROM ${TABLES.CARD_PRINTS} p
     JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE cb.card_no = ?
     ORDER BY CASE WHEN COALESCE(p.is_promo, 0) = 1 THEN 1 ELSE 0 END,
              CASE WHEN p.language = 'SC' THEN 0 WHEN COALESCE(p.is_default, 0) = 1 THEN 1 ELSE 2 END,
              COALESCE(p.print_order, 0),
              p.card_no_extend
     LIMIT 1`,
    [cardNo]
  )
  return rows[0] ?? null
}

/** 写回收藏前解析空印刷号：card_no_extend 为空时解析为代表印刷，解析失败抛错。 */
async function resolveVariantForWriteback(
  cardNo: string,
  cardNoExtend: string | undefined
): Promise<string> {
  let extend = cardNoExtend ?? ''
  if (!extend) {
    const resolved = await resolveDefaultVariant(cardNo)
    if (!resolved) throw new Error(`该卡（${cardNo}）无可用印刷，无法写入收藏`)
    extend = resolved.card_no_extend
  }
  await assertVariantExists(cardNo, extend)
  return extend
}

/** 批量删除收藏记录（卡牌行级联删除语言行），返回删除数。整批合并为一条 history 记录。 */
export async function bulkDeleteCollection(items: CollectionItem[]): Promise<number> {
  const db = await getDatabase()
  const valid = await filterValidItems(items)
  if (valid.length === 0) return 0
  const colConds = valid.map(() => '(col.card_no = ? AND col.card_no_extend = ?)').join(' OR ')
  const delConds = valid.map(() => '(card_no = ? AND card_no_extend = ?)').join(' OR ')
  const params: any[] = []
  for (const i of valid) params.push(i.cardNo, i.cardNoExtend)

  const langRows = await db.select<any[]>(
    `SELECT col.card_no AS card_no, col.card_no_extend AS card_no_extend,
       cl.language_code AS language_code, cl.status AS status,
       cl.normal_qty AS normal_qty, cl.foil_qty AS foil_qty
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE ${colConds}`,
    params
  )

  await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE ${delConds}`, params)

  if (langRows.length > 0) {
    await logCollectionHistory(
      'bulk_delete',
      'batch',
      langRows.map((l) => ({
        cardNo: l.card_no,
        cardNoExtend: l.card_no_extend,
        languageCode: l.language_code,
        action: 'delete_variant' as CollectionHistoryItemAction,
        oldStatus: l.status ?? null,
        oldNormalQty: l.normal_qty ?? null,
        oldFoilQty: l.foil_qty ?? null,
        newStatus: null,
        newNormalQty: null,
        newFoilQty: null,
      })),
      `批量删除收藏 × ${valid.length}`
    )
    void captureCollectionSnapshot('auto')
  }
  return valid.length
}

/**
 * 最近录入的收藏卡片（总览 Hero 展示）。
 * 一个「卡牌 × 语言」一行：join collection_langs 逐语言取数量，
 * 卡图取该卡牌的代表印刷（精确语言 → SC → is_default → 首张）。
 */
export async function getRecentCollectionCards(limit = 6): Promise<RecentCollectionCard[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT col.card_no, col.card_no_extend, col.series_code, col.last_edited_at,
       cb.card_name_cn, cb.card_no, cb.id AS card_id,
       cl.language_code, cl.normal_qty, cl.foil_qty
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE col.last_edited_at IS NOT NULL
     ORDER BY col.last_edited_at DESC
     LIMIT ?`,
    [limit]
  )

  const repMap = new Map<string, CardPrint>()
  if (rows.length > 0) {
    const keys = new Set(rows.map((r) => `${r.card_id}|${r.card_no_extend}`))
    const keyArr = [...keys]
    const rowValueIn = keyArr.map(() => '(?, ?)').join(',')
    const printsRows = await db.select<any[]>(
      `SELECT id, card_id, card_no_extend, language, is_default, is_promo,
        img_cdn, tts_cdn
       FROM ${TABLES.CARD_PRINTS}
       WHERE (card_id, card_no_extend) IN (${rowValueIn})`,
      keyArr.flatMap((k) => k.split('|'))
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

  return rows.map((r) => {
    const langCode = r.language_code ?? 'SC'
    const rep = repMap.get(`${r.card_id}:${r.card_no_extend}`)
    const exact = rep?.language === langCode ? rep : undefined
    const chosen = exact ?? rep
    return {
      cardId: r.card_no,
      cardNoExtend: r.card_no_extend,
      seriesCode: r.series_code ?? null,
      lastEditedAt: r.last_edited_at ?? null,
      cardNameCn: r.card_name_cn ?? null,
      cardNo: r.card_no ?? null,
      ownedNormal: r.normal_qty ?? 0,
      ownedFoil: r.foil_qty ?? 0,
      imgCdn: chosen?.img_cdn ?? null,
      ttsCdn: chosen?.tts_cdn ?? null,
      printId: chosen?.id ?? '',
      langCode,
      printLang: chosen?.language ?? null,
    }
  })
}

/**
 * 缺卡清单筛选（全部可选，不传则不过滤）
 * - seriesCode：按卡图印刷系列码（card_no_extend 前 3 位大写）过滤
 * - bucket：仅统计该桶（base/alt/overnum/rune/token）
 * - rarities：卡牌扩展稀有度（card_prints.extend_rarity_name：平卡/异画/超编/签名超编）
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
 * 缺卡清单（按印刷卡牌逐行）：返回符合筛选条件的每个非 promo 卡牌一行，
 * 含拥有张数（所选语言行的普卡+闪卡合计，仅统计 owned 状态；不传语言则跨语言合计）。
 * 拥有数在 collection（UNIQUE(card_no, card_no_extend)，卡牌 1:1）外层聚合，
 * 避免 card_prints 多语言印刷行与 collection_langs 交叉造成笛卡尔积翻倍。
 */
export async function getMissingVariants(opts?: MissingListFilter): Promise<MissingListRow[]> {
  const db = await getDatabase()
  const innerConds: string[] = ['(COALESCE(p3.is_promo, 0) != 1 OR p3.is_custom = 1)']
  const params: any[] = []

  if (opts?.seriesCode) {
    innerConds.push(
      `(substr(upper(p3.card_no_extend), 1, 3) = ? OR (p3.is_custom = 1 AND cb3.series_name = ?))`
    )
    params.push(opts.seriesCode.toUpperCase(), opts.seriesCode.toUpperCase())
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

  const sql = `SELECT cb.id AS card_id, cb.card_no, cb.card_name_cn, cb.sub_title_cn,
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
      -- 默认稳定顺序：先 base 卡号、再印刷号（等宽补零下 ASCII 排序 ≈ 数值序）。
      -- 缺卡页（missing/+page.svelte sortedRows）始终以 numeric:true 重排，
      -- 此处仅提供确定性初始序，最终显示顺序以前端为准。
      ORDER BY v.card_no_extend COLLATE NOCASE ASC`
  if (opts?.bucket) params.push(opts.bucket)

  const rows = await db.select<any[]>(sql, params)
  return rows.map((r) => ({
    cardId: r.card_id,
    cardNo: r.card_no ?? null,
    cardNoExtend: r.card_no_extend,
    cardNameCn: r.card_name_cn ?? null,
    subCn: r.sub_title_cn ?? null,
    rarity: r.rarity ?? null,
    ownedQty: r.owned_qty ?? 0,
  }))
}

/** 缺卡清单 CSV 回导项（一个印刷卡牌 × 语言） */
export interface ImportOwnedRow {
  cardNoExtend: string
  language: string
  ownedQty: number
}

export interface ImportOwnedResult {
  applied: number
  /** 未匹配到卡牌/语言非法的编号 */
  skipped: string[]
}

/**
 * 把缺卡清单 CSV 的拥有数列写回收藏。
 * @param mode 'overwrite' 精确设为 CSV 值；'add' 在现有数量上累加（缺省语言行按 0 起步）。
 * 需求数列不参与导入（需求数仅存于缺卡页临时状态）。
 *
 * 数量语义（P0 修复）：
 * - CSV「拥有数」视为该语言下的总拥有数（normal + foil）。
 * - overwrite：normal = max(0, 拥有数 - 既有闪卡)，保证总拥有数精确回环、不把闪卡误归为普卡；
 * - add：在既有 normal 上累加（闪卡不变）。
 * 语言由调用方保证非空（解析阶段已把空语言按错误跳过），此处再做合法性校验。
 */
export async function importOwnedCounts(
  rows: ImportOwnedRow[],
  mode: 'add' | 'overwrite' = 'overwrite'
): Promise<ImportOwnedResult> {
  const db = await getDatabase()

  // 语言码合法性预检（一次性批量读取预设+自定义语言，避免逐行查询），非法者记入 skipped
  const validSet = await getValidLanguageCodes()
  const validRows: Array<{ code: string; cardNoExtend: string; ownedQty: number }> = []
  const skippedSet = new Set<string>()
  for (const r of rows) {
    const code = normalizePresetCode(r.language)
    if (!code || !validSet.has(code)) {
      skippedSet.add(`${r.cardNoExtend}#${r.language}`)
      continue
    }
    validRows.push({ code, cardNoExtend: r.cardNoExtend, ownedQty: r.ownedQty })
  }

  // 反查 card_no_extend -> card_no（批量）
  const extendsList = [...new Set(validRows.map((v) => v.cardNoExtend))]
  const cardNoByExtend = new Map<string, string>()
  if (extendsList.length > 0) {
    const sql = `SELECT DISTINCT cb.card_no AS card_no, p.card_no_extend AS card_no_extend
       FROM ${TABLES.CARD_PRINTS} p
       JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
       WHERE p.card_no_extend IN (${extendsList.map(() => '?').join(',')})`
    const found = await db.select<{ card_no: string; card_no_extend: string }[]>(sql, extendsList)
    for (const f of found) cardNoByExtend.set(f.card_no_extend, f.card_no)
  }

  // 预读现有语言行（normal/foil/status），两种模式都需要解析后的目标值
  const existing = new Map<string, { status: string; normal_qty: number; foil_qty: number }>()
  if (validRows.length > 0) {
    const conds = validRows
      .map(() => '(col.card_no_extend = ? AND cl.language_code = ?)')
      .join(' OR ')
    const params: any[] = []
    for (const v of validRows) params.push(v.cardNoExtend, v.code)
    const curr = await db.select<
      {
        card_no_extend: string
        language_code: string
        status: string
        normal_qty: number
        foil_qty: number
      }[]
    >(
      `SELECT col.card_no_extend AS card_no_extend, cl.language_code AS language_code,
         cl.status AS status, cl.normal_qty AS normal_qty, cl.foil_qty AS foil_qty
       FROM ${TABLES.COLLECTION} col
       JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
       WHERE ${conds}`,
      params
    )
    for (const c of curr) existing.set(`${c.card_no_extend}|${c.language_code}`, c)
  }

  let applied = 0
  const historyItems: HistoryItemInput[] = []
  const skipped: string[] = []

  await withTransaction(async () => {
    for (const v of validRows) {
      const cardNo = cardNoByExtend.get(v.cardNoExtend)
      if (!cardNo) {
        skipped.push(`${v.cardNoExtend}#${v.code}`)
        continue
      }
      const prev = existing.get(`${v.cardNoExtend}|${v.code}`)
      let normal: number
      if (mode === 'overwrite') {
        // 拥有数为总拥有数：normal 取总减闪卡，避免把闪卡误归为普卡、保证总数回环
        normal = Math.max(0, v.ownedQty - (prev?.foil_qty ?? 0))
      } else {
        normal = (prev?.normal_qty ?? 0) + v.ownedQty
      }
      const result = await _applyLangQtyWrite(cardNo, v.cardNoExtend, v.code, {
        normal,
        foil: prev?.foil_qty ?? 0,
      })
      historyItems.push(toHistoryItem(cardNo, v.cardNoExtend, v.code, result))
      applied += 1
    }
  })

  if (historyItems.length > 0) {
    await logCollectionHistory('csv_import', 'import', historyItems, `缺卡清单导入 × ${applied}`)
    void captureCollectionSnapshot('auto')
  }

  return { applied, skipped: [...skippedSet, ...skipped] }
}

// ==================== 完整收藏 CSV 导入导出 ====================

/** 完整收藏导出：一行 = 一个印刷 × 语言 */
export interface FullCollectionExportRow {
  cardNoExtend: string
  cardNameCn: string | null
  language: string
  normalQty: number
  foilQty: number
  status: CollectionStatus
}

/** 读取全部收藏明细（含普卡/闪卡/状态，语言维不合并；卡名含副标题） */
export async function getCollectionFullRows(): Promise<FullCollectionExportRow[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT col.card_no, col.card_no_extend, cb.card_name_cn AS card_name_cn,
       cb.sub_title_cn AS sub_title_cn,
       cl.language_code, cl.status, cl.normal_qty, cl.foil_qty
     FROM ${TABLES.COLLECTION_LANGS} cl
     JOIN ${TABLES.COLLECTION} col ON col.id = cl.collection_id
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
     ORDER BY col.card_no_extend COLLATE NOCASE ASC, cl.language_code ASC`
  )
  return rows.map((r) => ({
    cardNoExtend: r.card_no_extend,
    cardNameCn: combineCardName(r.card_name_cn, r.sub_title_cn),
    language: r.language_code,
    normalQty: r.normal_qty ?? 0,
    foilQty: r.foil_qty ?? 0,
    status: (r.status as CollectionStatus) ?? 'owned',
  }))
}

export interface FullCollectionImportRow {
  cardNoExtend: string
  language: string
  normalQty: number
  foilQty: number
  status?: CollectionStatus
}

export interface FullCollectionImportResult {
  applied: number
  updated: number
  created: number
  skipped: string[]
}

/**
 * 完整收藏 CSV 回导：按 card_no_extend × language 幂等 upsert（事务化）。
 * - 已存在语言行 → 更新数量/状态；不存在 → 新建；
 * - 重复导入同一文件不产生脏数据（唯一键天然幂等）；
 * - 中途失败整体回滚。
 */
export async function importFullCollection(
  rows: FullCollectionImportRow[]
): Promise<FullCollectionImportResult> {
  const db = await getDatabase()
  const validSet = await getValidLanguageCodes()

  const validRows: Array<{
    code: string
    cardNoExtend: string
    normalQty: number
    foilQty: number
    status?: CollectionStatus
  }> = []
  const skippedSet = new Set<string>()
  for (const r of rows) {
    const code = normalizePresetCode(r.language)
    if (!code || !validSet.has(code)) {
      skippedSet.add(`${r.cardNoExtend}#${r.language}`)
      continue
    }
    validRows.push({
      code,
      cardNoExtend: r.cardNoExtend,
      normalQty: r.normalQty,
      foilQty: r.foilQty,
      status: r.status,
    })
  }

  const extendsList = [...new Set(validRows.map((v) => v.cardNoExtend))]
  const cardNoByExtend = new Map<string, string>()
  if (extendsList.length > 0) {
    const sql = `SELECT DISTINCT cb.card_no AS card_no, p.card_no_extend AS card_no_extend
       FROM ${TABLES.CARD_PRINTS} p
       JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
       WHERE p.card_no_extend IN (${extendsList.map(() => '?').join(',')})`
    const found = await db.select<{ card_no: string; card_no_extend: string }[]>(sql, extendsList)
    for (const f of found) cardNoByExtend.set(f.card_no_extend, f.card_no)
  }

  let applied = 0
  let updated = 0
  let created = 0
  const skipped: string[] = []
  const historyItems: HistoryItemInput[] = []

  await withTransaction(async () => {
    for (const v of validRows) {
      const cardNo = cardNoByExtend.get(v.cardNoExtend)
      if (!cardNo) {
        skipped.push(`${v.cardNoExtend}#${v.code}`)
        continue
      }
      const result = await _applyLangQtyWrite(
        cardNo,
        v.cardNoExtend,
        v.code,
        { normal: v.normalQty, foil: v.foilQty },
        v.status
      )
      historyItems.push(toHistoryItem(cardNo, v.cardNoExtend, v.code, result))
      if (result.action === 'add') created += 1
      else updated += 1
      applied += 1
    }
  })

  if (historyItems.length > 0) {
    await logCollectionHistory(
      'csv_import',
      'full_collection',
      historyItems,
      `完整收藏导入 × ${applied}`
    )
    void captureCollectionSnapshot('auto')
  }

  return { applied, updated, created, skipped: [...skippedSet, ...skipped] }
}
