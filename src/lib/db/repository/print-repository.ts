/**
 * 卡牌版本/卡图数据仓储层
 */

import type { CardPrint } from '../types'
import { mapRowToPrint } from '../helper'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 保存或更新单个卡图
 */
export async function saveCardPrint(print: CardPrint): Promise<void> {
  const db = await getDatabase()
  const isDefaultInt = print.is_default === null ? null : print.is_default ? 1 : 0
  const isPromoInt = print.is_promo === null ? null : print.is_promo ? 1 : 0
  const isCustomInt = print.is_custom === null ? null : print.is_custom ? 1 : 0

  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.CARD_PRINTS}
     (id, card_id, card_no_extend, rarity_name, extend_rarity_name, back_image,
      language, img_cdn, tts_cdn, artist, print_order, is_default, is_promo, is_custom,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      print.id,
      print.card_id,
      print.card_no_extend,
      print.rarity_name,
      print.extend_rarity_name,
      print.back_image,
      print.language,
      print.img_cdn,
      print.tts_cdn,
      print.artist,
      print.print_order,
      isDefaultInt,
      isPromoInt,
      isCustomInt,
      print.created_at,
      print.updated_at,
    ]
  )
}

/**
 * 批量保存卡图（使用事务）
 */
export async function saveCardPrints(prints: CardPrint[]): Promise<void> {
  await getDatabase()

  try {
    for (const print of prints) {
      await saveCardPrint(print)
    }
  } catch (error) {
    throw error
  }
}

/**
 * 获取所有卡图
 */
export async function getPrints(): Promise<CardPrint[]> {
  const db = await getDatabase()
  const results = await db.select<any[]>(
    `SELECT id, card_id, card_no_extend, language, img_cdn, tts_cdn FROM ${TABLES.CARD_PRINTS} WHERE language = 'SC'`
  )

  return results.map(mapRowToPrint)
}

/**
 * 根据卡牌 ID 获取所有卡图
 */
export async function getPrintsByCardId(cardId: string): Promise<CardPrint[]> {
  const db = await getDatabase()
  const results = await db.select<any[]>(
    `SELECT * FROM ${TABLES.CARD_PRINTS} WHERE card_id = $1 ORDER BY print_order ASC`,
    [cardId]
  )

  return results.map(mapRowToPrint)
}

/**
 * 获取所有卡图数量
 */
export async function getPrintCount(): Promise<number> {
  const db = await getDatabase()
  const results = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM ${TABLES.CARD_PRINTS}`
  )
  return results[0]?.count ?? 0
}

/**
 * 删除卡图
 */
export async function deletePrint(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE id = $1`, [id])
}

/**
 * 根据卡牌 ID 删除所有关联卡图
 */
export async function deletePrintsByCardId(cardId: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE card_id = $1`, [cardId])
}

/**
 * 清空所有卡图数据（保留用户自建打印 is_custom=1，防全量同步时丢失）
 */
export async function clearAllPrints(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE is_custom IS NOT 1`)
}

/*
 * 用来获取最新的updatedat的时间
 */
export async function getLatestUpdatePrintTime(): Promise<string> {
  const db = await getDatabase()
  const results = await db.select<{ updated_at: string }[]>(
    `SELECT updated_at FROM ${TABLES.CARD_PRINTS} ORDER BY updated_at DESC LIMIT 1`
  )
  return results[0]?.updated_at ?? ''
}

// ==================== 开包彩蛋 ====================

/**
 * 开包抽取的稀有度过滤条件。
 * - rarityName：基础稀有度精确匹配（普通/不凡/稀有/史诗）
 * - extendRarityName：扩展稀有度（异画/超编/签名超编）；null 表示只取平卡（非异画/超编/签名超编）
 * - isToken：true 表示仅指示物类别
 */
export interface PackPrintFilter {
  rarityName?: string | null
  extendRarityName?: string | null
  isToken?: boolean
}

/** 开包抽到的卡：卡图 + 关联的基础卡信息 */
export interface PackPrint extends CardPrint {
  card_name_cn: string | null
  card_no: string | null
  card_category: string[] | null
}

/**
 * 从指定系列的卡池中随机抽取一张符合稀有度条件的卡图。
 * 排除促销（is_promo）与自建（is_custom）印刷，语言取 SC。
 */
export async function getRandomPackPrint(
  seriesCode: string,
  filter: PackPrintFilter
): Promise<PackPrint | null> {
  const db = await getDatabase()
  const conds: string[] = [
    `p.language = 'SC'`,
    `COALESCE(p.is_promo, 0) != 1`,
    `COALESCE(p.is_custom, 0) != 1`,
    `substr(upper(p.card_no_extend), 1, 3) = ?`,
    `cb.card_category NOT LIKE '%符文%'`,
  ]
  const params: (string | number)[] = [seriesCode.toUpperCase()]

  if (filter.isToken) {
    conds.push(`cb.card_category LIKE '%指示物%'`)
  } else if (filter.extendRarityName !== undefined) {
    if (filter.extendRarityName) {
      conds.push(`p.extend_rarity_name = ?`)
      params.push(filter.extendRarityName)
      conds.push(`cb.card_category NOT LIKE '%指示物%'`)
    } else {
      conds.push(`COALESCE(p.extend_rarity_name, '') NOT IN ('异画', '超编', '签名超编')`)
    }
  }
  if (filter.rarityName) {
    conds.push(`p.rarity_name = ?`)
    params.push(filter.rarityName)
  }

  const results = await db.select<any[]>(
    `SELECT p.*, cb.card_name_cn, cb.card_no, cb.card_category
     FROM ${TABLES.CARD_PRINTS} p
     JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE ${conds.join(' AND ')}
     ORDER BY RANDOM()
     LIMIT 1`,
    params
  )
  if (!results[0]) return null
  return {
    ...mapRowToPrint(results[0]),
    card_name_cn: results[0].card_name_cn ?? null,
    card_no: results[0].card_no ?? null,
    card_category: results[0].card_category ? JSON.parse(results[0].card_category) : null,
  }
}
