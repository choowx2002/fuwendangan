/**
 * 借还实体：行级（key = card_loans.id），LWW + 墓碑 'loan'。
 * 写回时 contact_id 引用不存在的联系人则置 NULL（外键 ON DELETE SET NULL 语义）。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import type { SyncLoan, SyncTombstone } from '../types'
import { mergeById, existsIn, type DbLike, type MergeResult } from './common'

export function extractLoans(): Promise<SyncLoan[]> {
  return (async () => {
    const db = await getDatabase()
    const rows = (await db.select(`SELECT * FROM ${TABLES.CARD_LOANS}`)) as Record<
      string,
      unknown
    >[]
    return rows.map((r) => ({
      id: String(r.id),
      direction: String(r.direction),
      contact_id: (r.contact_id as string) ?? null,
      card_no: String(r.card_no),
      card_no_extend: String(r.card_no_extend),
      language_code: String(r.language_code ?? 'SC'),
      finish: String(r.finish ?? 'any'),
      qty: Number(r.qty ?? 1),
      loaned_at: String(r.loaned_at ?? ''),
      due_at: (r.due_at as string) ?? null,
      returned_at: (r.returned_at as string) ?? null,
      status: String(r.status ?? 'active'),
      note: (r.note as string) ?? null,
      purchase_item_id: (r.purchase_item_id as string) ?? null,
      created_at: (r.created_at as string) ?? null,
      updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
    }))
  })()
}

export function mergeLoans(opts: {
  local: SyncLoan[]
  remote: SyncLoan[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncLoan> {
  return mergeById(opts)
}

export async function applyLoans(
  db: DbLike,
  upsert: SyncLoan[],
  deleteIds: string[]
): Promise<void> {
  for (const id of deleteIds) {
    await db.execute(`DELETE FROM ${TABLES.CARD_LOANS} WHERE id = ?`, [id])
  }
  for (const l of upsert) {
    let contactId = l.contact_id
    if (contactId && !(await existsIn(db, TABLES.CONTACTS, contactId))) contactId = null
    await db.execute(
      `INSERT INTO ${TABLES.CARD_LOANS}
       (id, direction, contact_id, card_no, card_no_extend, language_code, finish, qty,
        loaned_at, due_at, returned_at, status, note, purchase_item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         direction = excluded.direction, contact_id = excluded.contact_id,
         card_no = excluded.card_no, card_no_extend = excluded.card_no_extend,
         language_code = excluded.language_code, finish = excluded.finish,
         qty = excluded.qty, loaned_at = excluded.loaned_at, due_at = excluded.due_at,
         returned_at = excluded.returned_at, status = excluded.status, note = excluded.note,
         purchase_item_id = excluded.purchase_item_id, updated_at = excluded.updated_at`,
      [
        l.id,
        l.direction,
        contactId,
        l.card_no,
        l.card_no_extend,
        l.language_code,
        l.finish,
        l.qty,
        l.loaned_at,
        l.due_at,
        l.returned_at,
        l.status,
        l.note,
        l.purchase_item_id,
        l.created_at,
        l.updated_at,
      ]
    )
  }
}
