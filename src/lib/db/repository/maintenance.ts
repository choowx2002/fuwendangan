/**
 * 数据维护仓储层
 * 提供按 FK 安全顺序执行的批量清理功能
 */

import { getDatabase } from './database'
import { TABLES } from '../config/constants'

/**
 * 清空卡牌数据（卡牌基础数据 + 卡图）。
 * 由于 deck_cards 引用 card_prints（无级联），必须先用级联删除卡组引用，
 * 再删除 cards_base（级联 card_prints），同时重置筛选与同步标记，下次启动将重新同步。
 */
export async function clearCardData(): Promise<void> {
  const db = await getDatabase()

  await db.execute(`DELETE FROM ${TABLES.DECKS}`)
  await db.execute(`DELETE FROM ${TABLES.CARDS_BASE}`)
  await db.execute(`DELETE FROM ${TABLES.FILTER_OPTIONS}`)
  await db.execute(`DELETE FROM ${TABLES.VERSION}`)
}
