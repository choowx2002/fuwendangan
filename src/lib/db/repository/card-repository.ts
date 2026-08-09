/**
 * 卡牌基础数据仓储层
 */

import type { CardBase, CardPrint, SqliteCardBase } from '../types'
import { toSqliteModel, mapRowToCard } from '../helper'
import { getDatabase } from './database'
import { getPrintsByCardId } from './print-repository'
import { TABLES } from '../config/constants'

/**
 * 保存或更新单张卡牌
 */
export async function saveCard(card: CardBase): Promise<void> {
  const db = await getDatabase()
  const sqliteCard = toSqliteModel(card)

  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.CARDS_BASE}
     (id, card_no, card_name_cn, card_name_en, sub_title_cn, sub_title_en, card_category,
      card_color_list, region, tag, keyword, advanced_tag, champion_tag, effect_cn, effect_en,
      energy, return_energy, power, rarity_name, series_name, flavor_text_cn, flavor_text_en,
      is_banned, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [
      sqliteCard.id,
      sqliteCard.card_no,
      sqliteCard.card_name_cn,
      sqliteCard.card_name_en,
      sqliteCard.sub_title_cn,
      sqliteCard.sub_title_en,
      sqliteCard.card_category,
      sqliteCard.card_color_list,
      sqliteCard.region,
      sqliteCard.tag,
      sqliteCard.keyword,
      sqliteCard.advanced_tag,
      sqliteCard.champion_tag,
      sqliteCard.effect_cn,
      sqliteCard.effect_en,
      sqliteCard.energy,
      sqliteCard.return_energy,
      sqliteCard.power,
      sqliteCard.rarity_name,
      sqliteCard.series_name,
      sqliteCard.flavor_text_cn,
      sqliteCard.flavor_text_en,
      sqliteCard.is_banned,
      sqliteCard.created_at,
      sqliteCard.updated_at,
    ]
  )
}

/**
 * 批量保存卡牌（使用事务）
 */
export async function saveCards(cards: CardBase[]): Promise<void> {
  await getDatabase()

  try {
    for (const card of cards) {
      await saveCard(card)
    }
  } catch (error) {
    throw error
  }
}

/**
 * 根据 ID 获取卡牌
 */
export async function getCardById(id: string): Promise<CardBase | null> {
  const db = await getDatabase()
  const results = await db.select<any[]>(`SELECT * FROM ${TABLES.CARDS_BASE} WHERE id = $1`, [id])

  if (results.length === 0) return null
  return mapRowToCard(results[0])
}

/**
 * 根据卡图 ID 反查对应的卡牌基础数据
 */
export async function getCardByPrintId(printId: string): Promise<CardBase | null> {
  const db = await getDatabase()
  const results = await db.select<any[]>(
    `SELECT cb.* FROM ${TABLES.CARDS_BASE} cb JOIN ${TABLES.CARD_PRINTS} cp ON cp.card_id = cb.id WHERE cp.id = $1`,
    [printId]
  )

  if (results.length === 0) return null
  return mapRowToCard(results[0])
}

/**
 * 根据印刷编号（card_no_extend，如 "OGN-007"）反查卡牌，并带上全部卡图 + 匹配的卡图 id。
 * 仅取 SC、非 promo/自建打印；找不到返回 null。
 * 供 Deck Code 导入等按编号定位卡牌的场景使用。
 */
export async function getCardAndPrintByPrintCode(
  printCode: string
): Promise<((CardBase & { card_prints: CardPrint[] }) & { selectedPrints?: string }) | null> {
  const db = await getDatabase()
  const results = await db.select<any[]>(
    `SELECT cb.*, cp.id AS __print_id
     FROM ${TABLES.CARDS_BASE} cb
     JOIN ${TABLES.CARD_PRINTS} cp ON cp.card_id = cb.id
     WHERE upper(cp.card_no_extend) = upper($1)
       AND cp.language = 'SC'
       AND COALESCE(cp.is_promo, 0) != 1
       AND COALESCE(cp.is_custom, 0) != 1
     ORDER BY cp.print_order ASC
     LIMIT 1`,
    [printCode]
  )
  if (results.length === 0) return null

  const card = mapRowToCard(results[0])
  const prints = await getPrintsByCardId(card.id)
  return { ...card, card_prints: prints, selectedPrints: results[0].__print_id ?? undefined }
}

/**
 * 根据基础卡牌编号（cards_base.card_no）反查卡牌，并带上全部卡图 + 匹配的卡图 id。
 * 仅取 SC、非 promo/自建打印；找不到返回 null。
 * 供「二维码」导入等按 card_no 定位卡牌的场景使用（QR payload 使用 card_no 而非 card_no_extend）。
 */
export async function getCardAndPrintByCardNo(
  cardNo: string
): Promise<((CardBase & { card_prints: CardPrint[] }) & { selectedPrints?: string }) | null> {
  const db = await getDatabase()
  const results = await db.select<any[]>(
    `SELECT cb.*, cp.id AS __print_id
     FROM ${TABLES.CARDS_BASE} cb
     JOIN ${TABLES.CARD_PRINTS} cp ON cp.card_id = cb.id
     WHERE upper(cb.card_no) = upper($1)
       AND cp.language = 'SC'
       AND COALESCE(cp.is_promo, 0) != 1
       AND COALESCE(cp.is_custom, 0) != 1
     ORDER BY cp.print_order ASC
     LIMIT 1`,
    [cardNo]
  )
  if (results.length === 0) return null

  const card = mapRowToCard(results[0])
  const prints = await getPrintsByCardId(card.id)
  return { ...card, card_prints: prints, selectedPrints: results[0].__print_id ?? undefined }
}

/**
 * 根据英文卡牌名称（card_name_en，可选 subtitle）反查卡牌，并带上全部卡图 + 匹配的卡图 id。
 * 仅取 SC、非 promo/自建打印；找不到返回 null。
 * 匹配尽力宽容：先精确匹配 名称+副标题，再退化为只匹配名称。
 * 供「国际官方文本」文本导入等按英文名定位卡牌的场景使用。
 */
export async function getCardAndPrintByEnglishName(
  displayName: string,
  opts?: { legendOnly?: boolean }
): Promise<((CardBase & { card_prints: CardPrint[] }) & { selectedPrints?: string }) | null> {
  const trimmed = displayName.trim()
  if (!trimmed) return null

  const [name, subtitle] = splitNameCombo(trimmed)
  // 传奇区：官方文本为「英雄名, 卡名」，匹配卡名（去除 "- Starter" 等 "- 后缀"）
  if (opts?.legendOnly) {
    return resolveLegendByName(subtitle ?? name)
  }
  const db = await getDatabase()

  const baseSelect = `
    SELECT DISTINCT cb.*, cp.id AS __print_id
    FROM ${TABLES.CARDS_BASE} cb
    JOIN ${TABLES.CARD_PRINTS} cp ON cp.card_id = cb.id
    WHERE 
      cp.language = 'SC'
      AND COALESCE(cp.is_promo, 0) != 1
      AND COALESCE(cp.is_custom, 0) != 1
      AND lower(trim(cb.card_name_en)) = lower(trim($1))
  `
  const orderBy = ` ORDER BY cp.card_no_extend ASC LIMIT 1`

  let rows: any[] = []
  if (subtitle) {
    rows = await db.select<any[]>(
      `${baseSelect} AND lower(trim(cb.sub_title_en)) = lower(trim($2))${orderBy}`,
      [name, subtitle]
    )
  }
  // 兜底1：仅按名称匹配（副标题不一致时）
  if (rows.length === 0) {
    rows = await db.select<any[]>(`${baseSelect}${orderBy}`, [name])
  }
  // 兜底2：名称本身已含副标题（DB 整体存为 card_name_en）
  if (rows.length === 0) {
    rows = await db.select<any[]>(
      `SELECT DISTINCT cb.*, cp.id AS __print_id
       FROM ${TABLES.CARDS_BASE} cb
       JOIN ${TABLES.CARD_PRINTS} cp ON cp.card_id = cb.id
       WHERE cp.language = 'SC'
         AND COALESCE(cp.is_promo, 0) != 1
         AND COALESCE(cp.is_custom, 0) != 1
         AND lower(trim(cb.card_name_en)) = lower(trim($1))
       ${orderBy}`,
      [trimmed]
    )
  }
  if (rows.length === 0) return null

  const card = mapRowToCard(rows[0])
  const prints = await getPrintsByCardId(card.id)
  return { ...card, card_prints: prints, selectedPrints: rows[0].__print_id ?? undefined }
}

/** 将形如 "Master Yi, Wuju Bladesman" 拆分为 名称 + 可选副标题 */
function splitNameCombo(displayName: string): [string, string | null] {
  const match = /^(.*?)\s*[,]\s*(.+)$/.exec(displayName)
  if (match) {
    return [match[1].trim(), match[2].trim()]
  }
  return [displayName, null]
}

/**
 * 按传奇卡名定位传奇卡。卡名可能带 "- Starter" 等 "- 后缀"（如 "Wuju Bladesman - Starter"），
 * 去除该后缀后做前缀匹配；仅限传奇分类（card_category 含「传奇」）。
 */
async function resolveLegendByName(
  legendName: string
): Promise<((CardBase & { card_prints: CardPrint[] }) & { selectedPrints?: string }) | null> {
  const base = legendName.trim().replace(/\s*-\s*.*$/, '')
  if (!base) return null

  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT DISTINCT cb.*, cp.id AS __print_id
     FROM ${TABLES.CARDS_BASE} cb
     JOIN ${TABLES.CARD_PRINTS} cp ON cp.card_id = cb.id
     WHERE cp.language = 'SC'
       AND COALESCE(cp.is_promo, 0) != 1
       AND COALESCE(cp.is_custom, 0) != 1
       AND cb.card_category LIKE '%传奇%'
       AND lower(trim(cb.card_name_en)) LIKE lower(trim($1)) || '%'
     ORDER BY cp.card_no_extend ASC
     LIMIT 1`,
    [base]
  )
  if (rows.length === 0) return null

  const card = mapRowToCard(rows[0])
  const prints = await getPrintsByCardId(card.id)
  return { ...card, card_prints: prints, selectedPrints: rows[0].__print_id ?? undefined }
}

/**
 * 获取所有卡牌数量
 */
export async function getCardCount(): Promise<number> {
  const db = await getDatabase()
  const results = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM ${TABLES.CARDS_BASE}`
  )
  return results[0]?.count ?? 0
}

/**
 * 删除卡牌
 */
export async function deleteCard(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CARDS_BASE} WHERE id = $1`, [id])
}

/**
 * 清空所有卡牌数据（保留被用户自建打印引用的基础卡，防全量同步时自定义打印随基础卡丢失）
 */
export async function clearAllCards(): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `DELETE FROM ${TABLES.CARDS_BASE} WHERE id NOT IN (
       SELECT DISTINCT card_id FROM ${TABLES.CARD_PRINTS} WHERE is_custom = 1
     )`
  )
}

/*
 * 用来获取最新的updatedat的时间
 */
export async function getLatestUpdateCardTime(): Promise<string> {
  const db = await getDatabase()
  const results = await db.select<{ updated_at: string }[]>(
    `SELECT updated_at FROM ${TABLES.CARDS_BASE} ORDER BY updated_at DESC LIMIT 1`
  )
  return results[0]?.updated_at ?? ''
}
