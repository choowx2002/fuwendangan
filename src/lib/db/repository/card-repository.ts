/**
 * 卡牌基础数据仓储层
 */

import type { CardBase, SqliteCardBase } from '../types'
import { toSqliteModel, mapRowToCard } from '../helper'
import { getDatabase } from './database'
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
  const db = await getDatabase()
  await db.execute('BEGIN TRANSACTION;')

  try {
    for (const card of cards) {
      await saveCard(card)
    }
    await db.execute('COMMIT;')
  } catch (error) {
    await db.execute('ROLLBACK;')
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
 * 清空所有卡牌数据
 */
export async function clearAllCards(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CARDS_BASE}`)
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
