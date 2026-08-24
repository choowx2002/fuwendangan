/**
 * 储物柜数据仓储层
 * 储物柜（lockers）→ 抽屉/隔间（locker_sections，无限容器，按 sort_order 排序）。
 * color 为抽屉自定义颜色（hex，可空），icon 为抽屉图标静态路径（可空，空则显示默认 favicon）。
 * 卡牌变体级引用 card_no + card_no_extend + language（与收藏同构），挂在抽屉下。
 * 全部为本地用户数据，snowflake id，不参与内容同步。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type { CardPrint } from '../types'
import { parseTags, serializeTags } from '../helper'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { addTombstone } from './sync-repository'

const now = () => new Date().toISOString()

export interface Locker {
  id: string
  name: string
  description: string | null
  is_favorite: number
  icon: string | null
  tags: string[]
  created_at: string | null
  updated_at: string | null
}

export interface LockerSummary extends Locker {
  sectionCount: number
  cardCount: number
}

export interface LockerSection {
  id: string
  locker_id: string
  name: string | null
  description: string | null
  color: string | null
  icon: string | null
  tags: string[]
  sort_order: number
  created_at: string | null
  updated_at: string | null
  cardCount: number
  totalQty: number
  /** 格内变体引用已不在 card_prints 的卡牌数（内容库删除/变更后的悬挂引用） */
  issueCount: number
  thumbs: { url: string; name: string }[]
}

export interface LockerCard {
  id: string
  section_id: string
  card_no: string
  card_no_extend: string | null
  language: string | null
  quantity: number
  note: string | null
  created_at: string | null
  updated_at: string | null
  card_name: string | null
  print: CardPrint | null
  ownedTotal: number
  /** (card_no, card_no_extend) 已不在 card_prints 中：内容库删除/变更后的悬挂引用 */
  variantMissing: boolean
}

export interface CardLocation {
  lockerId: string
  lockerName: string
  sectionId: string
  sectionName: string | null
  quantity: number
}

export interface LockerDetail {
  locker: Locker
  sections: LockerSection[]
}

/** 储物柜清单导出行：一个卡牌变体，放置信息可回填（一个变体可能在多个抽屉，每抽屉一行） */
export interface LockerExportVariant {
  card_no: string
  card_no_extend: string
  card_name_cn: string | null
  language: string
  owned_total: number
  locker_name: string | null
  section_name: string | null
  quantity: number | null
  note: string | null
}

// ==================== 储物柜 ====================

export async function getLockers(): Promise<LockerSummary[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT l.*,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_SECTIONS} s WHERE s.locker_id = l.id) AS section_count,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc
         JOIN ${TABLES.LOCKER_SECTIONS} s ON s.id = cc.section_id
         WHERE s.locker_id = l.id) AS card_count
     FROM ${TABLES.LOCKERS} l
     ORDER BY l.is_favorite DESC, l.created_at DESC`
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    is_favorite: r.is_favorite ?? 0,
    icon: r.icon ?? null,
    tags: parseTags(r.tags),
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    sectionCount: r.section_count ?? 0,
    cardCount: r.card_count ?? 0,
  }))
}

export async function getLocker(id: string): Promise<Locker | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(`SELECT * FROM ${TABLES.LOCKERS} WHERE id = ?`, [id])
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    is_favorite: r.is_favorite ?? 0,
    icon: r.icon ?? null,
    tags: parseTags(r.tags),
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

export async function createLocker(input: {
  name: string
  description?: string | null
  icon?: string | null
  tags?: string[]
}): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  await db.execute(
    `INSERT INTO ${TABLES.LOCKERS} (id, name, description, is_favorite, icon, tags, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      input.name.trim(),
      input.description?.trim() || null,
      input.icon?.trim() || null,
      serializeTags(input.tags),
      t,
      t,
    ]
  )
  return id
}

export async function updateLocker(
  id: string,
  patch: {
    name?: string
    description?: string | null
    is_favorite?: number
    icon?: string | null
    tags?: string[]
  }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    params.push(
      key === 'name' || key === 'icon'
        ? String(value).trim()
        : key === 'tags'
          ? serializeTags(value as string[])
          : value
    )
  }
  params.push(id)
  await db.execute(`UPDATE ${TABLES.LOCKERS} SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function deleteLocker(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.LOCKERS} WHERE id = ?`, [id])
  await addTombstone('locker', id)
}

// ==================== 抽屉/隔间（Section） ====================

/**
 * 获取柜下所有抽屉（画布节点富化：卡数、总数量、前 3 张卡缩略图）
 */
export async function getSections(lockerId: string): Promise<LockerSection[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS card_count,
       (SELECT COALESCE(SUM(cc.quantity), 0) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS total_qty,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id
          AND NOT EXISTS (
            SELECT 1 FROM ${TABLES.CARD_PRINTS} p
            WHERE p.card_no = cc.card_no AND p.card_no_extend = cc.card_no_extend
          )) AS issue_count
     FROM ${TABLES.LOCKER_SECTIONS} s
     WHERE s.locker_id = ? ORDER BY s.sort_order ASC, s.created_at ASC`,
    [lockerId]
  )
  const sections: LockerSection[] = []
  for (const r of rows) {
    const thumbs = await loadSectionThumbs(r.id)
    sections.push({
      id: r.id,
      locker_id: r.locker_id,
      name: r.name ?? null,
      description: r.description ?? null,
      color: r.color ?? null,
      icon: r.icon ?? null,
      tags: parseTags(r.tags),
      sort_order: r.sort_order ?? 0,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
      cardCount: r.card_count ?? 0,
      totalQty: r.total_qty ?? 0,
      issueCount: r.issue_count ?? 0,
      thumbs,
    })
  }
  return sections
}

/** 抽屉节点缩略图：前 3 张去重后的打印图（不同卡牌可能经兜底解析到同一印刷，URL 必须去重） */
async function loadSectionThumbs(sectionId: string): Promise<{ url: string; name: string }[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT cc.card_no, cc.card_no_extend, cc.language FROM ${TABLES.LOCKER_CARDS} cc
     WHERE cc.section_id = ? ORDER BY cc.created_at ASC`,
    [sectionId]
  )
  const thumbs: { url: string; name: string }[] = []
  const seenUrls = new Set<string>()
  for (const r of rows) {
    if (thumbs.length >= 3) break
    const print = await loadPrint(r.card_no, r.card_no_extend ?? null, r.language ?? null)
    if (!print?.img_cdn && !print?.tts_cdn) continue
    const url = print.img_cdn ?? print.tts_cdn ?? ''
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    thumbs.push({
      url,
      name: `${r.card_no_extend ?? r.card_no}-${r.language ?? 'default'}`,
    })
  }
  return thumbs
}

export async function getSection(sectionId: string): Promise<LockerSection | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS card_count,
       (SELECT COALESCE(SUM(cc.quantity), 0) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS total_qty,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id
          AND NOT EXISTS (
            SELECT 1 FROM ${TABLES.CARD_PRINTS} p
            WHERE p.card_no = cc.card_no AND p.card_no_extend = cc.card_no_extend
          )) AS issue_count
     FROM ${TABLES.LOCKER_SECTIONS} s WHERE s.id = ?`,
    [sectionId]
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    locker_id: r.locker_id,
    name: r.name ?? null,
    description: r.description ?? null,
    color: r.color ?? null,
    icon: r.icon ?? null,
    tags: parseTags(r.tags),
    sort_order: r.sort_order ?? 0,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    cardCount: r.card_count ?? 0,
    totalQty: r.total_qty ?? 0,
    issueCount: r.issue_count ?? 0,
    thumbs: await loadSectionThumbs(r.id),
  }
}

export async function createSection(
  lockerId: string,
  input: {
    name?: string
    description?: string
    color?: string | null
    icon?: string | null
    tags?: string[]
  }
): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  const orderRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${TABLES.LOCKER_SECTIONS} WHERE locker_id = ?`,
    [lockerId]
  )
  await db.execute(
    `INSERT INTO ${TABLES.LOCKER_SECTIONS}
     (id, locker_id, name, description, color, icon, tags, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      lockerId,
      input.name?.trim() || null,
      input.description?.trim() || null,
      input.color || null,
      input.icon?.trim() || null,
      serializeTags(input.tags),
      orderRows[0]?.n ?? 0,
      t,
      t,
    ]
  )
  return id
}

export async function updateSection(
  id: string,
  patch: {
    name?: string | null
    description?: string | null
    color?: string | null
    icon?: string | null
    tags?: string[]
  }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    params.push(
      typeof value === 'string'
        ? value.trim() || null
        : key === 'tags'
          ? serializeTags(value)
          : value
    )
  }
  params.push(id)
  await db.execute(`UPDATE ${TABLES.LOCKER_SECTIONS} SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function deleteSection(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.LOCKER_SECTIONS} WHERE id = ?`, [id])
}

// ==================== 格内卡牌 ====================

async function loadCardName(cardNo: string): Promise<string | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT card_name_cn, card_name_en FROM ${TABLES.CARDS_BASE} WHERE card_no = ? LIMIT 1`,
    [cardNo]
  )
  const r = rows[0]
  if (!r) return null
  return r.card_name_cn || r.card_name_en || cardNo
}

async function loadPrint(
  cardNo: string,
  cardNoExtend: string | null,
  language: string | null
): Promise<CardPrint | null> {
  const db = await getDatabase()
  if (cardNoExtend && language) {
    const rows = await db.select<any[]>(
      `SELECT * FROM ${TABLES.CARD_PRINTS}
       WHERE card_no = ? AND card_no_extend = ? AND language = ?
       ORDER BY is_custom ASC, print_order ASC LIMIT 1`,
      [cardNo, cardNoExtend, language]
    )
    if (rows[0]) return rows[0] as CardPrint
  }
  const rows = await db.select<any[]>(
    `SELECT * FROM ${TABLES.CARD_PRINTS}
     WHERE card_no = ? AND card_no_extend = ? ORDER BY is_custom ASC, print_order ASC LIMIT 1`,
    [cardNo, cardNoExtend ?? '']
  )
  if (rows[0]) return rows[0] as CardPrint
  const fallback = await db.select<any[]>(
    `SELECT * FROM ${TABLES.CARD_PRINTS}
     WHERE card_no = ? ORDER BY is_custom ASC, print_order ASC LIMIT 1`,
    [cardNo]
  )
  return fallback[0] ? (fallback[0] as CardPrint) : null
}

/** 批量查询收藏拥有量：card_no → 拥有总数（所有语言普卡+闪卡） */
async function loadOwnedTotals(cardNos: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const unique = [...new Set(cardNos.filter(Boolean))]
  if (unique.length === 0) return map
  const db = await getDatabase()
  const placeholders = unique.map(() => '?').join(', ')
  const rows = await db.select<any[]>(
    `SELECT c.card_no AS card_no,
       SUM(COALESCE(cl.normal_qty, 0) + COALESCE(cl.foil_qty, 0)) AS owned
     FROM ${TABLES.COLLECTION_LANGS} cl
     JOIN ${TABLES.COLLECTION} c ON c.id = cl.collection_id
     WHERE c.card_no IN (${placeholders})
     GROUP BY c.card_no`,
    unique
  )
  for (const r of rows) map.set(r.card_no, r.owned ?? 0)
  return map
}

/** 批量查询现存变体：`card_no|card_no_extend` 集合（判定悬挂引用） */
async function loadExistingVariants(cardNos: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  const unique = [...new Set(cardNos.filter(Boolean))]
  if (unique.length === 0) return set
  const db = await getDatabase()
  const placeholders = unique.map(() => '?').join(', ')
  const rows = await db.select<any[]>(
    `SELECT DISTINCT card_no, card_no_extend FROM ${TABLES.CARD_PRINTS}
     WHERE card_no IN (${placeholders})`,
    unique
  )
  for (const r of rows) set.add(`${r.card_no}|${r.card_no_extend ?? ''}`)
  return set
}

export async function getSectionCards(sectionId: string): Promise<LockerCard[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT * FROM ${TABLES.LOCKER_CARDS} WHERE section_id = ? ORDER BY created_at ASC`,
    [sectionId]
  )
  const ownedMap = await loadOwnedTotals(rows.map((r) => r.card_no))
  const variantSet = await loadExistingVariants(rows.map((r) => r.card_no))
  const cards: LockerCard[] = []
  for (const r of rows) {
    cards.push({
      id: r.id,
      section_id: r.section_id,
      card_no: r.card_no,
      card_no_extend: r.card_no_extend ?? null,
      language: r.language ?? null,
      quantity: r.quantity ?? 1,
      note: r.note ?? null,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
      card_name: await loadCardName(r.card_no),
      print: await loadPrint(r.card_no, r.card_no_extend ?? null, r.language ?? null),
      ownedTotal: ownedMap.get(r.card_no) ?? 0,
      variantMissing: !variantSet.has(`${r.card_no}|${r.card_no_extend ?? ''}`),
    })
  }
  return cards
}

/**
 * 添加卡牌到抽屉：同一抽屉内相同 (card_no, card_no_extend, language) 合并数量。
 * 返回该卡牌记录 id。
 */
export async function addSectionCard(
  sectionId: string,
  input: {
    card_no: string
    card_no_extend?: string | null
    language?: string | null
    quantity?: number
    note?: string | null
  }
): Promise<string> {
  const db = await getDatabase()
  const t = now()
  const qty = Math.max(1, input.quantity ?? 1)

  const existing = await db.select<any[]>(
    `SELECT id, quantity FROM ${TABLES.LOCKER_CARDS}
     WHERE section_id = ? AND card_no = ? AND card_no_extend IS ? AND language IS ?
     LIMIT 1`,
    [sectionId, input.card_no, input.card_no_extend || null, input.language || null]
  )
  if (existing[0]) {
    await db.execute(
      `UPDATE ${TABLES.LOCKER_CARDS} SET quantity = quantity + ?, updated_at = ? WHERE id = ?`,
      [qty, t, existing[0].id]
    )
    return existing[0].id
  }

  const id = Snowflake.generate()
  await db.execute(
    `INSERT INTO ${TABLES.LOCKER_CARDS}
     (id, section_id, card_no, card_no_extend, language, quantity, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sectionId,
      input.card_no,
      input.card_no_extend || null,
      input.language || null,
      qty,
      input.note || null,
      t,
      t,
    ]
  )
  return id
}

/** 批量添加卡牌到抽屉（同变体合并数量，单次调用内串行写入，避免 UI 层 N 次往返） */
export async function addSectionCardsBatch(
  sectionId: string,
  entries: {
    card_no: string
    card_no_extend?: string | null
    language?: string | null
    quantity?: number
  }[]
): Promise<void> {
  for (const input of entries) {
    await addSectionCard(sectionId, input)
  }
}

export async function updateSectionCard(
  id: string,
  patch: { quantity?: number; note?: string | null }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    params.push(key === 'quantity' ? Math.max(1, Number(value)) : value)
  }
  params.push(id)
  await db.execute(`UPDATE ${TABLES.LOCKER_CARDS} SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function removeSectionCard(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.LOCKER_CARDS} WHERE id = ?`, [id])
}

/** 批量移除抽屉内卡牌记录（单次调用内串行删除） */
export async function removeSectionCardsBatch(sectionId: string, ids: string[]): Promise<void> {
  const db = await getDatabase()
  for (const id of ids) {
    await db.execute(`DELETE FROM ${TABLES.LOCKER_CARDS} WHERE id = ? AND section_id = ?`, [
      id,
      sectionId,
    ])
  }
}

/**
 * 全部抽屉的变体数量汇总（全局上限判定用）：
 * key = `${card_no}:${card_no_extend ?? ''}:${language ?? ''}` → 所有抽屉合计数量
 */
export async function getGlobalSectionCardQtys(): Promise<Map<string, number>> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT card_no, card_no_extend, language, SUM(quantity) AS qty
     FROM ${TABLES.LOCKER_CARDS}
     GROUP BY card_no, card_no_extend, language`
  )
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(`${r.card_no}:${r.card_no_extend ?? ''}:${r.language ?? ''}`, r.qty ?? 0)
  }
  return map
}

// ==================== 聚合查询 ====================

export async function getLockerDetail(lockerId: string): Promise<LockerDetail | null> {
  const locker = await getLocker(lockerId)
  if (!locker) return null
  const sections = await getSections(lockerId)
  return { locker, sections }
}

/**
 * 找卡：查询一张卡（可按变体过滤）存放的所有位置
 */
export async function findCardLocations(
  cardNo: string,
  cardNoExtend?: string
): Promise<CardLocation[]> {
  const db = await getDatabase()
  const params: any[] = [cardNo]
  let extendFilter = ''
  if (cardNoExtend) {
    extendFilter = ` AND cc.card_no_extend = ?`
    params.push(cardNoExtend)
  }
  const rows = await db.select<any[]>(
    `SELECT cc.quantity,
       s.id AS section_id, s.name AS section_name,
       l.id AS locker_id, l.name AS locker_name
     FROM ${TABLES.LOCKER_CARDS} cc
     JOIN ${TABLES.LOCKER_SECTIONS} s ON s.id = cc.section_id
     JOIN ${TABLES.LOCKERS} l ON l.id = s.locker_id
     WHERE cc.card_no = ?${extendFilter}
     ORDER BY l.name ASC, s.sort_order ASC, cc.created_at ASC`,
    params
  )
  return rows.map((r) => ({
    lockerId: r.locker_id,
    lockerName: r.locker_name,
    sectionId: r.section_id,
    sectionName: r.section_name ?? null,
    quantity: r.quantity ?? 1,
  }))
}

// ==================== 清单导入导出 ====================

/** 按名称精确查找储物柜（trim 后匹配） */
export async function getLockerByName(name: string): Promise<Locker | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(`SELECT * FROM ${TABLES.LOCKERS} WHERE name = ? LIMIT 1`, [
    name.trim(),
  ])
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    is_favorite: r.is_favorite ?? 0,
    icon: r.icon ?? null,
    tags: parseTags(r.tags),
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

/** 按名称精确查找柜内抽屉（trim 后匹配） */
export async function getSectionByName(
  lockerId: string,
  name: string
): Promise<LockerSection | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS card_count,
       (SELECT COALESCE(SUM(cc.quantity), 0) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS total_qty,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id
          AND NOT EXISTS (
            SELECT 1 FROM ${TABLES.CARD_PRINTS} p
            WHERE p.card_no = cc.card_no AND p.card_no_extend = cc.card_no_extend
          )) AS issue_count
     FROM ${TABLES.LOCKER_SECTIONS} s
     WHERE s.locker_id = ? AND s.name = ? LIMIT 1`,
    [lockerId, name.trim()]
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    locker_id: r.locker_id,
    name: r.name ?? null,
    description: r.description ?? null,
    color: r.color ?? null,
    icon: r.icon ?? null,
    tags: parseTags(r.tags),
    sort_order: r.sort_order ?? 0,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    cardCount: r.card_count ?? 0,
    totalQty: r.total_qty ?? 0,
    issueCount: r.issue_count ?? 0,
    thumbs: [],
  }
}

/**
 * 覆盖写入抽屉内卡牌：存在相同 (card_no, card_no_extend, language) 记录时覆盖数量与备注，
 * 不存在则插入。区别于 addSectionCard 的累加语义（清单导入用）。
 */
export async function upsertSectionCard(
  sectionId: string,
  input: {
    card_no: string
    card_no_extend?: string | null
    language?: string | null
    quantity: number
    note?: string | null
  }
): Promise<string> {
  const db = await getDatabase()
  const t = now()
  const qty = Math.max(1, Math.floor(Number(input.quantity) || 1))

  const existing = await db.select<any[]>(
    `SELECT id FROM ${TABLES.LOCKER_CARDS}
     WHERE section_id = ? AND card_no = ? AND card_no_extend IS ? AND language IS ?
     LIMIT 1`,
    [sectionId, input.card_no, input.card_no_extend || null, input.language || null]
  )
  if (existing[0]) {
    const sets: string[] = ['quantity = ?', 'updated_at = ?']
    const params: any[] = [qty, t]
    if (input.note !== undefined) {
      sets.push('note = ?')
      params.push(input.note?.trim() || null)
    }
    params.push(existing[0].id)
    await db.execute(`UPDATE ${TABLES.LOCKER_CARDS} SET ${sets.join(', ')} WHERE id = ?`, params)
    return existing[0].id
  }

  const id = Snowflake.generate()
  await db.execute(
    `INSERT INTO ${TABLES.LOCKER_CARDS}
     (id, section_id, card_no, card_no_extend, language, quantity, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sectionId,
      input.card_no,
      input.card_no_extend || null,
      input.language || null,
      qty,
      input.note?.trim() || null,
      t,
      t,
    ]
  )
  return id
}

/**
 * 储物柜清单导出数据：以收藏（已拥有变体）为数据源。
 * - 已收录变体：按实际抽屉记录导出一行（语言/数量/备注回填，多抽屉则每抽屉一行）；
 * - 未收录变体：导出一行（语言为代表印刷语言，放置列为空）。
 * @param opts.onlyUnplaced 仅导出未收录进任何抽屉的变体
 */
export async function getLockerExportVariants(opts?: {
  onlyUnplaced?: boolean
}): Promise<LockerExportVariant[]> {
  const db = await getDatabase()

  // 1. 已拥有变体（收藏行 × 拥有数量），排除非自建 promo（与抽屉卡池口径一致）。
  // 用 EXISTS 过滤 promo，避免 card_prints 多语言印刷行与 collection_langs 交叉造成求和翻倍。
  const ownedRows = await db.select<any[]>(
    `SELECT col.card_no AS card_no, col.card_no_extend AS card_no_extend,
       cb.card_name_cn AS card_name_cn,
       SUM(COALESCE(cl.normal_qty, 0) + COALESCE(cl.foil_qty, 0)) AS owned_total
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = col.card_no
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE cl.status = 'owned'
       AND EXISTS (
         SELECT 1 FROM ${TABLES.CARD_PRINTS} p
         WHERE p.card_id = cb.id AND p.card_no_extend = col.card_no_extend
           AND (COALESCE(p.is_promo, 0) != 1 OR p.is_custom = 1)
       )
     GROUP BY col.card_no, col.card_no_extend`,
    []
  )

  // 2. 抽屉内已收录记录（含柜名/抽屉名）
  const placementRows = await db.select<any[]>(
    `SELECT cc.card_no AS card_no, cc.card_no_extend AS card_no_extend,
       cc.language AS language, cc.quantity AS quantity, cc.note AS note,
       l.name AS locker_name, s.name AS section_name
     FROM ${TABLES.LOCKER_CARDS} cc
     JOIN ${TABLES.LOCKER_SECTIONS} s ON s.id = cc.section_id
     JOIN ${TABLES.LOCKERS} l ON l.id = s.locker_id`
  )
  const placementMap = new Map<string, typeof placementRows>()
  for (const r of placementRows) {
    const key = `${r.card_no}|${r.card_no_extend}`
    if (!placementMap.has(key)) placementMap.set(key, [])
    placementMap.get(key)!.push(r)
  }

  // 3. 未收录变体的代表印刷语言（SC 优先 → is_default → 首张，与 VariantPool 口径一致）
  const unplacedKeys = ownedRows.filter(
    (r) => !placementMap.has(`${r.card_no}|${r.card_no_extend}`)
  )
  const repLangMap = new Map<string, string | null>()
  if (unplacedKeys.length > 0) {
    const conds = unplacedKeys.map(() => '(p.card_no = ? AND p.card_no_extend = ?)').join(' OR ')
    const params: any[] = []
    for (const r of unplacedKeys) params.push(r.card_no, r.card_no_extend)
    const printRows = await db.select<any[]>(
      `SELECT p.card_no AS card_no, p.card_no_extend AS card_no_extend,
         p.language AS language, p.is_default AS is_default
       FROM ${TABLES.CARD_PRINTS} p
       WHERE ${conds}
       ORDER BY p.card_no ASC, p.card_no_extend ASC, p.print_order ASC`,
      params
    )
    const byKey = new Map<string, any[]>()
    for (const pr of printRows) {
      const key = `${pr.card_no}|${pr.card_no_extend}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push(pr)
    }
    for (const r of unplacedKeys) {
      const key = `${r.card_no}|${r.card_no_extend}`
      const pool = byKey.get(key) ?? []
      const rep =
        pool.find((p) => (p.language ?? '').toLowerCase() === 'sc') ??
        pool.find((p) => p.is_default) ??
        pool[0]
      repLangMap.set(key, rep?.language ?? null)
    }
  }

  // 4. 组装导出数据
  const variants: LockerExportVariant[] = []
  for (const r of ownedRows) {
    const key = `${r.card_no}|${r.card_no_extend}`
    const placements = placementMap.get(key) ?? []
    if (opts?.onlyUnplaced && placements.length > 0) continue
    if (placements.length > 0) {
      for (const p of placements) {
        variants.push({
          card_no: r.card_no,
          card_no_extend: r.card_no_extend,
          card_name_cn: r.card_name_cn ?? null,
          language: p.language ?? '',
          owned_total: r.owned_total ?? 0,
          locker_name: p.locker_name ?? null,
          section_name: p.section_name ?? null,
          quantity: p.quantity ?? 1,
          note: p.note ?? null,
        })
      }
    } else {
      variants.push({
        card_no: r.card_no,
        card_no_extend: r.card_no_extend,
        card_name_cn: r.card_name_cn ?? null,
        language: repLangMap.get(key) ?? '',
        owned_total: r.owned_total ?? 0,
        locker_name: null,
        section_name: null,
        quantity: null,
        note: null,
      })
    }
  }
  return variants
}
