/**
 * 联系人实体：行级（key = contacts.id），LWW + 墓碑 'contact'。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import type { SyncContact, SyncTombstone } from '../types'
import { mergeById, type DbLike, type MergeResult } from './common'

export function extractContacts(): Promise<SyncContact[]> {
  return (async () => {
    const db = await getDatabase()
    const rows = (await db.select(`SELECT * FROM ${TABLES.CONTACTS}`)) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      note: (r.note as string) ?? null,
      wechat: (r.wechat as string) ?? null,
      qq: (r.qq as string) ?? null,
      phone: (r.phone as string) ?? null,
      email: (r.email as string) ?? null,
      created_at: (r.created_at as string) ?? null,
      updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
    }))
  })()
}

export function mergeContacts(opts: {
  local: SyncContact[]
  remote: SyncContact[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncContact> {
  return mergeById(opts)
}

export async function applyContacts(
  db: DbLike,
  upsert: SyncContact[],
  deleteIds: string[]
): Promise<void> {
  for (const id of deleteIds) {
    await db.execute(`DELETE FROM ${TABLES.CONTACTS} WHERE id = ?`, [id])
  }
  for (const c of upsert) {
    await db.execute(
      `INSERT INTO ${TABLES.CONTACTS} (id, name, note, wechat, qq, phone, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, note = excluded.note, wechat = excluded.wechat,
         qq = excluded.qq, phone = excluded.phone, email = excluded.email,
         updated_at = excluded.updated_at`,
      [c.id, c.name, c.note, c.wechat, c.qq, c.phone, c.email, c.created_at, c.updated_at]
    )
  }
}
