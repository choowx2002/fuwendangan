/**
 * 心愿单仓储层
 * 与 owned 库存完全解耦：card_no + card_no_extend × 语言（默认 SC）× 版本（'any' 不限）唯一。
 * 心愿单条目允许卡尚未入库（不挂 collection FK），卡牌编号为快照。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import { get } from 'svelte/store'
import type { WishlistFinish, WishlistItem, WishlistStatus } from '../types'
import { getDatabase, withTransaction } from './database'
import { TABLES } from '../config/constants'
import { addTombstone } from './sync-repository'
import { defaultLanguage } from '$lib/stores/settings'

const now = () => new Date().toISOString()

export interface WishlistItemInput {
  cardNo: string
  cardNoExtend: string
  /** 期望语言码，缺省用设置中的默认语言 */
  languageCode?: string
  /** 'any' 表示不限普卡/闪卡 */
  finish?: WishlistFinish
  qtyWanted?: number
  priority?: number
  status?: WishlistStatus
  note?: string | null
}

export interface WishlistFilter {
  status?: WishlistStatus
  cardNo?: string
}

function mapWishlistRow(r: any): WishlistItem {
  return {
    id: r.id,
    card_no: r.card_no,
    card_no_extend: r.card_no_extend,
    language_code: r.language_code ?? get(defaultLanguage),
    finish: (r.finish ?? 'any') as WishlistFinish,
    qty_wanted: r.qty_wanted ?? 0,
    priority: r.priority ?? 3,
    status: r.status as WishlistStatus,
    note: r.note ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

/** 心愿单列表（可选状态/卡牌过滤，join cards_base 取卡名，卡被删除时为 NULL） */
export async function getWishlistItems(filter?: WishlistFilter): Promise<
  (WishlistItem & {
    card_name_cn: string | null
    card_sub_cn: string | null
    img_cdn: string | null
    img_lang: string | null
    /** 实时收藏数（该印刷，跨语言合计，normal+foil） */
    owned_live: number
    /** 生效借出数 */
    loaned_out: number
    /** 生效借入数 */
    borrowed_in: number
    /** 可用数 = 收藏 − 借出 + 借入（与卡组持有检查口径一致） */
    available_live: number
  })[]
> {
  const db = await getDatabase()
  const conds: string[] = []
  const params: any[] = []
  if (filter?.status) {
    conds.push('w.status = ?')
    params.push(filter.status)
  }
  if (filter?.cardNo) {
    conds.push('w.card_no = ?')
    params.push(filter.cardNo)
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''

  const rows = await db.select<any[]>(
    `SELECT w.id, w.card_no, w.card_no_extend, w.language_code, w.finish,
       w.qty_wanted, w.priority, w.status, w.note, w.created_at, w.updated_at,
       cb.card_name_cn AS card_name_cn, cb.sub_title_cn AS card_sub_cn,
       rep.img_cdn AS img_cdn, rep.language AS img_lang
     FROM ${TABLES.WISHLIST_ITEMS} w
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = w.card_no
     LEFT JOIN (
       SELECT card_id, card_no_extend, img_cdn, language,
         ROW_NUMBER() OVER (
           PARTITION BY card_id, card_no_extend
           ORDER BY CASE WHEN COALESCE(is_promo, 0) = 1 THEN 1 ELSE 0 END,
                    CASE WHEN language = 'SC' THEN 0 WHEN COALESCE(is_default, 0) = 1 THEN 1 ELSE 2 END,
                    COALESCE(print_order, 0)
         ) AS rn
       FROM ${TABLES.CARD_PRINTS}
     ) rep ON rep.card_id = cb.id AND rep.card_no_extend = w.card_no_extend AND rep.rn = 1,
     (SELECT COALESCE(SUM(ocl.normal_qty + ocl.foil_qty), 0)
      FROM ${TABLES.COLLECTION} ocol
      JOIN ${TABLES.COLLECTION_LANGS} ocl ON ocl.collection_id = ocol.id
      WHERE ocol.card_no = w.card_no AND ocol.card_no_extend = w.card_no_extend
        AND ocl.status = 'owned') AS owned_live,
     (SELECT COALESCE(SUM(cl2.qty), 0)
      FROM ${TABLES.CARD_LOANS} cl2
      WHERE cl2.card_no = w.card_no AND cl2.card_no_extend = w.card_no_extend
        AND cl2.direction = 'out' AND cl2.status IN ('active','overdue')) AS loaned_out,
     (SELECT COALESCE(SUM(cl3.qty), 0)
      FROM ${TABLES.CARD_LOANS} cl3
      WHERE cl3.card_no = w.card_no AND cl3.card_no_extend = w.card_no_extend
        AND cl3.direction = 'in' AND cl3.status IN ('active','overdue')) AS borrowed_in
     ${where}
     ORDER BY w.priority DESC, w.updated_at DESC`,
    params
  )
  return rows.map((r) => ({
    ...mapWishlistRow(r),
    card_name_cn: r.card_name_cn ?? null,
    card_sub_cn: r.card_sub_cn ?? null,
    img_cdn: r.img_cdn ?? null,
    img_lang: r.img_lang ?? null,
    owned_live: r.owned_live ?? 0,
    loaned_out: r.loaned_out ?? 0,
    borrowed_in: r.borrowed_in ?? 0,
    available_live: (r.owned_live ?? 0) - (r.loaned_out ?? 0) + (r.borrowed_in ?? 0),
  }))
}

/** 生效中心愿单条目数 */
export async function countActiveWishlist(): Promise<number> {
  const db = await getDatabase()
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${TABLES.WISHLIST_ITEMS} WHERE status = 'active'`
  )
  return rows[0]?.n ?? 0
}

/**
 * 新增/更新心愿单条目（按 卡牌×语言×版本 唯一键 upsert，重复时更新数量/优先级）。
 * 返回条目 id。
 */
export async function upsertWishlistItem(input: WishlistItemInput): Promise<string> {
  const db = await getDatabase()
  const languageCode = input.languageCode ?? get(defaultLanguage)
  const finish = input.finish ?? 'any'
  const qtyWanted = input.qtyWanted ?? 1
  const priority = input.priority ?? 3
  const status = input.status ?? 'active'
  const note = input.note ?? null

  const existing = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.WISHLIST_ITEMS}
     WHERE card_no = ? AND card_no_extend = ? AND language_code = ? AND finish = ?`,
    [input.cardNo, input.cardNoExtend, languageCode, finish]
  )
  const id = existing[0]?.id ?? Snowflake.generate()
  const t = now()

  if (existing[0]) {
    await db.execute(
      `UPDATE ${TABLES.WISHLIST_ITEMS}
       SET qty_wanted = ?, priority = ?, status = ?, note = ?, updated_at = ? WHERE id = ?`,
      [qtyWanted, priority, status, note, t, id]
    )
  } else {
    await db.execute(
      `INSERT INTO ${TABLES.WISHLIST_ITEMS}
       (id, card_no, card_no_extend, language_code, finish, qty_wanted, priority, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.cardNo,
        input.cardNoExtend,
        languageCode,
        finish,
        qtyWanted,
        priority,
        status,
        note,
        t,
        t,
      ]
    )
  }
  return id
}

/** 更新心愿单状态（active / acquired / archived） */
export async function updateWishlistStatus(id: string, status: WishlistStatus): Promise<void> {
  const db = await getDatabase()
  await db.execute(`UPDATE ${TABLES.WISHLIST_ITEMS} SET status = ?, updated_at = ? WHERE id = ?`, [
    status,
    now(),
    id,
  ])
}

/** 删除心愿单条目（写入同步墓碑传播删除） */
export async function deleteWishlistItem(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.WISHLIST_ITEMS} WHERE id = ?`, [id])
  await addTombstone('wishlist', id)
}

/**
 * 标记心愿单条目为已拥有，并写回收藏库存。
 * 写回采用 max 语义（幂等）：仅确保至少拥有 qty_wanted 张，重复标记不会叠加。
 * 语言偏好 '*' → EN；finish 决定普卡/闪卡维度。
 * 时序：先写收藏、成功后再置 status='acquired'，避免「已标记但收藏未写」的部分失败态；
 * 写回失败时不标记，可直接重试（幂等，不重复）。
 */
export async function markWishlistAcquired(
  id: string,
  opts?: { qty?: number; cardNoExtend?: string }
): Promise<{ written: boolean }> {
  const db = await getDatabase()
  const rows = await db.select<
    {
      id: string
      card_no: string
      card_no_extend: string
      language_code: string
      finish: string
      qty_wanted: number
    }[]
  >(
    `SELECT id, card_no, card_no_extend, language_code, finish, qty_wanted
     FROM ${TABLES.WISHLIST_ITEMS} WHERE id = ?`,
    [id]
  )
  const item = rows[0]
  if (!item) throw new Error('心愿单条目不存在')

  const { writebackOwned } = await import('./collection-repository')
  const written = await writebackOwned({
    cardNo: item.card_no,
    cardNoExtend: opts?.cardNoExtend ?? item.card_no_extend,
    language: item.language_code,
    finish: item.finish,
    qty: opts?.qty ?? item.qty_wanted,
  })

  await db.execute(
    `UPDATE ${TABLES.WISHLIST_ITEMS} SET status = 'acquired', updated_at = ? WHERE id = ?`,
    [now(), id]
  )
  return { written: written > 0 }
}

// ==================== CSV 导入 ====================

export interface WishlistImportRow {
  cardNoExtend: string
  languageCode?: string
  finish?: WishlistFinish
  qtyWanted?: number
  priority?: number
  status?: WishlistStatus
  note?: string | null
}

export interface WishlistImportResult {
  applied: number
  created: number
  updated: number
  skipped: string[]
}

/**
 * 心愿单 CSV 回导（withTransaction 批量写，幂等）：
 * - 唯一键：card_no_extend × language_code × finish（与 upsertWishlistItem 一致）；
 * - 已存在更新数量/优先级/状态/备注，不存在新建；重复导入不产生重复条目。
 */
export async function importWishlistCsv(rows: WishlistImportRow[]): Promise<WishlistImportResult> {
  return withTransaction(async () => {
    const db = await getDatabase()

    const extendsList = [...new Set(rows.map((r) => r.cardNoExtend))]
    const cardNoByExtend = new Map<string, string>()
    if (extendsList.length > 0) {
      const sql = `SELECT DISTINCT cb.card_no AS card_no, p.card_no_extend AS card_no_extend
         FROM ${TABLES.CARD_PRINTS} p
         JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
         WHERE p.card_no_extend IN (${extendsList.map(() => '?').join(',')})`
      const found = await db.select<{ card_no: string; card_no_extend: string }[]>(sql, extendsList)
      for (const f of found) cardNoByExtend.set(f.card_no_extend, f.card_no)
    }

    let applied = 0
    let created = 0
    let updated = 0
    const skipped: string[] = []

    for (const r of rows) {
      const cardNo = cardNoByExtend.get(r.cardNoExtend)
      if (!cardNo) {
        skipped.push(r.cardNoExtend)
        continue
      }
      const languageCode = r.languageCode ?? get(defaultLanguage)
      const finish = r.finish ?? 'any'
      const existing = await db.select<{ id: string }[]>(
        `SELECT id FROM ${TABLES.WISHLIST_ITEMS}
         WHERE card_no = ? AND card_no_extend = ? AND language_code = ? AND finish = ?`,
        [cardNo, r.cardNoExtend, languageCode, finish]
      )

      await upsertWishlistItem({
        cardNo,
        cardNoExtend: r.cardNoExtend,
        languageCode,
        finish,
        qtyWanted: r.qtyWanted ?? 1,
        priority: r.priority ?? 3,
        status: r.status ?? 'active',
        note: r.note ?? null,
      })

      if (existing.length > 0) updated += 1
      else created += 1
      applied += 1
    }

    return { applied, created, updated, skipped }
  })
}
