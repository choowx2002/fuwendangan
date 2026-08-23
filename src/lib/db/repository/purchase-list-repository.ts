/**
 * 购买清单仓储层
 * 清单头（purchase_lists）独立成表，与 collection_langs 解耦；
 * 条目保存 card_no / card_no_extend 快照 + 数量快照（qty_owned），库存变化不改写历史清单。
 * 生成流程：卡组缺卡检查（checkDeckOwnership，按印刷号）→ 建清单头 → 按条目 upsert（同一清单同卡去重）。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type {
  OwnershipCheckRow,
  PurchaseList,
  PurchaseListItem,
  PurchaseListItemStatus,
  PurchaseListStatus,
  WishlistFinish,
} from '../types'
import { getDatabase, withTransaction } from './database'
import { TABLES } from '../config/constants'
import { addTombstone } from './sync-repository'
import { checkDeckOwnership, getCardOwnedQty } from './collection-repository'
import { getLatestDeckCards } from './deck-repository'
import { getWishlistItems } from './wishlist-repository'
import { getActiveLoanQty } from './loan-repository'
import { get } from 'svelte/store'
import { defaultLanguage } from '$lib/stores/settings'

const now = () => new Date().toISOString()

type Db = Awaited<ReturnType<typeof getDatabase>>

function mapPurchaseListRow(r: any): PurchaseList {
  return {
    id: r.id,
    name: r.name,
    deck_id: r.deck_id ?? null,
    deck_version_id: r.deck_version_id ?? null,
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
    language_pref: r.language_pref ?? get(defaultLanguage),
    finish_pref: (r.finish_pref ?? 'any') as WishlistFinish,
    qty_required: r.qty_required ?? 0,
    qty_owned: r.qty_owned ?? 0,
    qty_to_buy: r.qty_to_buy ?? 0,
    qty_ordered: r.qty_ordered ?? 0,
    qty_borrowed: r.qty_borrowed ?? 0,
    qty_bought: r.qty_bought ?? 0,
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
}

/** 创建购买清单，返回 id */
export async function createPurchaseList(input: CreatePurchaseListInput): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  await db.execute(
    `INSERT INTO ${TABLES.PURCHASE_LISTS}
     (id, name, deck_id, deck_version_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?)`,
    [id, input.name.trim(), input.deckId ?? null, input.deckVersionId ?? null, t, t]
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
    `SELECT id, name, deck_id, deck_version_id, status, created_at, updated_at
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
    `SELECT id, name, deck_id, deck_version_id, status, created_at, updated_at
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

/** 更新清单基本信息（仅名称；关联卡组不可在此修改，换卡组需重新生成清单） */
export async function updatePurchaseList(id: string, patch: { name?: string }): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    params.push(patch.name.trim() || '未命名清单')
  }
  if (sets.length === 0) return
  params.push(now(), id)
  await db.execute(
    `UPDATE ${TABLES.PURCHASE_LISTS} SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`,
    params
  )
}

/** 删除购买清单（条目级联删除；写入同步墓碑传播删除） */
export async function deletePurchaseList(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.PURCHASE_LISTS} WHERE id = ?`, [id])
  await addTombstone('purchase_list', id)
}

// ==================== 清单条目 ====================

/** 清单条目列表（join cards_base 取卡名/类别/颜色，卡被删除时为 NULL）
 * owned_live 为该印刷的实时收藏数；other_owned 为同卡号其他印刷的收藏合计（供「其他版本」入口）。 */
export async function getPurchaseListItems(listId: string): Promise<
  (PurchaseListItem & {
    card_name_cn: string | null
    sub_title_cn: string | null
    card_category: string | null
    card_color_list: string | null
    rarity: string | null
    owned_live: number
    loaned_out: number
    /** 可用数 = 实时收藏 − 生效借出（借入由清单内 qty_borrowed 单独管理，不重复计入） */
    available_live: number
    other_owned: number
    img_cdn: string | null
    img_lang: string | null
  })[]
> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT i.id, i.list_id, i.card_no, i.card_no_extend, i.collection_id,
       i.language_pref, i.finish_pref, i.qty_required, i.qty_owned, i.qty_to_buy,
       i.qty_ordered, i.qty_borrowed, i.qty_bought, i.status, i.created_at, i.updated_at,
       cb.card_name_cn AS card_name_cn, cb.sub_title_cn AS sub_title_cn,
       cb.card_category AS card_category,
       cb.card_color_list AS card_color_list,
       COALESCE(rep.extend_rarity_name, rep.rarity_name) AS rarity,
       (SELECT COALESCE(SUM(ocl.normal_qty + ocl.foil_qty), 0)
        FROM ${TABLES.COLLECTION} ocol
        JOIN ${TABLES.COLLECTION_LANGS} ocl ON ocl.collection_id = ocol.id
        WHERE ocol.card_no = i.card_no AND ocol.card_no_extend = i.card_no_extend
          AND ocl.status = 'owned') AS owned_live,
       (SELECT COALESCE(SUM(ocl.normal_qty + ocl.foil_qty), 0)
        FROM ${TABLES.COLLECTION} ocol
        JOIN ${TABLES.COLLECTION_LANGS} ocl ON ocl.collection_id = ocol.id
        WHERE ocol.card_no = i.card_no AND ocol.card_no_extend != i.card_no_extend
          AND ocl.status = 'owned') AS other_owned,
       (SELECT COALESCE(SUM(cl2.qty), 0)
        FROM ${TABLES.CARD_LOANS} cl2
        WHERE cl2.card_no = i.card_no AND cl2.card_no_extend = i.card_no_extend
          AND cl2.direction = 'out' AND cl2.status IN ('active','overdue')) AS loaned_out,
       rep.img_cdn AS img_cdn, rep.language AS img_lang
     FROM ${TABLES.PURCHASE_LIST_ITEMS} i
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = i.card_no
     LEFT JOIN (
       SELECT card_id, card_no_extend, rarity_name, extend_rarity_name, img_cdn, language,
         ROW_NUMBER() OVER (
           PARTITION BY card_id, card_no_extend
           ORDER BY CASE WHEN COALESCE(is_promo, 0) = 1 THEN 1 ELSE 0 END,
                    CASE WHEN language = 'SC' THEN 0 WHEN COALESCE(is_default, 0) = 1 THEN 1 ELSE 2 END,
                    COALESCE(print_order, 0)
         ) AS rn
       FROM ${TABLES.CARD_PRINTS}
     ) rep ON rep.card_id = cb.id AND rep.card_no_extend = i.card_no_extend AND rep.rn = 1
     WHERE i.list_id = ?
     ORDER BY i.qty_to_buy DESC, i.card_no COLLATE NOCASE`,
    [listId]
  )
  return rows.map((r) => ({
    ...mapPurchaseListItemRow(r),
    card_name_cn: r.card_name_cn ?? null,
    sub_title_cn: r.sub_title_cn ?? null,
    card_category: r.card_category ?? null,
    card_color_list: r.card_color_list ?? null,
    rarity: r.rarity ?? null,
    owned_live: r.owned_live ?? 0,
    loaned_out: r.loaned_out ?? 0,
    available_live: (r.owned_live ?? 0) - (r.loaned_out ?? 0),
    other_owned: r.other_owned ?? 0,
    img_cdn: r.img_cdn ?? null,
    img_lang: r.img_lang ?? null,
  }))
}

/** 其他印刷版本收藏明细（同 card_no、不同 card_no_extend 且 owned>0），供「其他版本」弹窗展示 */
export async function getCardOtherVariantOwned(
  cardNo: string,
  excludeCardNoExtend: string
): Promise<
  {
    card_no_extend: string
    rarity: string | null
    normal_qty: number
    foil_qty: number
    total: number
  }[]
> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT col.card_no_extend AS card_no_extend,
       (SELECT COALESCE(p2.extend_rarity_name, p2.rarity_name)
        FROM ${TABLES.CARD_PRINTS} p2
        WHERE p2.card_id = cb.id AND p2.card_no_extend = col.card_no_extend
        ORDER BY CASE WHEN p2.language = 'SC' THEN 0 WHEN COALESCE(p2.is_default, 0) = 1 THEN 1 ELSE 2 END,
                 COALESCE(p2.print_order, 0)
        LIMIT 1) AS rarity,
       SUM(cl.normal_qty) AS normal_qty, SUM(cl.foil_qty) AS foil_qty
     FROM ${TABLES.CARDS_BASE} cb
     JOIN ${TABLES.COLLECTION} col ON col.card_no = cb.card_no
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id AND cl.status = 'owned'
     WHERE cb.card_no = ? AND col.card_no_extend != ?
     GROUP BY col.card_no_extend
     HAVING SUM(cl.normal_qty) + SUM(cl.foil_qty) > 0
     ORDER BY col.card_no_extend`,
    [cardNo, excludeCardNoExtend]
  )
  return rows.map((r) => ({
    card_no_extend: r.card_no_extend,
    rarity: r.rarity ?? null,
    normal_qty: r.normal_qty ?? 0,
    foil_qty: r.foil_qty ?? 0,
    total: (r.normal_qty ?? 0) + (r.foil_qty ?? 0),
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
  qtyOrdered?: number
  qtyBorrowed?: number
  qtyBought?: number
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
  const languagePref = input.languagePref ?? get(defaultLanguage)
  const finishPref = input.finishPref ?? 'any'
  const status = input.status ?? 'pending'

  await db.execute(
    `INSERT INTO ${TABLES.PURCHASE_LIST_ITEMS}
     (id, list_id, card_no, card_no_extend, collection_id,
      language_pref, finish_pref, qty_required, qty_owned, qty_to_buy,
      qty_ordered, qty_borrowed, qty_bought, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(list_id, card_no, card_no_extend, language_pref, finish_pref) DO UPDATE SET
       qty_required = excluded.qty_required,
       qty_owned = excluded.qty_owned,
       qty_to_buy = excluded.qty_to_buy,
       qty_ordered = excluded.qty_ordered,
       qty_borrowed = excluded.qty_borrowed,
       qty_bought = excluded.qty_bought,
       status = CASE WHEN purchase_list_items.status = 'skipped'
                     THEN 'skipped'
                     ELSE excluded.status END,
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
      input.qtyOrdered ?? 0,
      input.qtyBorrowed ?? 0,
      input.qtyBought ?? 0,
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

/** 删除清单条目（先取消该条目名下的借入记录，避免残留孤儿借入） */
export async function removePurchaseListItem(itemId: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `UPDATE ${TABLES.CARD_LOANS}
     SET status = 'cancelled', updated_at = ?
     WHERE purchase_item_id = ? AND status IN ('active','overdue')`,
    [now(), itemId]
  )
  await db.execute(`DELETE FROM ${TABLES.PURCHASE_LIST_ITEMS} WHERE id = ?`, [itemId])
}

export interface PurchaseListChange {
  itemId: string
  qtyOrdered: number
  qtyBorrowed: number
  qtyBought: number
  skipped: boolean
}

export interface PurchaseListSaveResult {
  updatedItems: number
  loansCreated: number
  loansCancelled: number
  /** 写回收藏的总张数（已购买） */
  writtenQty: number
}

/** 条目的实时收藏数（按印刷精确匹配） */
async function liveOwnedQty(db: Db, cardNo: string, cardNoExtend: string): Promise<number> {
  const rows = await db.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(cl.normal_qty + cl.foil_qty), 0) AS n
     FROM ${TABLES.COLLECTION} col
     JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
     WHERE col.card_no = ? AND col.card_no_extend = ? AND cl.status = 'owned'`,
    [cardNo, cardNoExtend]
  )
  return rows[0]?.n ?? 0
}

/**
 * 条目的实时收藏数与生效借出数（按印刷精确匹配）。
 * 可用数 = 收藏 − 借出（借入由清单内 qty_borrowed 单独管理，不在此重复计入）。
 */
async function getPrintOwnedAndLoanedOut(
  db: Db,
  cardNo: string,
  cardNoExtend: string
): Promise<{ owned: number; loanedOut: number }> {
  const owned = await liveOwnedQty(db, cardNo, cardNoExtend)
  const loans = await getActiveLoanQty([`${cardNo}|${cardNoExtend}`], 'print')
  const loanedOut = loans.get(`${cardNo}|${cardNoExtend}`)?.loanedOut ?? 0
  return { owned, loanedOut }
}

/**
 * 按当前库存自愈清单快照（打开清单时调用）：
 * 对非 skipped 条目重算 qty_owned（实时收藏）、qty_to_buy 与 status（pending/met），
 * 保留 skipped 与用户填写的 ordered/borrowed/bought。不写回收藏、不动借入。
 * 覆盖卡片组生成与心愿单生成两类清单，与 refreshPurchaseListFromDeck 互补（后者还会补充新卡）。
 * @returns 更新条数
 */
export async function reconcilePurchaseListItems(listId: string): Promise<number> {
  return withTransaction(async () => {
    const db = await getDatabase()
    const rows = await db.select<
      {
        id: string
        card_no: string
        card_no_extend: string
        qty_required: number
        qty_ordered: number
        qty_borrowed: number
        qty_bought: number
        status: string
      }[]
    >(
      `SELECT id, card_no, card_no_extend, qty_required, qty_ordered, qty_borrowed, qty_bought, status
       FROM ${TABLES.PURCHASE_LIST_ITEMS} WHERE list_id = ?`,
      [listId]
    )

    let updated = 0
    for (const row of rows) {
      if (row.status === 'skipped') continue
      const { owned, loanedOut } = await getPrintOwnedAndLoanedOut(
        db,
        row.card_no,
        row.card_no_extend
      )
      const available = Math.max(0, owned - loanedOut)
      const qtyToBuy = Math.max(
        0,
        row.qty_required - available - row.qty_ordered - row.qty_borrowed - row.qty_bought
      )
      const status: PurchaseListItemStatus = qtyToBuy > 0 ? 'pending' : 'met'
      await db.execute(
        `UPDATE ${TABLES.PURCHASE_LIST_ITEMS}
         SET qty_owned = ?, qty_to_buy = ?, status = ?, updated_at = ? WHERE id = ?`,
        [owned, qtyToBuy, status, now(), row.id]
      )
      updated += 1
    }
    return updated
  })
}

/** 借入对账：目标数量与生效借入（direction='in' 且 active/overdue，按条目归属）比对，不足补建、超出取消。
 *  借入记录通过 purchase_item_id 与清单条目绑定，不同清单/条目之间互不干扰。 */
async function reconcileBorrowIn(
  db: Db,
  cardNo: string,
  cardNoExtend: string,
  targetQty: number,
  purchaseItemId: string
): Promise<{ created: number; cancelled: number }> {
  const loans = await db.select<{ id: string; qty: number }[]>(
    `SELECT id, qty FROM ${TABLES.CARD_LOANS}
     WHERE direction = 'in' AND status IN ('active','overdue')
       AND card_no = ? AND card_no_extend = ? AND purchase_item_id = ?
     ORDER BY created_at ASC`,
    [cardNo, cardNoExtend, purchaseItemId]
  )
  const current = loans.reduce((s, l) => s + (l.qty ?? 0), 0)

  let created = 0
  let cancelled = 0
  if (targetQty > current) {
    const delta = targetQty - current
    const id = Snowflake.generate()
    const t = now()
    await db.execute(
      `INSERT INTO ${TABLES.CARD_LOANS}
       (id, direction, contact_id, card_no, card_no_extend, language_code, finish,
        qty, loaned_at, due_at, returned_at, status, note, purchase_item_id, created_at, updated_at)
       VALUES (?, 'in', NULL, ?, ?, '*', 'any', ?, ?, NULL, NULL, 'active', NULL, ?, ?, ?)`,
      [id, cardNo, cardNoExtend, delta, t, purchaseItemId, t, t]
    )
    created = delta
  } else if (targetQty < current) {
    let excess = current - targetQty
    for (const l of loans.slice().reverse()) {
      if (excess <= 0) break
      const reduce = Math.min(l.qty, excess)
      if (reduce >= l.qty) {
        await db.execute(
          `UPDATE ${TABLES.CARD_LOANS} SET status = 'cancelled', updated_at = ? WHERE id = ?`,
          [now(), l.id]
        )
      } else {
        await db.execute(
          `UPDATE ${TABLES.CARD_LOANS} SET qty = qty - ?, updated_at = ? WHERE id = ?`,
          [reduce, now(), l.id]
        )
      }
      cancelled += reduce
      excess -= reduce
    }
  }
  return { created, cancelled }
}

/**
 * 批量保存清单条目编辑（行内编辑后一次性确认调用）：
 * 1. 整个批次包在 withTransaction（FK 开启的批量写，无跨语句事务/回滚），
 *    串行槽内保证不与其他 db 操作交错；写回顺序保证 FK 依赖合法。
 * 2. 逐条更新 qty_ordered / qty_borrowed / qty_bought / qty_to_buy / status；
 *    qty_to_buy = max(0, 需要 - 实时已有 - 已下单 - 借入 - 已购买)；
 *    status 按 跳过/待购买/已满足 派生。
 * 3. 跳过（skipped）条目不写回收藏、不对账借入（保留用户填写的数量，可随时取消跳过）；
 *    非跳过条目：借入对账按条目归属（purchase_item_id）补建/取消。
 * 4. 非跳过条目的已购买写回收藏（incrementOwned 累加），随后条目 qty_bought 归 0
 *    （已计入「已有」，避免重复计数）。
 */
export async function savePurchaseListBatch(
  listId: string,
  changes: PurchaseListChange[]
): Promise<PurchaseListSaveResult> {
  return withTransaction(async () => {
    const db = await getDatabase()
    let updatedItems = 0
    let loansCreated = 0
    let loansCancelled = 0
    let writtenQty = 0

    for (const change of changes) {
      const rows = await db.select<
        {
          id: string
          card_no: string
          card_no_extend: string
          qty_required: number
          language_pref: string
        }[]
      >(
        `SELECT id, card_no, card_no_extend, qty_required, language_pref
         FROM ${TABLES.PURCHASE_LIST_ITEMS} WHERE id = ? AND list_id = ?`,
        [change.itemId, listId]
      )
      const item = rows[0]
      if (!item) continue

      const { owned, loanedOut } = await getPrintOwnedAndLoanedOut(
        db,
        item.card_no,
        item.card_no_extend
      )
      const available = Math.max(0, owned - loanedOut)
      const qtyToBuy = change.skipped
        ? 0
        : Math.max(
            0,
            item.qty_required -
              available -
              change.qtyOrdered -
              change.qtyBorrowed -
              change.qtyBought
          )
      const status: PurchaseListItemStatus = change.skipped
        ? 'skipped'
        : qtyToBuy > 0
          ? 'pending'
          : 'met'

      if (!change.skipped && change.qtyBought > 0) {
        const { incrementOwned } = await import('./collection-repository')
        writtenQty += await incrementOwned({
          cardNo: item.card_no,
          cardNoExtend: item.card_no_extend,
          language: item.language_pref,
          qty: change.qtyBought,
        })
      }

      // 跳过条目保留用户填写的 qty_bought（不写回、不归零），取消跳过后可继续用
      await db.execute(
        `UPDATE ${TABLES.PURCHASE_LIST_ITEMS}
         SET qty_ordered = ?, qty_borrowed = ?, qty_bought = ?,
             qty_to_buy = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        [
          change.qtyOrdered,
          change.qtyBorrowed,
          change.skipped ? change.qtyBought : 0,
          qtyToBuy,
          status,
          now(),
          item.id,
        ]
      )
      updatedItems += 1

      if (!change.skipped) {
        const borrow = await reconcileBorrowIn(
          db,
          item.card_no,
          item.card_no_extend,
          change.qtyBorrowed,
          item.id
        )
        loansCreated += borrow.created
        loansCancelled += borrow.cancelled
      }
    }

    await db.execute(`UPDATE ${TABLES.PURCHASE_LISTS} SET updated_at = ? WHERE id = ?`, [
      now(),
      listId,
    ])
    return { updatedItems, loansCreated, loansCancelled, writtenQty }
  })
}

// ==================== 清单组成编辑器 ====================

export interface PurchaseListEditorRow {
  /** 已有条目 id；新行（未保存）为空 */
  itemId?: string | null
  cardNo: string
  cardNoExtend: string
  languagePref: string
  finishPref: WishlistFinish
  qtyRequired: number
}

export interface PurchaseListEditorSaveResult {
  added: number
  updated: number
  removed: number
}

/** 编辑器内新增/整行重写的落库：算实时已有与待购买，按唯一键 upsert */
async function upsertEditorItem(db: Db, listId: string, row: PurchaseListEditorRow): Promise<void> {
  const { owned, loanedOut } = await getPrintOwnedAndLoanedOut(db, row.cardNo, row.cardNoExtend)
  const available = Math.max(0, owned - loanedOut)
  const qtyToBuy = Math.max(0, row.qtyRequired - available)
  await upsertPurchaseListItem(listId, {
    cardNo: row.cardNo,
    cardNoExtend: row.cardNoExtend,
    languagePref: row.languagePref,
    finishPref: row.finishPref,
    qtyRequired: row.qtyRequired,
    qtyOwned: owned,
    qtyToBuy,
  })
}

/**
 * 保存清单组成编辑（编辑页表格保存调用）：
 * 逐行 diff 当前条目：
 * - 仅 qty_required 变化：原地 UPDATE，保留 qty_ordered/borrowed/bought，重算 qty_to_buy；
 * - variant/语言/工艺变化：先移除旧条目（顺带取消其名下生效借入），再按新键 upsert；
 * - 新增行：upsert；编辑器中已删除的行：移除（取消借入）。
 * 整个批次在 withTransaction 内顺序写回；幂等 upsert，重试安全。
 */
export async function savePurchaseListEditor(
  listId: string,
  rows: PurchaseListEditorRow[],
  name?: string
): Promise<PurchaseListEditorSaveResult> {
  return withTransaction(async () => {
    const db = await getDatabase()
    const current = await getPurchaseListItems(listId)
    const byId = new Map(current.map((i) => [i.id, i]))
    const seen = new Set<string>()
    let added = 0
    let updated = 0
    let removed = 0

    for (const row of rows) {
      if (row.itemId && byId.has(row.itemId)) {
        const cur = byId.get(row.itemId)!
        seen.add(row.itemId)
        const sameComposition =
          cur.card_no_extend === row.cardNoExtend &&
          cur.language_pref === row.languagePref &&
          cur.finish_pref === row.finishPref
        if (sameComposition) {
          if (cur.qty_required !== row.qtyRequired) {
            const { owned, loanedOut } = await getPrintOwnedAndLoanedOut(
              db,
              row.cardNo,
              row.cardNoExtend
            )
            const available = Math.max(0, owned - loanedOut)
            const qtyToBuy = Math.max(
              0,
              row.qtyRequired - available - cur.qty_ordered - cur.qty_borrowed - cur.qty_bought
            )
            const status: PurchaseListItemStatus =
              cur.status === 'skipped' ? 'skipped' : qtyToBuy > 0 ? 'pending' : 'met'
            await db.execute(
              `UPDATE ${TABLES.PURCHASE_LIST_ITEMS}
               SET qty_required = ?, qty_to_buy = ?, status = ?, updated_at = ?
               WHERE id = ?`,
              [row.qtyRequired, qtyToBuy, status, now(), row.itemId]
            )
            updated += 1
          }
        } else {
          await removePurchaseListItem(row.itemId)
          removed += 1
          await upsertEditorItem(db, listId, row)
          added += 1
        }
      } else {
        await upsertEditorItem(db, listId, row)
        added += 1
      }
    }

    for (const [id] of byId) {
      if (!seen.has(id)) {
        await removePurchaseListItem(id)
        removed += 1
      }
    }

    if (name !== undefined) {
      await db.execute(`UPDATE ${TABLES.PURCHASE_LISTS} SET name = ? WHERE id = ?`, [
        name.trim() || '未命名清单',
        listId,
      ])
    }

    await db.execute(`UPDATE ${TABLES.PURCHASE_LISTS} SET updated_at = ? WHERE id = ?`, [
      now(),
      listId,
    ])
    return { added, updated, removed }
  })
}

/** 新建清单并写入全部组成（新建页保存调用），返回新清单 id */
export async function createPurchaseListEditor(input: {
  name: string
  rows: PurchaseListEditorRow[]
}): Promise<string> {
  return withTransaction(async () => {
    const db = await getDatabase()
    const listId = await createPurchaseList({
      name: input.name.trim() || '未命名清单',
      deckId: null,
      deckVersionId: null,
    })
    for (const row of input.rows) {
      await upsertEditorItem(db, listId, row)
    }
    return listId
  })
}

/**
 * 卡组缺卡预览（新建页「从卡组生成」用）：复用卡组缺卡检查，返回缺卡行，不落库。
 */
export async function getDeckPurchasePreview(
  deckId: string
): Promise<
  {
    cardNo: string
    cardNoExtend: string
    cardName: string | null
    needed: number
    imgCdn: string | null
    printLanguage: string | null
  }[]
> {
  const { checkRows } = await loadDeckCheck(deckId)
  return checkRows
    .filter((r) => r.qtyToBuy > 0)
    .map((r) => ({
      cardNo: r.cardNo,
      cardNoExtend: r.cardNoExtend,
      cardName: r.cardName ?? null,
      needed: r.needed,
      imgCdn: r.imgCdn ?? null,
      printLanguage: r.printLanguage ?? null,
    }))
}

// ==================== 从卡组生成 ====================

/** 取卡组最新版本的缺卡检查结果（按印刷号，含借出/借入后的可用数量） */
async function loadDeckCheck(
  deckId: string
): Promise<{ deckVersionId: string | null; checkRows: OwnershipCheckRow[] }> {
  const db = await getDatabase()
  const versionRows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.DECK_VERSIONS} WHERE deck_id = ? ORDER BY version_number DESC LIMIT 1`,
    [deckId]
  )
  const deckVersionId = versionRows[0]?.id ?? null

  const deckCards = await getLatestDeckCards(deckId)
  const checkRows = await checkDeckOwnership(
    deckCards.map((c) => ({ cardPrintId: c.print_id, quantity: c.quantity }))
  )
  return { deckVersionId, checkRows }
}

/**
 * 根据卡组最新版本缺卡生成购买清单（按印刷号）：
 * 1. 取卡组最新版本的卡牌需求（getLatestDeckCards）；
 * 2. 复用 checkDeckOwnership 计算缺卡（含借出/借入后的可用数量）；
 * 3. 建清单头（冻结 deck_version_id），缺卡条目逐行 upsert。
 * @returns 新清单 id
 */
export async function generatePurchaseListFromDeck(deckId: string, name: string): Promise<string> {
  const { deckVersionId, checkRows } = await loadDeckCheck(deckId)

  const listId = await createPurchaseList({
    name: name.trim() || '未命名清单',
    deckId,
    deckVersionId,
  })

  for (const row of checkRows) {
    if (row.qtyToBuy <= 0) continue
    await upsertPurchaseListItem(listId, {
      cardNo: row.cardNo,
      cardNoExtend: row.cardNoExtend,
      languagePref: get(defaultLanguage),
      finishPref: 'any',
      qtyRequired: row.needed,
      qtyOwned: row.owned,
      qtyToBuy: row.qtyToBuy,
    })
  }
  return listId
}

/**
 * 根据心愿单生成购买清单：
 * 1. 取 status='active' 的心愿单条目（语言/版本偏好透传，不丢失）；
 * 2. 实时计算每张卡已拥有数（owned）与可用数（owned − 借出 + 借入）；
 * 3. 建清单头（不关联卡组），缺卡条目逐行 upsert（同一清单同键去重）。
 * 心愿单 qty_wanted → qty_required，语言/版本偏好原样保留。
 * @returns 新清单 id
 */
export async function generatePurchaseListFromWishlist(input: {
  name: string
  /** 是否包含已满足（to_buy=0）的条目；默认 false 仅生成缺卡 */
  includeZeroToBuy?: boolean
}): Promise<string> {
  return withTransaction(async () => {
    const items = await getWishlistItems({ status: 'active' })
    const listId = await createPurchaseList({
      name: input.name.trim() || '心愿单缺卡',
      deckId: null,
      deckVersionId: null,
    })

    if (items.length === 0) return listId

    const keys = items.map((i) => `${i.card_no}|${i.card_no_extend}`)
    const loanQty = await getActiveLoanQty(keys, 'print')

    for (const item of items) {
      const owned = await getCardOwnedQty(item.card_no, item.card_no_extend)
      const loans = loanQty.get(`${item.card_no}|${item.card_no_extend}`)
      const available = owned - (loans?.loanedOut ?? 0) + (loans?.borrowedIn ?? 0)
      const qtyToBuy = Math.max(0, item.qty_wanted - available)
      if (qtyToBuy <= 0 && !input.includeZeroToBuy) continue
      await upsertPurchaseListItem(listId, {
        cardNo: item.card_no,
        cardNoExtend: item.card_no_extend,
        languagePref: item.language_code,
        finishPref: item.finish,
        qtyRequired: item.qty_wanted,
        qtyOwned: owned,
        qtyToBuy,
      })
    }
    return listId
  })
}

/**
 * 按当前库存重新生成已存在清单的缺卡条目（按印刷号）：
 * 复用 generatePurchaseListFromDeck 的检查逻辑，对既有清单逐条 upsert
 * （已标记 skipped 的条目保持 skipped，其余刷新数量）。
 * 清理历史「按卡牌合并」遗留的锚点条目（card_no_extend='' 且非 skipped）。
 * @param listId 目标清单 id（需已存在）
 * @returns 更新后的条目数
 */
export async function refreshPurchaseListFromDeck(listId: string): Promise<number> {
  const db = await getDatabase()

  const listRows = await db.select<{ deck_id: string | null }[]>(
    `SELECT deck_id FROM ${TABLES.PURCHASE_LISTS} WHERE id = ?`,
    [listId]
  )
  const deckId = listRows[0]?.deck_id ?? null
  if (!deckId) throw new Error('该清单未关联卡组，无法重新生成')

  const { deckVersionId, checkRows } = await loadDeckCheck(deckId)

  // 清理历史「任意版本」锚点条目（skipped 保留）
  const cardNos = [...new Set(checkRows.map((r) => r.cardNo))]
  if (cardNos.length > 0) {
    const placeholders = cardNos.map(() => '?').join(',')
    await db.execute(
      `DELETE FROM ${TABLES.PURCHASE_LIST_ITEMS}
       WHERE list_id = ? AND card_no IN (${placeholders}) AND card_no_extend = ''
         AND status != 'skipped'`,
      [listId, ...cardNos]
    )
  }

  let updated = 0
  for (const row of checkRows) {
    if (row.qtyToBuy > 0) {
      await upsertPurchaseListItem(listId, {
        cardNo: row.cardNo,
        cardNoExtend: row.cardNoExtend,
        languagePref: get(defaultLanguage),
        finishPref: 'any',
        qtyRequired: row.needed,
        qtyOwned: row.owned,
        qtyToBuy: row.qtyToBuy,
      })
      updated += 1
    } else {
      // 已满足的条目：刷新快照（qty_owned 取实时收藏、qty_to_buy 归 0），
      // 避免「已有/建议购买」停留在旧值。仅更新已存在的行，不新建；
      // 状态同步为 met（跳过条目保持 skipped）。
      await db.execute(
        `UPDATE ${TABLES.PURCHASE_LIST_ITEMS}
         SET qty_owned = ?, qty_to_buy = 0,
             status = CASE WHEN status = 'skipped' THEN 'skipped' ELSE 'met' END,
             updated_at = ?
         WHERE list_id = ? AND card_no = ? AND card_no_extend = ?
           AND language_pref = ? AND finish_pref = 'any'`,
        [row.owned, now(), listId, row.cardNo, row.cardNoExtend, get(defaultLanguage)]
      )
    }
  }

  await db.execute(
    `UPDATE ${TABLES.PURCHASE_LISTS} SET deck_version_id = ?, updated_at = ? WHERE id = ?`,
    [deckVersionId, now(), listId]
  )
  return updated
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
