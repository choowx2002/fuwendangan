/**
 * 数据维护仓储层
 * 提供按 FK 安全顺序执行的批量清理功能
 */

import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 清空卡牌数据（卡牌基础数据 + 卡图），保留卡组与收藏，并保留用户自建打印（卡片基础数据中的自定义卡条目）。
 * 收藏按稳定 card_no 引用 cards_base，真孤儿在下次同步时由 collection-repository.ts 的 cleanupOrphans() 清理。
 * 外键已开启（sqlx 默认 PRAGMA foreign_keys=ON），card_prints.card_id → cards_base ON DELETE CASCADE，
 * 因此显式按「先清卡图、再清卡基」的顺序删除；卡组中的 deck_cards 引用会因 id 失效，待下次同步时由 repointDeckCardReferences 重新关联。
 */
export async function clearCardData(): Promise<void> {
  const db = await getDatabase()

  await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE is_custom IS NOT 1`)
  await db.execute(
    `DELETE FROM ${TABLES.CARDS_BASE} WHERE id NOT IN (
       SELECT DISTINCT card_id FROM ${TABLES.CARD_PRINTS} WHERE is_custom = 1
     )`
  )
  await db.execute(`DELETE FROM ${TABLES.FILTER_OPTIONS}`)
  await db.execute(`DELETE FROM ${TABLES.VERSION}`)
}
