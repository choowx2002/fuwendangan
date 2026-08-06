/**
 * 数据维护仓储层
 * 提供按 FK 安全顺序执行的批量清理功能
 */

import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 清空卡牌数据（卡牌基础数据 + 卡图），保留卡组、保留用户自建打印（卡片基础数据中的自定义卡条目）。
 * 本地 SQLite 未开启外键级联，因此显式删除 card_prints 与 cards_base；
 * 卡组中的 deck_cards 引用会因 id 失效，待下次同步时由 repointDeckCardReferences 重新关联。
 */
export async function clearCardData(): Promise<void> {
  const db = await getDatabase()

  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE is_custom IS NOT 1`)
  await db.execute(
    `DELETE FROM ${TABLES.CARDS_BASE} WHERE id NOT IN (
       SELECT DISTINCT card_id FROM ${TABLES.CARD_PRINTS} WHERE is_custom = 1
     )`
  )
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
    `DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id NOT IN (
       SELECT id FROM ${TABLES.COLLECTION}
     )`
  )
  await db.execute(`DELETE FROM ${TABLES.FILTER_OPTIONS}`)
  await db.execute(`DELETE FROM ${TABLES.VERSION}`)
}