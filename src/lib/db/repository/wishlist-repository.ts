/**
 * 心愿单仓储层
 * 与 owned 库存完全解耦：card_no + card_no_extend × 语言（'*' 任意）× 版本（'any' 不限）唯一。
 * 心愿单条目允许卡尚未入库（不挂 collection FK），卡牌编号为快照。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type { WishlistFinish, WishlistItem, WishlistStatus } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

const now = () => new Date().toISOString()

export interface WishlistItemInput {
  cardNo: string
  cardNoExtend: string
  /** '*' 表示任意语言 */
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
    language_code: r.language_code ?? '*',
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
export async function getWishlistItems(
  filter?: WishlistFilter
): Promise<
  (WishlistItem & {
    card_name_cn: string | null
    img_cdn: string | null
    img_lang: string | null
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
       cb.card_name_cn AS card_name_cn, rep.img_cdn AS img_cdn, rep.language AS img_lang
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
     ) rep ON rep.card_id = cb.id AND rep.card_no_extend = w.card_no_extend AND rep.rn = 1
     ${where}
     ORDER BY w.priority DESC, w.updated_at DESC`,
    params
  )
  return rows.map((r) => ({
    ...mapWishlistRow(r),
    card_name_cn: r.card_name_cn ?? null,
    img_cdn: r.img_cdn ?? null,
    img_lang: r.img_lang ?? null,
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
  const languageCode = input.languageCode ?? '*'
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

/** 删除心愿单条目 */
export async function deleteWishlistItem(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.WISHLIST_ITEMS} WHERE id = ?`, [id])
}
