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

  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.CARD_PRINTS}
     (id, card_id, card_no_extend, rarity_name, extend_rarity_name, back_image,
      language, img_cdn, tts_cdn, artist, print_order, is_default, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
      print.created_at,
    ]
  )
}

/**
 * 批量保存卡图（使用事务）
 */
export async function saveCardPrints(prints: CardPrint[]): Promise<void> {
  const db = await getDatabase()
  await db.execute('BEGIN TRANSACTION;')

  try {
    for (const print of prints) {
      await saveCardPrint(print)
    }
    await db.execute('COMMIT;')
  } catch (error) {
    await db.execute('ROLLBACK;')
    throw error
  }
}

/**
 * 获取所有卡图
 */
export async function getPrints(): Promise<CardPrint[]> {
  const db = await getDatabase()
  const results = await db.select<any[]>(
    `SELECT id, card_id, img_cdn, tts_cdn FROM ${TABLES.CARD_PRINTS} WHERE language = 'SC'`
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
 * 清空所有卡图数据
 */
export async function clearAllPrints(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS}`)
}
