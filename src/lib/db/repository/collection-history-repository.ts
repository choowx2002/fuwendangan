/**
 * 收藏历史仓储层
 * - 操作日志为粗粒度：一次批量操作 = 1 条头记录 + N 条明细（每受影响卡牌×语言一行）。
 * - 明细保存 before/after 状态，供单级撤销；custom_print_migrate 等复杂迁移仅可查看。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import { addTombstone } from './sync-repository'
import type {
  CollectionHistory,
  CollectionHistoryItem,
  CollectionHistoryItemAction,
  CollectionHistoryOpType,
  CollectionHistoryQuery,
} from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

const now = () => new Date().toISOString()

export interface HistoryItemInput {
  cardNo: string
  cardNoExtend: string
  languageCode: string
  action: CollectionHistoryItemAction
  oldStatus?: string | null
  oldNormalQty?: number | null
  oldFoilQty?: number | null
  newStatus?: string | null
  newNormalQty?: number | null
  newFoilQty?: number | null
}

/** 记录一次可撤销操作：1 条头记录 + 批量明细（单条 SQL 多行插入） */
export async function logCollectionHistory(
  opType: CollectionHistoryOpType,
  source: string,
  items: HistoryItemInput[],
  note?: string | null
): Promise<void> {
  if (items.length === 0) return
  const db = await getDatabase()
  const historyId = Snowflake.generate()
  const t = now()

  await db.execute(
    `INSERT INTO ${TABLES.COLLECTION_HISTORY}
     (id, op_type, source, note, item_count, is_undoable, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [historyId, opType, source, note ?? null, items.length, t]
  )

  const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
  const params: any[] = []
  for (const item of items) {
    params.push(
      Snowflake.generate(),
      historyId,
      item.cardNo,
      item.cardNoExtend,
      item.languageCode,
      item.action,
      item.oldStatus ?? null,
      item.oldNormalQty ?? null,
      item.oldFoilQty ?? null,
      item.newStatus ?? null,
      item.newNormalQty ?? null,
      item.newFoilQty ?? null,
      t
    )
  }
  await db.execute(
    `INSERT INTO ${TABLES.COLLECTION_HISTORY_ITEMS}
     (id, history_id, card_no, card_no_extend, language_code, action,
      old_status, old_normal_qty, old_foil_qty, new_status, new_normal_qty, new_foil_qty, created_at)
     VALUES ${placeholders}`,
    params
  )
}

/** 记录一条仅可查看的头记录（is_undoable=0，如自定义打印迁移），不带明细 */
export async function logCollectionHistoryNote(
  opType: CollectionHistoryOpType,
  source: string,
  note: string,
  itemCount = 0
): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `INSERT INTO ${TABLES.COLLECTION_HISTORY}
     (id, op_type, source, note, item_count, is_undoable, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [Snowflake.generate(), opType, source, note, itemCount, now()]
  )
}

function mapHistoryRow(r: any): CollectionHistory {
  return {
    id: r.id,
    opType: r.op_type as CollectionHistoryOpType,
    source: r.source,
    note: r.note ?? null,
    itemCount: r.item_count,
    isUndoable: !!r.is_undoable,
    createdAt: r.created_at,
  }
}

function mapItemRow(r: any): CollectionHistoryItem {
  return {
    id: r.id,
    historyId: r.history_id,
    cardNo: r.card_no,
    cardNoExtend: r.card_no_extend,
    languageCode: r.language_code,
    action: r.action as CollectionHistoryItemAction,
    oldStatus: r.old_status ?? null,
    oldNormalQty: r.old_normal_qty ?? null,
    oldFoilQty: r.old_foil_qty ?? null,
    newStatus: r.new_status ?? null,
    newNormalQty: r.new_normal_qty ?? null,
    newFoilQty: r.new_foil_qty ?? null,
    cardNameCn: r.card_name_cn ?? null,
    createdAt: r.created_at,
  }
}

/** 分页查询历史（q 按受影响卡牌编号/卡名检索） */
export async function getHistory(
  query: CollectionHistoryQuery = {}
): Promise<{ rows: CollectionHistory[]; total: number }> {
  const db = await getDatabase()
  const conds: string[] = []
  const params: any[] = []
  if (query.opType) {
    conds.push('op_type = ?')
    params.push(query.opType)
  }
  if (query.source) {
    conds.push('source = ?')
    params.push(query.source)
  }
  if (query.q) {
    conds.push(
      `EXISTS (SELECT 1 FROM ${TABLES.COLLECTION_HISTORY_ITEMS} chi
         WHERE chi.history_id = ${TABLES.COLLECTION_HISTORY}.id
           AND (chi.card_no LIKE ? OR chi.card_no_extend LIKE ?))`
    )
    params.push(`%${query.q}%`, `%${query.q}%`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const limit = query.limit ?? 30
  const offset = query.offset ?? 0

  const totalRows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${TABLES.COLLECTION_HISTORY} ${where}`,
    params
  )
  const rows = await db.select<any[]>(
    `SELECT id, op_type, source, note, item_count, is_undoable, created_at
     FROM ${TABLES.COLLECTION_HISTORY} ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )
  return { rows: rows.map(mapHistoryRow), total: totalRows[0]?.n ?? 0 }
}

/** 某条历史操作的明细（联 cards_base 取卡名） */
export async function getHistoryItems(historyId: string): Promise<CollectionHistoryItem[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT chi.id, chi.history_id, chi.card_no, chi.card_no_extend, chi.language_code, chi.action,
       chi.old_status, chi.old_normal_qty, chi.old_foil_qty,
       chi.new_status, chi.new_normal_qty, chi.new_foil_qty, chi.created_at,
       cb.card_name_cn AS card_name_cn
     FROM ${TABLES.COLLECTION_HISTORY_ITEMS} chi
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = chi.card_no
     WHERE chi.history_id = ?
     ORDER BY chi.card_no_extend ASC, chi.language_code ASC`,
    [historyId]
  )
  return rows.map(mapItemRow)
}

/** 撤销单条：before 存在则按旧值回写，before 不存在则删除该语言行 */ export async function undoHistory(
  historyId: string
): Promise<void> {
  const db = await getDatabase()
  const head = await db.select<{ is_undoable: number; note: string | null }[]>(
    `SELECT is_undoable, note FROM ${TABLES.COLLECTION_HISTORY} WHERE id = ?`,
    [historyId]
  )
  if (!head[0]) throw new Error('历史记录不存在')
  if (!head[0].is_undoable) throw new Error('该操作不可撤销')

  const items = await getHistoryItems(historyId)
  for (const item of items) {
    if (item.oldNormalQty != null || item.oldFoilQty != null || item.oldStatus) {
      await restoreLangRow(item)
    } else {
      await removeLangRow(item)
    }
  }

  const note = head[0].note ? `${head[0].note}（已撤销）` : '（已撤销）'
  await db.execute(
    `UPDATE ${TABLES.COLLECTION_HISTORY} SET is_undoable = 0, note = ? WHERE id = ?`,
    [note, historyId]
  )
}

/** 按 old_* 直接回写语言行（不经 upsertLangQty，避免触发其删除/状态规则） */
async function restoreLangRow(item: CollectionHistoryItem): Promise<void> {
  const db = await getDatabase()
  const colRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
    [item.cardNo, item.cardNoExtend]
  )
  let collectionId = colRows[0]?.id
  const t = now()
  if (!collectionId) {
    collectionId = Snowflake.generate()
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION}
       (id, card_no, card_no_extend, last_edited_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [collectionId, item.cardNo, item.cardNoExtend, t, t, t]
    )
  }

  const langRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id = ? AND language_code = ?`,
    [collectionId, item.languageCode]
  )
  if (langRows[0]?.id) {
    await db.execute(
      `UPDATE ${TABLES.COLLECTION_LANGS}
       SET normal_qty = ?, foil_qty = ?, status = ?, updated_at = ? WHERE id = ?`,
      [item.oldNormalQty ?? 0, item.oldFoilQty ?? 0, item.oldStatus ?? 'owned', t, langRows[0].id]
    )
  } else {
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION_LANGS}
       (id, collection_id, language_code, status, normal_qty, foil_qty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Snowflake.generate(),
        collectionId,
        item.languageCode,
        item.oldStatus ?? 'owned',
        item.oldNormalQty ?? 0,
        item.oldFoilQty ?? 0,
        t,
        t,
      ]
    )
  }
  await db.execute(
    `UPDATE ${TABLES.COLLECTION} SET updated_at = ?, last_edited_at = ? WHERE id = ?`,
    [t, t, collectionId]
  )
}

/** 删除某语言行；无剩余语言行时删除卡牌行 */
async function removeLangRow(item: CollectionHistoryItem): Promise<void> {
  const db = await getDatabase()
  const colRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
    [item.cardNo, item.cardNoExtend]
  )
  const collectionId = colRows[0]?.id
  if (!collectionId) return
  await db.execute(
    `DELETE FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id = ? AND language_code = ?`,
    [collectionId, item.languageCode]
  )
  const remain = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id = ?`,
    [collectionId]
  )
  if (remain.length === 0) {
    await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE id = ?`, [collectionId])
    await addTombstone('collection', `${item.cardNo}|${item.cardNoExtend}`)
  } else {
    const t = now()
    await db.execute(
      `UPDATE ${TABLES.COLLECTION} SET updated_at = ?, last_edited_at = ? WHERE id = ?`,
      [t, t, collectionId]
    )
  }
}

/** 按条件清理历史（before 为 ISO 时间，opTypes 为操作类型白名单），返回删除条数 */
export async function clearHistory(opts?: {
  before?: string
  opTypes?: CollectionHistoryOpType[]
}): Promise<number> {
  const db = await getDatabase()
  const conds: string[] = []
  const params: any[] = []
  if (opts?.before) {
    conds.push('created_at < ?')
    params.push(opts.before)
  }
  if (opts?.opTypes?.length) {
    conds.push(`op_type IN (${opts.opTypes.map(() => '?').join(',')})`)
    params.push(...opts.opTypes)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const before = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${TABLES.COLLECTION_HISTORY} ${where}`,
    params
  )
  await db.execute(`DELETE FROM ${TABLES.COLLECTION_HISTORY} ${where}`, params)
  return before[0]?.n ?? 0
}
