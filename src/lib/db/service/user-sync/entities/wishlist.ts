/**
 * 心愿单实体：行级（key = wishlist_items.id），LWW + 墓碑 'wishlist'。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import type { SyncTombstone, SyncWishlist } from '../types'
import { mergeById, type DbLike, type MergeResult } from './common'

export function extractWishlist(): Promise<SyncWishlist[]> {
  return (async () => {
    const db = await getDatabase()
    const rows = (await db.select(`SELECT * FROM ${TABLES.WISHLIST_ITEMS}`)) as Record<
      string,
      unknown
    >[]
    return rows.map((r) => ({
      id: String(r.id),
      card_no: String(r.card_no),
      card_no_extend: String(r.card_no_extend),
      language_code: String(r.language_code ?? 'SC'),
      finish: String(r.finish ?? 'any'),
      qty_wanted: Number(r.qty_wanted ?? 1),
      priority: Number(r.priority ?? 3),
      status: String(r.status ?? 'active'),
      note: (r.note as string) ?? null,
      created_at: (r.created_at as string) ?? null,
      updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
    }))
  })()
}

export function mergeWishlist(opts: {
  local: SyncWishlist[]
  remote: SyncWishlist[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncWishlist> {
  return mergeById(opts)
}

export async function applyWishlist(
  db: DbLike,
  upsert: SyncWishlist[],
  deleteIds: string[]
): Promise<void> {
  for (const id of deleteIds) {
    await db.execute(`DELETE FROM ${TABLES.WISHLIST_ITEMS} WHERE id = ?`, [id])
  }
  for (const w of upsert) {
    await db.execute(
      `INSERT INTO ${TABLES.WISHLIST_ITEMS}
       (id, card_no, card_no_extend, language_code, finish, qty_wanted, priority, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         card_no = excluded.card_no, card_no_extend = excluded.card_no_extend,
         language_code = excluded.language_code, finish = excluded.finish,
         qty_wanted = excluded.qty_wanted, priority = excluded.priority,
         status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
      [
        w.id,
        w.card_no,
        w.card_no_extend,
        w.language_code,
        w.finish,
        w.qty_wanted,
        w.priority,
        w.status,
        w.note,
        w.created_at,
        w.updated_at,
      ]
    )
  }
}
