/**
 * 购买清单仓储层
 * 清单头（purchase_lists）独立成表，与 collection_langs 解耦；
 * 条目保存 card_no / card_no_extend 快照 + 数量快照（qty_owned），库存变化不改写历史清单。
 * 生成流程：卡组缺卡检查（checkDeckOwnership）→ 建清单头 → 按条目 upsert（同一清单同卡去重）。
 * match_mode：'print' 按印刷号逐行比较；'card' 按卡牌合并（同 cards_base.card_no 的不同印刷视为同卡，
 * 条目以 card_no_extend='' 作「任意版本」锚点，每卡一行）。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type {
  OwnershipCheckRow,
  OwnershipMatchMode,
  PurchaseList,
  PurchaseListItem,
  PurchaseListItemStatus,
  PurchaseListStatus,
  WishlistFinish,
} from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { checkDeckOwnership } from './collection-repository'
import { getLatestDeckCards } from './deck-repository'

const now = () => new Date().toISOString()

function mapPurchaseListRow(r: any): PurchaseList {
  return {
    id: r.id,
    name: r.name,
    deck_id: r.deck_id ?? null,
    deck_version_id: r.deck_version_id ?? null,
    match_mode: (r.match_mode ?? 'print') as OwnershipMatchMode,
    status: r.status as PurchaseListStatus,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

function mapPurchaseListItemRow(r: any): PurchaseListItem {
  return {
    id: r.id,
    list_id: r.list_id,
    card_no: r.card_no,
    card_no_extend: r.card_no_extend,
    collection_id: r.collection_id ?? null,
    language_pref: r.language_pref ?? '*',
    finish_pref: (r.finish_pref ?? 'any') as WishlistFinish,
    qty_required: r.qty_required ?? 0,
    qty_owned: r.qty_owned ?? 0,
    qty_to_buy: r.qty_to_buy ?? 0,
    status: r.status as PurchaseListItemStatus,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

// ==================== 清单头 ====================

export interface CreatePurchaseListInput {
  name: string
  deckId?: string | null
  deckVersionId?: string | null
  matchMode?: OwnershipMatchMode
}

/** 创建购买清单，返回 id */
export async function createPurchaseList(input: CreatePurchaseListInput): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  await db.execute(
    `INSERT INTO ${TABLES.PURCHASE_LISTS}
     (id, name, deck_id, deck_version_id, match_mode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    [
      id,
      input.name.trim(),
      input.deckId ?? null,
      input.deckVersionId ?? null,
      input.matchMode ?? 'print',
      t,
      t,
    ]
  )
  return id
}

/** 购买清单列表（可选状态过滤，按更新时间倒序） */
export async function getPurchaseLists(filter?: {
  status?: PurchaseListStatus
}): Promise<PurchaseList[]> {
  const db = await getDatabase()
  const conds: string[] = []
  const params: any[] = []
  if (filter?.status) {
    conds.push('status = ?')
    params.push(filter.status)
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
  const rows = await db.select<any[]>(
    `SELECT id, name, deck_id, deck_version_id, match_mode, status, created_at, updated_at
     FROM ${TABLES.PURCHASE_LISTS} ${where}
     ORDER BY updated_at DESC`,
    params
  )
  return rows.map(mapPurchaseListRow)
}

/** 单个购买清单 */
export async function getPurchaseList(id: string): Promise<PurchaseList | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT id, name, deck_id, deck_version_id, match_mode, status, created_at, updated_at
     FROM ${TABLES.PURCHASE_LISTS} WHERE id = ?`,
    [id]
  )
  return rows[0] ? mapPurchaseListRow(rows[0]) : null
}

/** 更新清单状态（open / completed / archived） */
export async function updatePurchaseListStatus(
  id: string,
  status: PurchaseListStatus
): Promise<void> {
  const db = await getDatabase()
  await db.execute(`UPDATE ${TABLES.PURCHASE_LISTS} SET status = ?, updated_at = ? WHERE id = ?`, [
    status,
    now(),
    id,
  ])
}

/** 删除购买清单（条目级联删除） */
export async function deletePurchaseList(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.PURCHASE_LISTS} WHERE id = ?`, [id])
}

// ==================== 清单条目 ====================

/** 清单条目列表（join cards_base 取卡名，卡被删除时为 NULL；card_no_extend='' 表示任意版本） */
export async function getPurchaseListItems(listId: string): Promise<
  (PurchaseListItem & {
    card_name_cn: string | null
    img_cdn: string | null
    img_lang: string | null
  })[]
> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT i.id, i.list_id, i.card_no, i.card_no_extend, i.collection_id,
       i.language_pref, i.finish_pref, i.qty_required, i.qty_owned, i.qty_to_buy,
       i.status, i.created_at, i.updated_at,
       cb.card_name_cn AS card_name_cn, rep.img_cdn AS img_cdn, rep.language AS img_lang
     FROM ${TABLES.PURCHASE_LIST_ITEMS} i
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = i.card_no
     LEFT JOIN (
       SELECT card_id, card_no_extend, img_cdn, language,
         ROW_NUMBER() OVER (
           PARTITION BY card_id, card_no_extend
           ORDER BY CASE WHEN COALESCE(is_promo, 0) = 1 THEN 1 ELSE 0 END,
                    CASE WHEN language = 'SC' THEN 0 WHEN COALESCE(is_default, 0) = 1 THEN 1 ELSE 2 END,
                    COALESCE(print_order, 0)
         ) AS rn,
         ROW_NUMBER() OVER (
           PARTITION BY card_id
           ORDER BY CASE WHEN COALESCE(is_promo, 0) = 1 THEN 1 ELSE 0 END,
                    CASE WHEN language = 'SC' THEN 0 WHEN COALESCE(is_default, 0) = 1 THEN 1 ELSE 2 END,
                    COALESCE(print_order, 0)
         ) AS rn_card
       FROM ${TABLES.CARD_PRINTS}
     ) rep ON rep.card_id = cb.id
       AND ((rep.card_no_extend = i.card_no_extend AND rep.rn = 1)
            OR (i.card_no_extend = '' AND rep.rn_card = 1))
     WHERE i.list_id = ?
     ORDER BY i.qty_to_buy DESC, i.card_no COLLATE NOCASE`,
    [listId]
  )
  return rows.map((r) => ({
    ...mapPurchaseListItemRow(r),
    card_name_cn: r.card_name_cn ?? null,
    img_cdn: r.img_cdn ?? null,
    img_lang: r.img_lang ?? null,
  }))
}

export interface PurchaseListItemInput {
  cardNo: string
  cardNoExtend: string
  collectionId?: string | null
  languagePref?: string
  finishPref?: WishlistFinish
  qtyRequired: number
  qtyOwned: number
  qtyToBuy: number
  status?: PurchaseListItemStatus
}

/**
 * 新增/更新清单条目：按 (list_id, card_no, card_no_extend, language_pref, finish_pref)
 * 唯一键 upsert，重复时刷新数量；已标记 bought 的条目不被重置为 pending。
 */
export async function upsertPurchaseListItem(
  listId: string,
  input: PurchaseListItemInput
): Promise<void> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  const languagePref = input.languagePref ?? '*'
  const finishPref = input.finishPref ?? 'any'
  const status = input.status ?? 'pending'

  await db.execute(
    `INSERT INTO ${TABLES.PURCHASE_LIST_ITEMS}
     (id, list_id, card_no, card_no_extend, collection_id,
      language_pref, finish_pref, qty_required, qty_owned, qty_to_buy,
      status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(list_id, card_no, card_no_extend, language_pref, finish_pref) DO UPDATE SET
       qty_required = excluded.qty_required,
       qty_owned = excluded.qty_owned,
       qty_to_buy = excluded.qty_to_buy,
       status = CASE WHEN purchase_list_items.status = 'bought' THEN 'bought' ELSE excluded.status END,
       updated_at = excluded.updated_at`,
    [
      id,
      listId,
      input.cardNo,
      input.cardNoExtend,
      input.collectionId ?? null,
      languagePref,
      finishPref,
      input.qtyRequired,
      input.qtyOwned,
      input.qtyToBuy,
      status,
      t,
      t,
    ]
  )
}

/** 更新条目状态（pending / ordered / bought / skipped） */
export async function updatePurchaseListItemStatus(
  itemId: string,
  status: PurchaseListItemStatus
): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `UPDATE ${TABLES.PURCHASE_LIST_ITEMS} SET status = ?, updated_at = ? WHERE id = ?`,
    [status, now(), itemId]
  )
}

/** 删除清单条目 */
export async function removePurchaseListItem(itemId: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.PURCHASE_LIST_ITEMS} WHERE id = ?`, [itemId])
}

// ==================== 从卡组生成 ====================

/** 取卡组最新版本的缺卡检查结果（含借出/借入后的可用数量） */
async function loadDeckCheck(
  deckId: string,
  matchMode: OwnershipMatchMode
): Promise<{ deckVersionId: string | null; checkRows: OwnershipCheckRow[] }> {
  const db = await getDatabase()
  const versionRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.DECK_VERSIONS} WHERE deck_id = ? ORDER BY version_number DESC LIMIT 1`,
    [deckId]
  )
  const deckVersionId = versionRows[0]?.id ?? null

  const deckCards = await getLatestDeckCards(deckId)
  const checkRows = await checkDeckOwnership(
    deckCards.map((c) => ({ cardPrintId: c.print_id, quantity: c.quantity })),
    { matchMode }
  )
  return { deckVersionId, checkRows }
}

/**
 * 根据卡组最新版本缺卡生成购买清单：
 * 1. 取卡组最新版本的卡牌需求（getLatestDeckCards）；
 * 2. 复用 checkDeckOwnership 计算缺卡（含借出/借入后的可用数量）；
 * 3. 建清单头（冻结 deck_version_id + match_mode），缺卡条目逐行 upsert。
 * @param opts.matchMode 'print' 按印刷号（默认）；'card' 按卡牌合并（同卡不同印刷视为同卡，条目用 card_no_extend='' 锚定）
 * @returns 新清单 id
 */
export async function generatePurchaseListFromDeck(
  deckId: string,
  name: string,
  opts?: { matchMode?: OwnershipMatchMode }
): Promise<string> {
  const matchMode = opts?.matchMode ?? 'print'
  const { deckVersionId, checkRows } = await loadDeckCheck(deckId, matchMode)

  const listId = await createPurchaseList({
    name: name.trim() || '未命名清单',
    deckId,
    deckVersionId,
    matchMode,
  })

  for (const row of checkRows) {
    if (row.qtyToBuy <= 0) continue
    await upsertPurchaseListItem(listId, {
      cardNo: row.cardNo,
      cardNoExtend: row.cardNoExtend,
      languagePref: '*',
      finishPref: 'any',
      qtyRequired: row.needed,
      qtyOwned: row.owned,
      qtyToBuy: row.qtyToBuy,
    })
  }
  return listId
}

/**
 * 按当前库存重新生成已存在清单的缺卡条目：
 * 复用 generatePurchaseListFromDeck 的检查逻辑，对既有清单逐条 upsert
 * （已标记 bought 的条目保持 bought，其余刷新数量）。
 * 模式解析：opts.matchMode 优先，否则沿用清单持久化的 match_mode；
 * 切换模式时清理「与新模式键冲突且非 bought」的旧条目
 * （card 模式删同卡号 extend≠'' 的，print 模式删同卡号 extend='' 的），避免重复行。
 * @param listId 目标清单 id（需已存在）
 * @returns 更新后的条目数
 */
export async function refreshPurchaseListFromDeck(
  listId: string,
  opts?: { matchMode?: OwnershipMatchMode }
): Promise<number> {
  const db = await getDatabase()

  const listRows = await db.select<{ deck_id: string | null; match_mode: string | null }[]>(
    `SELECT deck_id, match_mode FROM ${TABLES.PURCHASE_LISTS} WHERE id = ?`,
    [listId]
  )
  const deckId = listRows[0]?.deck_id ?? null
  if (!deckId) throw new Error('该清单未关联卡组，无法重新生成')
  const matchMode = opts?.matchMode ?? (listRows[0]?.match_mode as OwnershipMatchMode) ?? 'print'

  const { deckVersionId, checkRows } = await loadDeckCheck(deckId, matchMode)

  // 清理与新模式键冲突的旧条目（bought 保留）
  const cardNos = [...new Set(checkRows.map((r) => r.cardNo))]
  if (cardNos.length > 0) {
    const placeholders = cardNos.map(() => '?').join(',')
    const extendCond = matchMode === 'card' ? "card_no_extend != ''" : "card_no_extend = ''"
    await db.execute(
      `DELETE FROM ${TABLES.PURCHASE_LIST_ITEMS}
       WHERE list_id = ? AND card_no IN (${placeholders}) AND ${extendCond} AND status != 'bought'`,
      [listId, ...cardNos]
    )
  }

  let updated = 0
  for (const row of checkRows) {
    if (row.qtyToBuy <= 0) continue
    await upsertPurchaseListItem(listId, {
      cardNo: row.cardNo,
      cardNoExtend: row.cardNoExtend,
      languagePref: '*',
      finishPref: 'any',
      qtyRequired: row.needed,
      qtyOwned: row.owned,
      qtyToBuy: row.qtyToBuy,
    })
    updated += 1
  }

  await db.execute(
    `UPDATE ${TABLES.PURCHASE_LISTS} SET deck_version_id = ?, match_mode = ?, updated_at = ? WHERE id = ?`,
    [deckVersionId, matchMode, now(), listId]
  )
  return updated
}

/** 更新清单的检查模式（print 按印刷号 / card 按卡牌合并），不触发重新计算 */
export async function updatePurchaseListMatchMode(
  id: string,
  mode: OwnershipMatchMode
): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `UPDATE ${TABLES.PURCHASE_LISTS} SET match_mode = ?, updated_at = ? WHERE id = ?`,
    [mode, now(), id]
  )
}

/** 清单条目数（列表页展示用） */
export async function getPurchaseListItemCounts(): Promise<Map<string, number>> {
  const db = await getDatabase()
  const map = new Map<string, number>()
  const rows = await db.select<{ list_id: string; n: number }[]>(
    `SELECT list_id, COUNT(*) AS n FROM ${TABLES.PURCHASE_LIST_ITEMS} GROUP BY list_id`
  )
  for (const r of rows) map.set(r.list_id, r.n ?? 0)
  return map
}
