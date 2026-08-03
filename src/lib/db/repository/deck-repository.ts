/**
 * 卡组数据仓储层
 */

import type { Deck } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { Snowflake } from '@theinternetfolks/snowflake'

export interface DeckInput {
  name: string
  description?: string | null
  format?: string | null
  cover_image?: string | null
  is_favorite?: number
}

/**
 * 获取当前时间戳（ISO 8601）
 */
function now(): string {
  return new Date().toISOString()
}

/**
 * 1. Create: 创建套牌
 */
export async function createDeck(input: DeckInput): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const timestamp = now()

  const sql = `
     INSERT INTO ${TABLES.DECKS} (id, name, description, format, cover_image, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   `

  await db.execute(sql, [
    id,
    input.name,
    input.description ?? null,
    input.format ?? null,
    input.cover_image ?? null,
    input.is_favorite ?? 0, // 默认不收藏
    timestamp,
    timestamp,
  ])

  return id
}

/**
 * 2. Read: 根据 ID 获取套牌详情
 */
export async function getDeckById(id: string): Promise<Deck | null> {
  const db = await getDatabase()
  const sql = `SELECT * FROM ${TABLES.DECKS} WHERE id = ?`

  const results = await db.select<Deck[]>(sql, [id])
  return results.length > 0 ? results[0] : null
}

/**
 * 3. Read: 获取套牌列表 (支持简单过滤和排序)
 */
export async function getDecks(options?: {
  is_favorite?: number
  format?: string
  search?: string
}): Promise<Deck[]> {
  const db = await getDatabase()

  let sql = `SELECT * FROM ${TABLES.DECKS}`
  const conditions: string[] = []
  const params: any[] = []

  if (options?.is_favorite !== undefined) {
    conditions.push(`is_favorite = ?`)
    params.push(options.is_favorite)
  }

  if (options?.format) {
    conditions.push(`format = ?`)
    params.push(options.format)
  }

  if (options?.search) {
    conditions.push(`name LIKE ?`)
    params.push(`%${options.search}%`)
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ')
  }

  // 默认按更新时间倒序排列
  sql += ` ORDER BY updated_at DESC`

  return await db.select<Deck[]>(sql, params)
}

/**
 * 4. Update: 更新套牌信息 (动态拼接字段)
 */
export async function updateDeck(id: string, input: Partial<DeckInput>): Promise<boolean> {
  const db = await getDatabase()
  const timestamp = now()

  const fields: string[] = []
  const params: any[] = []

  // 动态构建 SET 子句
  if (input.name !== undefined) {
    fields.push(`name = ?`)
    params.push(input.name)
  }
  if (input.description !== undefined) {
    fields.push(`description = ?`)
    params.push(input.description)
  }
  if (input.format !== undefined) {
    fields.push(`format = ?`)
    params.push(input.format)
  }
  if (input.cover_image !== undefined) {
    fields.push(`cover_image = ?`)
    params.push(input.cover_image)
  }
  if (input.is_favorite !== undefined) {
    fields.push(`is_favorite = ?`)
    params.push(input.is_favorite)
  }

  // 如果没有需要更新的字段，直接返回
  if (fields.length === 0) return true

  // 追加 updated_at
  fields.push(`updated_at = ?`)
  params.push(timestamp)

  // 最后追加 WHERE 条件的参数
  params.push(id)

  const sql = `UPDATE ${TABLES.DECKS} SET ${fields.join(', ')} WHERE id = ?`

  await db.execute(sql, params)
  return true
}

/**
 * 删除套牌
 */
export async function deleteDeck(id: string): Promise<boolean> {
  const db = await getDatabase()
  const sql = `DELETE FROM ${TABLES.DECKS} WHERE id = ?`
  console.log('[DECKS] succes remove deck')
  await db.execute(sql, [id])
  return true
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const db = await getDatabase()
  const timestamp = now()

  // SQLite 中翻转 0/1 的优雅写法： 1 - is_favorite
  const sql = `UPDATE ${TABLES.DECKS} SET is_favorite = 1 - is_favorite, updated_at = ? WHERE id = ?`

  await db.execute(sql, [timestamp, id])
  return true
}

//DECK VERSION
export interface DeckCardInput {
  cardPrintId: string
  quantity: number
  zone: string
}

export interface DeckVersion {
  id: string
  deck_id: string
  version_number: number
  note: string | null
  created_at: string
}

export interface DeckCard {
  id: string
  deck_id: string
  card_id: string // 注意：这里实际存的是 card_prints 的 id
  quantity: number
  zone: string // 例如 'main', 'sideboard'
  created_at: string
}

export interface DeckCardDetail extends DeckCard {
  card_name_cn: string
  card_name_en: string
  sub_title_cn: string | null
  sub_title_en: string | null
  energy: number
  return_energy: number
  power: number
  card_color_list: string
  print_code: string
  img_cdn: string
  rarity_name: string
}

/**
 * 某版本中的卡牌（含版本归属，用于一次性加载全部版本的卡牌以计算差异）
 */
export interface DeckVersionCard {
  deck_version_id: string
  card_id: string // card_prints.id
  quantity: number
  zone: string
  card_name_cn: string
  card_name_en: string
  sub_title_cn: string | null
  sub_title_en: string | null
  print_code: string
  img_cdn: string | null
}

export async function saveDeckAsNewVersion(
  deckId: string,
  cards: DeckCardInput[],
  note?: string
): Promise<string> {
  // 返回新版本的 ID
  const db = await getDatabase()
  const timestamp = now()

  const maxVersionResult = await db.select<{ max_v: number | null }[]>(
    `SELECT MAX(version_number) as max_v FROM deck_versions WHERE deck_id = ?`,
    [deckId]
  )
  const currentMax = maxVersionResult[0]?.max_v || 0
  const newVersionNumber = currentMax + 1

  const newVersionId = Snowflake.generate()

  try {
    await db.execute(
      `INSERT INTO deck_versions (id, deck_id, version_number, note, created_at) VALUES (?, ?, ?, ?, ?)`,
      [newVersionId, deckId, newVersionNumber, note || null, timestamp]
    )

    if (cards.length > 0) {
      const insertSql = `
         INSERT INTO deck_cards (id, deck_version_id, card_id, quantity, zone, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
       `
      for (const card of cards) {
        if (card.quantity > 0) {
          await db.execute(insertSql, [
            Snowflake.generate(),
            newVersionId,
            card.cardPrintId,
            card.quantity,
            card.zone,
            timestamp,
          ])
        }
      }
    }

    return newVersionId
  } catch (error) {
    console.error('[DECKS VERSION] error:', error)

    throw error
  }
}

/**
 * 覆盖更新指定卡组的最新版本卡牌内容（不新增版本）
 */
export async function updateDeckLatestVersion(
  deckId: string,
  cards: DeckCardInput[]
): Promise<string> {
  const db = await getDatabase()
  const timestamp = now()

  const latestVersionResult = await db.select<{ id: string }[]>(
    `SELECT id FROM deck_versions WHERE deck_id = ? ORDER BY version_number DESC LIMIT 1`,
    [deckId]
  )

  if (latestVersionResult.length === 0) {
    return saveDeckAsNewVersion(deckId, cards)
  }

  const versionId = latestVersionResult[0].id

  try {
    await db.execute(`DELETE FROM deck_cards WHERE deck_version_id = ?`, [versionId])

    if (cards.length > 0) {
      const insertSql = `
         INSERT INTO deck_cards (id, deck_version_id, card_id, quantity, zone, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
       `
      for (const card of cards) {
        if (card.quantity > 0) {
          await db.execute(insertSql, [
            Snowflake.generate(),
            versionId,
            card.cardPrintId,
            card.quantity,
            card.zone,
            timestamp,
          ])
        }
      }
    }

    return versionId
  } catch (error) {
    console.error('[DECKS VERSION] 覆盖更新失败:', error)

    throw error
  }
}

/**
 * 使用 WITH (CTE) 语法，优雅地找出最新版本并关联查询
 */
export async function getLatestDeckCards(deckId: string): Promise<DeckCardDetail[]> {
  const db = await getDatabase()

  const sql = `
     WITH LatestVersion AS (
       SELECT id FROM deck_versions
       WHERE deck_id = ?
       ORDER BY version_number DESC
       LIMIT 1
     )
     SELECT
       dc.id, dc.card_id, dc.quantity, dc.zone,
       cb.card_name_cn, cb.card_name_en, cb.sub_title_cn, cb.sub_title_en, cb.energy, cb.return_energy, cb.power, cb.card_color_list,
       cp.card_no_extend as print_code, cp.img_cdn, cp.rarity_name
     FROM deck_cards dc
     JOIN card_prints cp ON dc.card_id = cp.id
     JOIN cards_base cb ON cp.card_id = cb.id
     JOIN LatestVersion lv ON dc.deck_version_id = lv.id
     ORDER BY
       CASE dc.zone WHEN 'main' THEN 1 WHEN 'sideboard' THEN 2 ELSE 3 END,
       cb.card_name_cn
   `

  const results = await db.select<DeckCardDetail[]>(sql, [deckId])
  return results ?? []
}

export async function getDeckVersions(deckId: string): Promise<DeckVersion[]> {
  const db = await getDatabase()
  const sql = `
      SELECT id, deck_id, version_number, note, created_at
      FROM deck_versions
      WHERE deck_id = ?
      ORDER BY version_number DESC
    `
  return await db.select<DeckVersion[]>(sql, [deckId])
}

/**
 * 🔍 获取【指定版本】的卡牌快照 (用于查看历史或对比)
 */
export async function getDeckCardsByVersion(versionId: string): Promise<DeckCardDetail[]> {
  const db = await getDatabase()
  const sql = `
     SELECT
       dc.id, dc.card_id, dc.quantity, dc.zone,
       cb.card_name_cn, cb.card_name_en, cb.sub_title_cn, cb.sub_title_en, cb.energy, cb.power, cb.card_color_list,
       cp.card_no_extend as print_code, cp.img_cdn, cp.rarity_name
     FROM deck_cards dc
     JOIN card_prints cp ON dc.card_id = cp.id
     JOIN cards_base cb ON cp.card_id = cb.id
     WHERE dc.deck_version_id = ?
     ORDER BY
       CASE dc.zone WHEN 'main' THEN 1 WHEN 'sideboard' THEN 2 ELSE 3 END,
       cb.card_name_cn
   `
  return await db.select<DeckCardDetail[]>(sql, [versionId])
}

/**
 * 一次性获取某个卡组所有版本的卡牌（用于版本历史差异对比，避免 N+1 查询）
 */
export async function getDeckVersionCards(deckId: string): Promise<DeckVersionCard[]> {
  const db = await getDatabase()
  const sql = `
     SELECT
       dc.deck_version_id, dc.card_id, dc.quantity, dc.zone,
       cb.card_name_cn, cb.card_name_en, cb.sub_title_cn, cb.sub_title_en,
       cp.card_no_extend as print_code, cp.img_cdn
     FROM deck_cards dc
     JOIN deck_versions dv ON dc.deck_version_id = dv.id
     JOIN card_prints cp ON dc.card_id = cp.id
     JOIN cards_base cb ON cp.card_id = cb.id
     WHERE dv.deck_id = ?
   `
  const results = await db.select<DeckVersionCard[]>(sql, [deckId])
  return results ?? []
}

/**
 * 获取套牌列表（包含最新版本信息及卡牌过滤）
 */
export interface GetDeckListOptions {
  limit?: number
  offset?: number
  deckName?: string
  format?: string
  isFavorite?: number
  // 针对【最新版本】中的卡牌进行过滤
  cardFilter?: {
    legendName?: string // 对应 cards_base 表中的名称字段 (如 name 或 card_name_cn)
    subtitle?: string // 对应 cards_base 表中的副标题字段
  }
}

export interface DeckListResult {
  id: string
  name: string
  description: string | null
  format: string | null
  cover_image: string | null
  is_favorite: number
  created_at: string
  updated_at: string
  latest_version_number: number | null
  latest_version_card_count: number
  legend_id?: string
  legend_name?: string
  legend_sub?: string | null
  legend_champion_tag?: string[] | null
  legend_color_list?: string[] | null
  legend_image?: string | null
  legend_print_id: string
}

export async function getDeckList(
  options: GetDeckListOptions = {}
): Promise<{ decks: DeckListResult[]; total: number }> {
  const db = await getDatabase()
  const { limit = 20, offset = 0, deckName, format, isFavorite, cardFilter } = options

  const whereConditions: string[] = []
  const params: any[] = []

  // 1. 基础 Deck 过滤条件
  if (deckName) {
    whereConditions.push(`d.name LIKE ?`)
    params.push(`%${deckName}%`)
  }
  if (format) {
    whereConditions.push(`d.format = ?`)
    params.push(format)
  }
  if (isFavorite !== undefined) {
    whereConditions.push(`d.is_favorite = ?`)
    params.push(isFavorite)
  }

  // 2. 最新版本卡牌过滤条件 (使用 EXISTS 子查询)
  // 这样可以避免主查询 JOIN 导致 Deck 记录重复，同时确保只检查该 Deck 的【最新版本】
  if (cardFilter) {
    const cardWhere: string[] = []
    const subParams: any[] = []

    if (cardFilter.legendName) {
      cardWhere.push(`cb.card_name_cn LIKE ?`)
      subParams.push(`%${cardFilter.legendName}%`)
    }
    if (cardFilter.subtitle) {
      cardWhere.push(`cb.sub_title_cn LIKE ?`)
      subParams.push(`%${cardFilter.subtitle}%`)
    }

    if (cardWhere.length > 0) {
      const existsSubquery = `
        EXISTS (
          SELECT 1 
          FROM deck_cards dc
          JOIN deck_versions dv ON dc.deck_version_id = dv.id AND dv.deck_id = d.id
          JOIN card_prints cp ON dc.card_id = cp.id
          JOIN cards_base cb ON cp.card_id = cb.id
          WHERE dv.version_number = (
            SELECT MAX(version_number) FROM deck_versions WHERE deck_id = d.id
          )
          AND ${cardWhere.join(' AND ')}
        )
      `
      whereConditions.push(existsSubquery)
      params.push(...subParams)
    }
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

  // 3. 查询数据列表 (使用 CTE 高效计算最新版本的卡牌总数)
  const dataSql = `
    WITH LatestVersions AS (
      -- 获取每个 deck 的最新版本 ID 和版本号
      SELECT deck_id, id AS version_id, version_number
      FROM (
        SELECT deck_id, id, version_number,
               ROW_NUMBER() OVER(PARTITION BY deck_id ORDER BY version_number DESC) as rn
        FROM deck_versions
      ) WHERE rn = 1
    ),
    VersionCardCounts AS (
      -- 计算每个最新版本的卡牌总数 (按 quantity 求和)
      SELECT lv.deck_id, COALESCE(SUM(dc.quantity), 0) AS card_count
      FROM LatestVersions lv
      LEFT JOIN deck_cards dc ON lv.version_id = dc.deck_version_id
      GROUP BY lv.deck_id
    ), 
    LegendInfo AS (
      SELECT
        lv.deck_id,
        cb.id AS legend_id,
        cp.id AS legend_print_id,
        cb.card_name_cn AS legend_name,
        cb.sub_title_cn AS legend_sub,
        cb.champion_tag AS legend_champion_tag,
        cb.card_color_list AS legend_color_list,
        cp.img_cdn AS legend_image

      FROM LatestVersions lv

      JOIN deck_cards dc
        ON lv.version_id = dc.deck_version_id

      JOIN card_prints cp
        ON dc.card_id = cp.id

      JOIN cards_base cb
        ON cp.card_id = cb.id

      WHERE dc.zone = 'legend'
    )
    SELECT 
      d.id, 
      d.name, 
      d.description, 
      d.format, 
      d.cover_image, 
      d.is_favorite, 
      d.created_at, 
      d.updated_at,
      lv.version_number AS latest_version_number,
      COALESCE(vcc.card_count, 0) AS latest_version_card_count,
      li.*
    FROM decks d
    LEFT JOIN LatestVersions lv ON d.id = lv.deck_id
    LEFT JOIN VersionCardCounts vcc ON d.id = vcc.deck_id
    LEFT JOIN LegendInfo li ON d.id = li.deck_id
    ${whereClause}
    ORDER BY d.updated_at DESC
    LIMIT ? OFFSET ?
  `

  const dataParams = [...params, limit, offset]
  const decks = await db.select<DeckListResult[]>(dataSql, dataParams)

  // 4. 查询总数 (用于前端分页组件)
  // 复用相同的 WHERE 条件以确保总数与当前页数据匹配
  const countSql = `
    SELECT COUNT(d.id) AS total
    FROM decks d
    ${whereClause}
  `
  const countResult = await db.select<{ total: number }[]>(countSql, params)
  const total = countResult[0]?.total || 0
  return { decks, total }
}

/**
 * Duplicate a deck (copy latest version)
 */
export async function duplicateDeck(deckId: string): Promise<string> {
  const db = await getDatabase()
  const timestamp = now()

  const newDeckId = Snowflake.generate()
  const newVersionId = Snowflake.generate()

  try {
    // 1. Get original deck
    const decks = await db.select<Deck[]>(`SELECT * FROM decks WHERE id = ?`, [deckId])

    if (decks.length === 0) {
      throw new Error('Deck not found')
    }

    const sourceDeck = decks[0]

    // 2. Create new deck
    await db.execute(
      `
      INSERT INTO decks (
        id,
        name,
        description,
        format,
        cover_image,
        is_favorite,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        newDeckId,
        `${sourceDeck.name}（复制）`,
        sourceDeck.description,
        sourceDeck.format,
        sourceDeck.cover_image,
        0, // duplicated deck should not keep favorite
        timestamp,
        timestamp,
      ]
    )

    // 3. Get latest version
    const versions = await db.select<DeckVersion[]>(
      `
      SELECT *
      FROM deck_versions
      WHERE deck_id = ?
      ORDER BY version_number DESC
      LIMIT 1
      `,
      [deckId]
    )

    if (versions.length === 0) {
      // no cards/version, still return duplicated deck
      return newDeckId
    }

    const sourceVersion = versions[0]

    // 4. Create new version
    await db.execute(
      `
      INSERT INTO deck_versions (
        id,
        deck_id,
        version_number,
        note,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        newVersionId,
        newDeckId,
        1,
        `Duplicated from version ${sourceVersion.version_number}`,
        timestamp,
      ]
    )

    // 5. Copy cards
    const cards = await db.select<DeckCard[]>(
      `
      SELECT *
      FROM deck_cards
      WHERE deck_version_id = ?
      `,
      [sourceVersion.id]
    )

    if (cards.length > 0) {
      for (const card of cards) {
        await db.execute(
          `
          INSERT INTO deck_cards (
            id,
            deck_version_id,
            card_id,
            quantity,
            zone,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [Snowflake.generate(), newVersionId, card.card_id, card.quantity, card.zone, timestamp]
        )
      }
    }

    return newDeckId
  } catch (error) {
    console.error('[DUPLICATE DECK] failed:', error)
    throw error
  }
}
