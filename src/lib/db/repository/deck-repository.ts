/**
 * 卡组数据仓储层
 */

import type { Deck, MatchWinType } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { parseTags, serializeTags } from '../helper'
import { createMatch } from './match-record-repository'
import { Snowflake } from '@theinternetfolks/snowflake'

export interface DeckInput {
  name: string
  description?: string | null
  format?: string | null
  cover_image?: string | null
  tags?: string[]
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
     INSERT INTO ${TABLES.DECKS} (id, name, description, format, cover_image, tags, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   `

  await db.execute(sql, [
    id,
    input.name,
    input.description ?? null,
    input.format ?? null,
    input.cover_image ?? null,
    serializeTags(input.tags),
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
  if (results.length === 0) return null
  const row = results[0] as any
  return { ...row, tags: parseTags(row.tags) }
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

  const rows = await db.select<Deck[]>(sql, params)
  return rows.map((row) => ({ ...row, tags: parseTags((row as any).tags) }))
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
  if (input.tags !== undefined) {
    fields.push(`tags = ?`)
    params.push(serializeTags(input.tags))
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

/**
 * 清空所有套牌（级联删除版本与卡牌引用）
 */
export async function deleteAllDecks(): Promise<boolean> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.DECKS}`)
  return true
}

/**
 * 清理冗余版本：每个卡组仅保留最新版本，删除其余版本及其卡牌引用
 */
export async function cleanupDeckVersions(): Promise<number> {
  const db = await getDatabase()

  const result = await db.select<{ deleted: number }[]>(
    `SELECT COUNT(*) as deleted
     FROM deck_versions
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER(PARTITION BY deck_id ORDER BY version_number DESC) as rn
         FROM deck_versions
       ) WHERE rn = 1
     )`
  )
  const deleted = result[0]?.deleted ?? 0

  await db.execute(
    `DELETE FROM deck_versions
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER(PARTITION BY deck_id ORDER BY version_number DESC) as rn
         FROM deck_versions
       ) WHERE rn = 1
     )`
  )

  return deleted
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
  printCode: string
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
  print_code: string | null // card_prints.card_no_extend 的稳定快照，用于 id 变更后修复引用
  quantity: number
  zone: string // 例如 'main', 'sideboard'
  created_at: string
}

export interface DeckCardDetail extends DeckCard {
  card_base_id: string
  print_id: string
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
  language: string
}

/**
 * 某版本中的卡牌（含版本归属，用于一次性加载全部版本的卡牌以计算差异）
 */
export interface DeckVersionCard {
  deck_version_id: string
  card_id: string // card_prints.id
  card_base_id: string
  print_id: string
  quantity: number
  zone: string
  card_name_cn: string
  card_name_en: string
  sub_title_cn: string | null
  sub_title_en: string | null
  print_code: string
  img_cdn: string | null
  language: string
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
         INSERT INTO deck_cards (id, deck_version_id, card_id, print_code, quantity, zone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       `
      for (const card of cards) {
        if (card.quantity > 0) {
          await db.execute(insertSql, [
            Snowflake.generate(),
            newVersionId,
            card.cardPrintId,
            card.printCode || null,
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
         INSERT INTO deck_cards (id, deck_version_id, card_id, print_code, quantity, zone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       `
      for (const card of cards) {
        if (card.quantity > 0) {
          await db.execute(insertSql, [
            Snowflake.generate(),
            versionId,
            card.cardPrintId,
            card.printCode || null,
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
 * 更新指定卡组最新版本的备注
 */
export async function updateDeckLatestVersionNote(
  deckId: string,
  note: string | null
): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.execute(
    `UPDATE deck_versions
     SET note = ?
     WHERE deck_id = ? AND version_number = (
       SELECT MAX(version_number) FROM deck_versions WHERE deck_id = ?
     )`,
    [note, deckId, deckId]
  )

  return result.rowsAffected > 0
}

/**
 * 更新指定版本的备注
 */
export async function updateDeckVersionNote(
  versionId: string,
  note: string | null
): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.execute(`UPDATE deck_versions SET note = ? WHERE id = ?`, [
    note,
    versionId,
  ])

  return result.rowsAffected > 0
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
       cb.id as card_base_id, cp.id as print_id,
       cb.card_name_cn, cb.card_name_en, cb.sub_title_cn, cb.sub_title_en, cb.energy, cb.return_energy, cb.power, cb.card_color_list,
       cp.card_no_extend as print_code, cp.img_cdn, cp.rarity_name, cp.language
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
       cb.id as card_base_id, cp.id as print_id,
       cb.card_name_cn, cb.card_name_en, cb.sub_title_cn, cb.sub_title_en, cb.energy, cb.power, cb.card_color_list,
       cp.card_no_extend as print_code, cp.img_cdn, cp.rarity_name, cp.language
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
       cb.id as card_base_id, cp.id as print_id,
       cb.card_name_cn, cb.card_name_en, cb.sub_title_cn, cb.sub_title_en,
       cp.card_no_extend as print_code, cp.img_cdn, cp.language
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
  tags: string[]
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
  legend_print_code?: string | null
  legend_lang?: string | null
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
        cp.img_cdn AS legend_image,
        cp.card_no_extend AS legend_print_code,
        cp.language AS legend_lang

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
      d.tags,
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
  const rawDecks = await db.select<DeckListResult[]>(dataSql, dataParams)
  const decks = rawDecks.map((row) => ({ ...row, tags: parseTags((row as any).tags) }))

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
    const sourceTags = parseTags((sourceDeck as any).tags)

    // 2. Create new deck
    await db.execute(
      `
      INSERT INTO decks (
        id,
        name,
        description,
        format,
        cover_image,
        tags,
        is_favorite,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        newDeckId,
        `${sourceDeck.name}（复制）`,
        sourceDeck.description,
        sourceDeck.format,
        sourceDeck.cover_image,
        serializeTags(sourceTags),
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
            print_code,
            quantity,
            zone,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Snowflake.generate(),
            newVersionId,
            card.card_id,
            card.print_code ?? null,
            card.quantity,
            card.zone,
            timestamp,
          ]
        )
      }
    }

    return newDeckId
  } catch (error) {
    console.error('[DUPLICATE DECK] failed:', error)
    throw error
  }
}

/**
 * JSON 导入的卡组数据（对应导出功能生成的 decks-export 文件）
 */
export interface ImportDeckPayload {
  name: string
  description?: string | null
  format?: string | null
  cover_image?: string | null
  tags?: string[]
  is_favorite?: boolean
  created_at?: string | null
  updated_at?: string | null
  versions: {
    version_number: number
    note?: string | null
    created_at?: string | null
    cards: {
      card_id: string
      print_code?: string | null
      quantity: number
      zone: string
    }[]
  }[]
  matches?: ImportMatchPayload[]
}

export interface ImportMatchPayload {
  group_name?: string | null
  opponent_name?: string | null
  opponent_deck?: string | null
  opp_legend_id?: string | null
  opp_legend_print_id?: string | null
  opp_legend_name?: string | null
  opp_legend_image?: string | null
  deck_version_id?: string | null
  deck_version_number?: number | null
  best_of?: number | null
  note?: string | null
  played_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  games: {
    game_number: number
    my_score: number | null
    opp_score: number | null
    win_type: MatchWinType
    is_win: boolean
    is_first?: boolean | null
    win_reason?: string | null
    log?: string | null
  }[]
}

export interface ImportDecksResult {
  imported: number
  missingCards: number
}

/**
 * 导入卡组（生成全新的 ID，保留名称/版本号/备注等元数据）
 */
export async function importDecksFromJson(
  decks: ImportDeckPayload[],
  options: { latestOnly?: boolean; filterMissingCards?: boolean } = {}
): Promise<ImportDecksResult> {
  const db = await getDatabase()
  const timestamp = now()
  const { latestOnly = false, filterMissingCards = true } = options

  let idByPrintId: Set<string> = new Set()
  let idByPrintCode = new Map<string, string>()
  let codeByPrintId = new Map<string, string>()
  if (filterMissingCards) {
    const rows = await db.select<{ id: string; card_no_extend: string; language: string }[]>(
      `SELECT id, card_no_extend, language FROM ${TABLES.CARD_PRINTS}
       ORDER BY (language = 'SC') DESC, print_order ASC`
    )
    idByPrintId = new Set(rows.map((r) => r.id))
    for (const r of rows) {
      codeByPrintId.set(r.id, r.card_no_extend)
      if (r.language !== 'SC' || !r.card_no_extend) continue
      if (!idByPrintCode.has(r.card_no_extend)) {
        idByPrintCode.set(r.card_no_extend, r.id)
      }
    }
  }

  let imported = 0
  let missingCards = 0

  for (const deck of decks) {
    if (!deck.name) continue

    const deckId = Snowflake.generate()
    await db.execute(
      `INSERT INTO ${TABLES.DECKS} (id, name, description, format, cover_image, tags, is_favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deckId,
        deck.name,
        deck.description ?? null,
        deck.format ?? null,
        deck.cover_image ?? null,
        serializeTags(deck.tags),
        deck.is_favorite ? 1 : 0,
        deck.created_at ?? timestamp,
        deck.updated_at ?? timestamp,
      ]
    )

    let versions = deck.versions ?? []
    if (latestOnly && versions.length > 0) {
      const maxVersion = Math.max(...versions.map((v) => v.version_number))
      versions = versions.filter((v) => v.version_number === maxVersion)
    }

    const versionIdByNumber = new Map<number, string>()
    for (const version of versions) {
      const versionId = Snowflake.generate()
      versionIdByNumber.set(version.version_number, versionId)
      await db.execute(
        `INSERT INTO ${TABLES.DECK_VERSIONS} (id, deck_id, version_number, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          versionId,
          deckId,
          version.version_number,
          version.note ?? null,
          version.created_at ?? timestamp,
        ]
      )

      const cards = version.cards ?? []
      for (const card of cards) {
        if (!card.card_id || card.quantity <= 0 || !card.zone) continue

        let resolvedId = card.card_id
        let resolvedCode = card.print_code ?? codeByPrintId.get(card.card_id) ?? null
        if (filterMissingCards) {
          if (!idByPrintId.has(card.card_id)) {
            const byCode = card.print_code ? idByPrintCode.get(card.print_code) : undefined
            if (!byCode) {
              missingCards++
              continue
            }
            resolvedId = byCode
            resolvedCode = card.print_code ?? codeByPrintId.get(byCode) ?? null
          }
        }

        await db.execute(
          `INSERT INTO ${TABLES.DECK_CARDS} (id, deck_version_id, card_id, print_code, quantity, zone, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            Snowflake.generate(),
            versionId,
            resolvedId,
            resolvedCode,
            card.quantity,
            card.zone,
            timestamp,
          ]
        )
      }
    }

    const matches = deck.matches ?? []
    for (const match of matches) {
      const games = (match.games ?? [])
        .filter((g) => g && typeof g.game_number === 'number')
        .map((g) => {
          const rawFirst = g.is_first as boolean | number | null | undefined
          return {
            game_number: g.game_number,
            my_score: g.my_score ?? null,
            opp_score: g.opp_score ?? null,
            win_type: g.win_type ?? 'normal',
            is_win: !!g.is_win,
            is_first:
              rawFirst === true || rawFirst === 1
                ? true
                : rawFirst === false || rawFirst === 0
                  ? false
                  : null,
            win_reason: g.win_reason ?? null,
            log: g.log ?? null,
          }
        })
      if (games.length === 0) continue

      let resolvedVersionId: string | null = null
      let resolvedVersionNumber: number | null = null
      if (match.deck_version_number != null && versionIdByNumber.has(match.deck_version_number)) {
        resolvedVersionId = versionIdByNumber.get(match.deck_version_number) ?? null
        resolvedVersionNumber = match.deck_version_number
      } else if (versionIdByNumber.size > 0) {
        const maxNum = Math.max(...versionIdByNumber.keys())
        resolvedVersionId = versionIdByNumber.get(maxNum) ?? null
        resolvedVersionNumber = maxNum
      }

      await createMatch(
        {
          deck_id: deckId,
          group_name: match.group_name ?? null,
          opponent_name: match.opponent_name ?? null,
          opponent_deck: match.opponent_deck ?? null,
          opp_legend_id: match.opp_legend_id ?? null,
          opp_legend_print_id: match.opp_legend_print_id ?? null,
          opp_legend_name: match.opp_legend_name ?? null,
          opp_legend_image: match.opp_legend_image ?? null,
          deck_version_id: resolvedVersionId,
          deck_version_number: resolvedVersionNumber,
          best_of: match.best_of ?? null,
          note: match.note ?? null,
          played_at: match.played_at ?? null,
        },
        games
      )
    }

    imported++
  }

  return { imported, missingCards }
}

/**
 * 修复卡组中失效的卡牌引用：
 * 本地卡牌数据被清空后重新同步、或远端 Supabase 数据整体换 ID 重建时，
 * deck_cards.card_id 指向的 card_prints.id 可能已不存在。
 * 依据 deck_cards.print_code（card_prints.card_no_extend 的稳定快照）将失效引用
 * 重新指向当前存在的卡图 ID；同一版本同一分区内冲突的引用合并数量。
 * 返回被修复的卡牌引用行数。
 */
export async function repointDeckCardReferences(): Promise<number> {
  const db = await getDatabase()

  const prints = await db.select<
    {
      id: string
      card_no_extend: string | null
      language: string | null
      print_order: number | null
    }[]
  >(
    `SELECT id, card_no_extend, language, print_order FROM ${TABLES.CARD_PRINTS}
     ORDER BY (language = 'SC') DESC, print_order ASC`
  )
  if (prints.length === 0) return 0

  const currentIds = new Set(prints.map((p) => p.id))
  const codeToId = new Map<string, string>()
  for (const p of prints) {
    if (!p.card_no_extend || codeToId.has(p.card_no_extend)) continue
    codeToId.set(p.card_no_extend, p.id)
  }

  const rows = await db.select<
    {
      id: string
      deck_version_id: string
      card_id: string
      print_code: string | null
      quantity: number
      zone: string
    }[]
  >(`SELECT id, deck_version_id, card_id, print_code, quantity, zone FROM ${TABLES.DECK_CARDS}`)

  const groups = new Map<string, typeof rows>()
  let repointed = 0

  for (const row of rows) {
    let targetId = row.card_id
    if (!currentIds.has(row.card_id)) {
      const byCode = row.print_code ? codeToId.get(row.print_code) : undefined
      if (!byCode) continue
      targetId = byCode
      repointed++
    }
    const key = `${row.deck_version_id}|${row.zone}|${targetId}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  for (const [key, list] of groups) {
    if (list.length === 1) {
      const row = list[0]
      if (!currentIds.has(row.card_id)) {
        const targetId = key.slice(key.lastIndexOf('|') + 1)
        await db.execute(`UPDATE ${TABLES.DECK_CARDS} SET card_id = ? WHERE id = ?`, [
          targetId,
          row.id,
        ])
      }
      continue
    }

    const targetId = key.slice(key.lastIndexOf('|') + 1)
    const keeper = list.find((r) => r.card_id === targetId) ?? list[0]
    const sumQuantity = list.reduce((sum, r) => sum + r.quantity, 0)

    await db.execute(`UPDATE ${TABLES.DECK_CARDS} SET card_id = ?, quantity = ? WHERE id = ?`, [
      targetId,
      sumQuantity,
      keeper.id,
    ])
    for (const r of list) {
      if (r.id !== keeper.id) {
        await db.execute(`DELETE FROM ${TABLES.DECK_CARDS} WHERE id = ?`, [r.id])
      }
    }
  }

  return repointed
}
