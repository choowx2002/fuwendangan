/**
 * 卡组数据仓储层
 */

import type { Deck, DeckCard, SqliteDeck, SqliteDeckCard } from '../types'
import { mapRowToDeck, mapRowToDeckCard, toSqliteDeck, toSqliteDeckCard } from '../helper'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { Snowflake } from '@theinternetfolks/snowflake'

/**
 * 获取当前时间戳（ISO 8601）
 */
function now(): string {
  return new Date().toISOString()
}

/**
 * 创建新卡组
 */
export async function createDeck(
  deck: Omit<Deck, 'id' | 'card_count' | 'created_at' | 'updated_at'>
): Promise<Deck> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const timestamp = now()

  const sqliteDeck: SqliteDeck = {
    id,
    name: deck.name,
    description: deck.description || null,
    format: deck.format || null,
    cover_image: deck.cover_image || null,
    card_count: 0,
    is_favorite: false ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp,
  }

  await db.execute(
    `INSERT INTO ${TABLES.DECKS}
     (id, name, description, format, cover_image, card_count, is_favorite, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      sqliteDeck.id,
      sqliteDeck.name,
      sqliteDeck.description,
      sqliteDeck.format,
      sqliteDeck.cover_image,
      sqliteDeck.card_count,
      sqliteDeck.is_favorite,
      sqliteDeck.created_at,
      sqliteDeck.updated_at,
    ]
  )

  return {
    ...sqliteDeck,
    is_favorite: sqliteDeck.is_favorite === 1,
  }
}

/**
 * 获取所有卡组
 */
export async function getAllDecks(): Promise<Deck[]> {
  const db = await getDatabase()
  const results = await db.select<any[]>(`SELECT * FROM ${TABLES.DECKS} ORDER BY updated_at DESC`)
  return results.map(mapRowToDeck)
}

/**
 * 根据 ID 获取卡组
 */
export async function getDeckById(id: string): Promise<Deck | null> {
  const db = await getDatabase()
  const results = await db.select<any[]>(`SELECT * FROM ${TABLES.DECKS} WHERE id = $1`, [id])
  if (results.length === 0) return null
  return mapRowToDeck(results[0])
}

/**
 * 更新卡组信息
 */
export async function updateDeck(
  id: string,
  updates: Partial<Omit<Deck, 'id' | 'card_count' | 'created_at'>>
): Promise<void> {
  const db = await getDatabase()
  const timestamp = now()

  const fields: string[] = []
  const values: any[] = []
  let paramIndex = 1

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${paramIndex++}`)
    values.push(updates.description)
  }
  if (updates.format !== undefined) {
    fields.push(`format = $${paramIndex++}`)
    values.push(updates.format)
  }
  if (updates.cover_image !== undefined) {
    fields.push(`cover_image = $${paramIndex++}`)
    values.push(updates.cover_image)
  }
  if (updates.is_favorite !== undefined) {
    fields.push(`is_favorite = $${paramIndex++}`)
    values.push(updates.is_favorite ? 1 : 0)
  }

  if (fields.length === 0) return

  fields.push(`updated_at = $${paramIndex}`)
  values.push(timestamp)

  await db.execute(
    `UPDATE ${TABLES.DECKS} SET ${fields.join(', ')} WHERE id = $${paramIndex + 1}`,
    [...values, id]
  )
}

/**
 * 删除卡组
 */
export async function deleteDeck(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.DECKS} WHERE id = $1`, [id])
}

/**
 * 获取卡组的卡牌列表
 */
export async function getDeckCards(deckId: string): Promise<DeckCard[]> {
  const db = await getDatabase()
  const results = await db.select<any[]>(
    `SELECT * FROM ${TABLES.DECK_CARDS} WHERE deck_id = $1 ORDER BY is_sideboard ASC, card_id ASC`,
    [deckId]
  )
  return results.map(mapRowToDeckCard)
}

/**
 * 添加卡牌到卡组
 */
export async function addCardToDeck(
  deckId: string,
  cardId: string,
  quantity: number = 1,
  isSideboard: boolean = false
): Promise<void> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const timestamp = now()

  const sqliteDeckCard: SqliteDeckCard = {
    id,
    deck_id: deckId,
    card_id: cardId,
    quantity,
    is_sideboard: isSideboard ? 1 : 0,
    created_at: timestamp,
  }

  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.DECK_CARDS}
     (id, deck_id, card_id, quantity, is_sideboard, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sqliteDeckCard.id,
      sqliteDeckCard.deck_id,
      sqliteDeckCard.card_id,
      sqliteDeckCard.quantity,
      sqliteDeckCard.is_sideboard ? 1 : 0,
      sqliteDeckCard.created_at,
    ]
  )

  // 更新卡组卡牌数量
  await updateDeckCardCount(deckId)
}

/**
 * 从卡组移除卡牌
 */
export async function removeCardFromDeck(
  deckId: string,
  cardId: string,
  isSideboard: boolean = false
): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `DELETE FROM ${TABLES.DECK_CARDS} WHERE deck_id = $1 AND card_id = $2 AND is_sideboard = $3`,
    [deckId, cardId, isSideboard ? 1 : 0]
  )

  // 更新卡组卡牌数量
  await updateDeckCardCount(deckId)
}

/**
 * 更新卡组中某张卡牌的数量
 */
export async function updateCardQuantity(
  deckId: string,
  cardId: string,
  quantity: number,
  isSideboard: boolean = false
): Promise<void> {
  const db = await getDatabase()
  if (quantity <= 0) {
    await removeCardFromDeck(deckId, cardId, isSideboard)
  } else {
    await db.execute(
      `UPDATE ${TABLES.DECK_CARDS} SET quantity = $1 WHERE deck_id = $2 AND card_id = $3 AND is_sideboard = $4`,
      [quantity, deckId, cardId, isSideboard ? 1 : 0]
    )
  }
}

/**
 * 更新卡组的卡牌总数
 */
async function updateDeckCardCount(deckId: string): Promise<void> {
  const db = await getDatabase()
  const result = await db.select<{ total: number }[]>(
    `SELECT SUM(quantity) as total FROM ${TABLES.DECK_CARDS} WHERE deck_id = $1`,
    [deckId]
  )
  const cardCount = result[0]?.total || 0

  await db.execute(`UPDATE ${TABLES.DECKS} SET card_count = $1, updated_at = $2 WHERE id = $3`, [
    cardCount,
    now(),
    deckId,
  ])
}

/**
 * 清空卡组中的所有卡牌
 */
export async function clearDeckCards(deckId: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.DECK_CARDS} WHERE deck_id = $1`, [deckId])
  await updateDeckCardCount(deckId)
}

/**
 * 复制卡组
 */
export async function duplicateDeck(sourceDeckId: string, newName?: string): Promise<Deck> {
  const db = await getDatabase()

  // 获取原卡组
  const sourceDeck = await getDeckById(sourceDeckId)
  if (!sourceDeck) {
    throw new Error('Source deck not found')
  }

  // 创建新卡组
  const newDeck = await createDeck({
    name: newName || `${sourceDeck.name} (Copy)`,
    description: sourceDeck.description,
    format: sourceDeck.format,
    cover_image: sourceDeck.cover_image,
    is_favorite: false,
  })

  // 复制卡牌
  const sourceCards = await getDeckCards(sourceDeckId)
  for (const deckCard of sourceCards) {
    await addCardToDeck(newDeck.id, deckCard.card_id, deckCard.quantity, deckCard.is_sideboard)
  }

  return newDeck
}

/**
 * 导出卡组为文本格式（用于导入/导出）
 */
export async function exportDeck(deckId: string): Promise<string> {
  const deck = await getDeckById(deckId)
  if (!deck) {
    throw new Error('Deck not found')
  }

  const cards = await getDeckCards(deckId)

  const mainDeck = cards.filter((c) => !c.is_sideboard)
  const sideboard = cards.filter((c) => c.is_sideboard)

  let output = `# ${deck.name}\n`
  if (deck.description) {
    output += `${deck.description}\n\n`
  }
  if (deck.format) {
    output += `Format: ${deck.format}\n\n`
  }

  output += '## Main Deck\n'
  for (const card of mainDeck) {
    output += `${card.quantity}x [${card.card_id}]\n`
  }

  if (sideboard.length > 0) {
    output += '\n## Sideboard\n'
    for (const card of sideboard) {
      output += `${card.quantity}x [${card.card_id}]\n`
    }
  }

  return output
}

/**
 * 批量导入卡牌到卡组（TCG 卡牌导入格式）
 * 支持格式：
 * - "3x Card Name"
 * - "2x [card_id]"
 * - "Card Name" (默认为 1 张)
 */
export async function importCardsToDeck(
  deckId: string,
  importText: string,
  isSideboard: boolean = false
): Promise<{ success: number; failed: string[] }> {
  const lines = importText.split('\n').filter((line) => line.trim())
  const result = { success: 0, failed: [] as string[] }

  for (const line of lines) {
    const trimmedLine = line.trim()

    // 跳过注释和空行
    if (trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
      continue
    }

    // 解析数量和卡牌标识符
    let quantity = 1
    let cardIdentifier = trimmedLine

    const match = trimmedLine.match(/^(\d+)[xX]\s*(.+)$/)
    if (match) {
      quantity = parseInt(match[1], 10)
      cardIdentifier = match[2].trim()
    }

    // 尝试从标识符中提取 card_id（支持 [card_id] 格式）
    let cardId: string | null = null
    const bracketMatch = cardIdentifier.match(/\[([^\]]+)\]/)
    if (bracketMatch) {
      cardId = bracketMatch[1]
    } else {
      // 如果没有明确的 card_id，可以尝试通过卡牌名称查找
      // 这里简化处理，假设传入的就是 card_id
      cardId = cardIdentifier
    }

    if (cardId) {
      try {
        await addCardToDeck(deckId, cardId, quantity, isSideboard)
        result.success++
      } catch (error) {
        result.failed.push(`${trimmedLine} - ${(error as Error).message}`)
      }
    } else {
      result.failed.push(trimmedLine)
    }
  }

  return result
}
