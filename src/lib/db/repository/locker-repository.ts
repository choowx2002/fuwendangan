/**
 * 储物柜数据仓储层
 * 储物柜（lockers）→ 抽屉/隔间（locker_sections，无限容器，不设行列）。
 * 抽屉是画布节点：pos_x/pos_y 为柜详情页画布坐标（可空 = 未放置，进托盘），color 为自定义颜色（hex，可空）。
 * 卡牌变体级引用 card_no + card_no_extend + language（与收藏同构），挂在抽屉下。
 * 全部为本地用户数据，snowflake id，不参与内容同步。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type { CardPrint } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

const now = () => new Date().toISOString()

export interface Locker {
  id: string
  name: string
  description: string | null
  is_favorite: number
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
  pos_x: number | null
  pos_y: number | null
  sort_order: number
  created_at: string | null
  updated_at: string | null
  cardCount: number
  totalQty: number
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
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

export async function createLocker(input: {
  name: string
  description?: string | null
}): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  await db.execute(
    `INSERT INTO ${TABLES.LOCKERS} (id, name, description, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
    [id, input.name.trim(), input.description?.trim() || null, t, t]
  )
  return id
}

export async function updateLocker(
  id: string,
  patch: { name?: string; description?: string | null; is_favorite?: number }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    params.push(key === 'name' ? String(value).trim() : value)
  }
  params.push(id)
  await db.execute(`UPDATE ${TABLES.LOCKERS} SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function deleteLocker(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.LOCKERS} WHERE id = ?`, [id])
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
       (SELECT COALESCE(SUM(cc.quantity), 0) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS total_qty
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
      pos_x: r.pos_x != null ? Number(r.pos_x) : null,
      pos_y: r.pos_y != null ? Number(r.pos_y) : null,
      sort_order: r.sort_order ?? 0,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
      cardCount: r.card_count ?? 0,
      totalQty: r.total_qty ?? 0,
      thumbs,
    })
  }
  return sections
}

/** 抽屉节点缩略图：前 3 张卡的打印图 */
async function loadSectionThumbs(sectionId: string): Promise<{ url: string; name: string }[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT cc.card_no, cc.card_no_extend, cc.language FROM ${TABLES.LOCKER_CARDS} cc
     WHERE cc.section_id = ? ORDER BY cc.created_at ASC LIMIT 3`,
    [sectionId]
  )
  const thumbs: { url: string; name: string }[] = []
  for (const r of rows) {
    const print = await loadPrint(r.card_no, r.card_no_extend ?? null, r.language ?? null)
    if (print?.img_cdn || print?.tts_cdn) {
      thumbs.push({ url: print.img_cdn ?? print.tts_cdn ?? '', name: `${r.card_no_extend ?? r.card_no}-${r.language ?? 'default'}` })
    }
  }
  return thumbs
}

export async function getSection(sectionId: string): Promise<LockerSection | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS card_count,
       (SELECT COALESCE(SUM(cc.quantity), 0) FROM ${TABLES.LOCKER_CARDS} cc WHERE cc.section_id = s.id) AS total_qty
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
    pos_x: r.pos_x != null ? Number(r.pos_x) : null,
    pos_y: r.pos_y != null ? Number(r.pos_y) : null,
    sort_order: r.sort_order ?? 0,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    cardCount: r.card_count ?? 0,
    totalQty: r.total_qty ?? 0,
    thumbs: await loadSectionThumbs(r.id),
  }
}

export async function createSection(
  lockerId: string,
  input: { name?: string; description?: string; color?: string | null }
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
     (id, locker_id, name, description, color, pos_x, pos_y, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    [
      id,
      lockerId,
      input.name?.trim() || null,
      input.description?.trim() || null,
      input.color || null,
      orderRows[0]?.n ?? 0,
      t,
      t,
    ]
  )
  return id
}

export async function updateSection(
  id: string,
  patch: { name?: string | null; description?: string | null; color?: string | null }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    params.push(typeof value === 'string' ? value.trim() || null : value)
  }
  params.push(id)
  await db.execute(`UPDATE ${TABLES.LOCKER_SECTIONS} SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function deleteSection(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.LOCKER_SECTIONS} WHERE id = ?`, [id])
}

/** 画布：持久化抽屉节点位置（调用方传入已吸附坐标） */
export async function updateSectionPosition(id: string, x: number, y: number): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `UPDATE ${TABLES.LOCKER_SECTIONS} SET pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ?`,
    [x, y, now(), id]
  )
}

/** 画布：清除抽屉节点位置（拖回托盘） */
export async function clearSectionPosition(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `UPDATE ${TABLES.LOCKER_SECTIONS} SET pos_x = NULL, pos_y = NULL, updated_at = ? WHERE id = ?`,
    [now(), id]
  )
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

export async function getSectionCards(sectionId: string): Promise<LockerCard[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT * FROM ${TABLES.LOCKER_CARDS} WHERE section_id = ? ORDER BY created_at ASC`,
    [sectionId]
  )
  const ownedMap = await loadOwnedTotals(rows.map((r) => r.card_no))
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
    [
      sectionId,
      input.card_no,
      input.card_no_extend || null,
      input.language || null,
    ]
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
