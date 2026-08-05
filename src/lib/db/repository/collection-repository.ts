/**
 * 收藏数据仓储层
 * 收藏按「变体（card_id + card_no_extend）× 语言」记录普卡/闪卡数量；
 * 变体语言为自由文本（官方 SC/EN + 用户自定语言）。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type {
  CollectionLang,
  CollectionStats,
  CustomPrintInput,
  OwnershipCheckRow,
  SeriesStats,
} from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { getAllSeries } from './series-repository'
import { getCardById } from './card-repository'

const now = () => new Date().toISOString()

// ==================== 数量编辑 ====================

/**
 * 设置某变体某语言的普卡/闪卡数量（传入 undefined 表示不修改该维度）。
 * 两者都归零时删除语言行；变体无任何语言时删除变体行。
 */
export async function upsertLangQty(
  cardId: string,
  cardNoExtend: string,
  language: string,
  qty: { normal?: number; foil?: number }
): Promise<void> {
  const db = await getDatabase()

  const colRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION} WHERE card_id = ? AND card_no_extend = ?`,
    [cardId, cardNoExtend]
  )
  let collectionId = colRows[0]?.id

  const langRows = collectionId
    ? await db.select<{ id: string; normal_qty: number; foil_qty: number }[]>(
        `SELECT id, normal_qty, foil_qty FROM ${TABLES.COLLECTION_LANGS}
         WHERE collection_id = ? AND language = ?`,
        [collectionId, language]
      )
    : []

  const existing = langRows[0]
  const normal = qty.normal ?? existing?.normal_qty ?? 0
  const foil = qty.foil ?? existing?.foil_qty ?? 0

  if (!collectionId) {
    collectionId = Snowflake.generate()
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION} (id, card_id, card_no_extend, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [collectionId, cardId, cardNoExtend, now(), now()]
    )
  }

  if (normal <= 0 && foil <= 0) {
    if (existing) {
      await db.execute(`DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE id = ?`, [existing.id])
      const remain = await db.select<{ id: string }[]>(
        `SELECT id FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id = ?`,
        [collectionId]
      )
      if (remain.length === 0) {
        await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE id = ?`, [collectionId])
      }
    }
    return
  }

  if (existing) {
    await db.execute(
      `UPDATE ${TABLES.COLLECTION_LANGS}
       SET normal_qty = ?, foil_qty = ?, updated_at = ? WHERE id = ?`,
      [normal, foil, now(), existing.id]
    )
  } else {
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION_LANGS}
       (id, collection_id, language, normal_qty, foil_qty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [Snowflake.generate(), collectionId, language, normal, foil, now(), now()]
    )
  }
  await db.execute(`UPDATE ${TABLES.COLLECTION} SET updated_at = ? WHERE id = ?`, [
    now(),
    collectionId,
  ])
}

/** 获取某变体的语言数量明细 */
export async function getVariantLangs(
  cardId: string,
  cardNoExtend: string
): Promise<CollectionLang[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT cl.id, cl.collection_id, cl.language, cl.normal_qty, cl.foil_qty
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE col.card_id = ? AND col.card_no_extend = ?`,
    [cardId, cardNoExtend]
  )
  return rows.map((r) => ({
    id: r.id,
    collection_id: r.collection_id,
    language: r.language,
    normal_qty: r.normal_qty,
    foil_qty: r.foil_qty,
  }))
}

/** 获取某卡全部变体的语言明细（详情弹窗用），key 为 card_no_extend */
export async function getCardCollection(cardId: string): Promise<Map<string, CollectionLang[]>> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT col.card_no_extend, cl.id, cl.collection_id, cl.language, cl.normal_qty, cl.foil_qty
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE col.card_id = ?
     ORDER BY col.card_no_extend ASC`,
    [cardId]
  )
  const map = new Map<string, CollectionLang[]>()
  for (const r of rows) {
    if (!map.has(r.card_no_extend)) map.set(r.card_no_extend, [])
    map.get(r.card_no_extend)!.push({
      id: r.id,
      collection_id: r.collection_id,
      language: r.language,
      normal_qty: r.normal_qty,
      foil_qty: r.foil_qty,
    })
  }
  return map
}

// ==================== 统计 ====================

/**
 * 收藏统计：按系列×五桶（base/alt/overnum/rune/token）聚合已拥有变体数，
 * 与 series 表预设计数合并；promo 变体全桶排除、单列统计。
 */
export async function getCollectionStats(): Promise<CollectionStats> {
  const db = await getDatabase()

  const ownedRows = await db.select<any[]>(
    `SELECT series, bucket, COUNT(*) AS owned FROM (
       SELECT cb.series_name AS series,
         CASE
           WHEN cb.card_category LIKE '%符文%' THEN 'rune'
           WHEN cb.card_category LIKE '%指示物%' THEN 'token'
           WHEN MAX(p.extend_rarity_name) = '异画' THEN 'alt'
           WHEN MAX(p.extend_rarity_name) IN ('超编', '签名超编') THEN 'overnum'
           ELSE 'base'
         END AS bucket
       FROM ${TABLES.COLLECTION} col
       JOIN ${TABLES.CARD_PRINTS} p
         ON p.card_id = col.card_id AND p.card_no_extend = col.card_no_extend
       JOIN ${TABLES.CARDS_BASE} cb ON cb.id = col.card_id
       WHERE COALESCE(p.is_promo, 0) != 1
       GROUP BY col.card_id, col.card_no_extend
     )
     GROUP BY series, bucket`
  )

  const promoRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(DISTINCT col.card_id || '|' || col.card_no_extend) AS n
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.CARD_PRINTS} p
       ON p.card_id = col.card_id AND p.card_no_extend = col.card_no_extend
     WHERE COALESCE(p.is_promo, 0) = 1`
  )

  const foilRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(DISTINCT col.card_id || '|' || col.card_no_extend) AS n
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE cl.foil_qty > 0`
  )

  const ownedMap = new Map<string, Partial<Record<string, number>>>()
  for (const r of ownedRows) {
    if (!ownedMap.has(r.series)) ownedMap.set(r.series, {})
    ownedMap.get(r.series)![r.bucket] = r.owned
  }

  const seriesList = await getAllSeries()
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
      return { code: s.code, nameCn: s.name_cn, owned: o, counts, totalOwned, totalCount }
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
 */
export async function createCustomPrint(input: CustomPrintInput): Promise<string> {
  const db = await getDatabase()
  const printId = Snowflake.generate()
  const t = now()

  const card = await getCardById(input.cardId)

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
      card?.rarity_name ?? null,
      input.extendRarityName,
      null,
      input.language,
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
    await upsertLangQty(input.cardId, input.cardNoExtend, input.language, {
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
    `SELECT card_id, card_no_extend, img_cdn FROM ${TABLES.CARD_PRINTS} WHERE id = ?`,
    [printId]
  )
  const p = rows[0]
  if (!p) return null

  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE id = ?`, [printId])

  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id IN (
       SELECT id FROM ${TABLES.COLLECTION} WHERE card_id = ? AND card_no_extend = ?
     )`,
    [p.card_id, p.card_no_extend]
  )
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION} WHERE card_id = ? AND card_no_extend = ?`,
    [p.card_id, p.card_no_extend]
  )

  const imgCdn: string | null = p.img_cdn
  if (imgCdn?.startsWith('local://')) {
    return imgCdn.slice('local://'.length)
  }
  return null
}

// ==================== 卡组持有检查 ====================

/**
 * 卡组持有检查：按卡牌聚合所有变体×语言数量（含 promo/自定义打印）与卡组需求比较
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
    needByCard.set(row.card_id, (needByCard.get(row.card_id) ?? 0) + item.quantity)
  }

  const cardIds = [...needByCard.keys()]
  const ownedByCard = new Map<string, number>()
  if (cardIds.length > 0) {
    const ownedRows = await db.select<any[]>(
      `SELECT col.card_id, SUM(cl.normal_qty + cl.foil_qty) AS owned
       FROM ${TABLES.COLLECTION} col
       JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
       WHERE col.card_id IN (${cardIds.map(() => '?').join(',')})
       GROUP BY col.card_id`,
      cardIds
    )
    for (const r of ownedRows) ownedByCard.set(r.card_id, r.owned ?? 0)
  }

  const result: OwnershipCheckRow[] = []
  for (const [cardId, needed] of needByCard) {
    const sample = printToCard.get(
      [...printToCard.keys()].find((k) => printToCard.get(k)!.card_id === cardId)!
    )!
    result.push({
      cardId,
      cardName: sample.card_name ?? '',
      cardNo: sample.card_no ?? '',
      needed,
      owned: ownedByCard.get(cardId) ?? 0,
    })
  }
  result.sort((a, b) => b.needed - a.needed || a.cardNo.localeCompare(b.cardNo))
  return result
}

// ==================== 维护 ====================

/** 清理孤儿收藏行（card_id 已不在 cards_base） */
export async function cleanupOrphans(): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id NOT IN (SELECT id FROM ${TABLES.COLLECTION})`
  )
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION} WHERE card_id NOT IN (SELECT id FROM ${TABLES.CARDS_BASE})`
  )
}
