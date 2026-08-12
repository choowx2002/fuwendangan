/**
 * 借还对象（联系人）仓储层
 * 借出/借入记录通过 contact_id 关联，删除联系人时 card_loans.contact_id 置 NULL（记录保留）。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type { Contact } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

const now = () => new Date().toISOString()

function mapContactRow(r: any): Contact {
  return {
    id: r.id,
    name: r.name,
    note: r.note ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

/** 全部借还对象（按名称排序） */
export async function getContacts(): Promise<Contact[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT id, name, note, created_at, updated_at FROM ${TABLES.CONTACTS}
     ORDER BY name COLLATE NOCASE`
  )
  return rows.map(mapContactRow)
}

/** 单个借还对象 */
export async function getContact(id: string): Promise<Contact | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT id, name, note, created_at, updated_at FROM ${TABLES.CONTACTS} WHERE id = ?`,
    [id]
  )
  return rows[0] ? mapContactRow(rows[0]) : null
}

/** 创建借还对象，返回 id */
export async function createContact(name: string, note?: string): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  await db.execute(
    `INSERT INTO ${TABLES.CONTACTS} (id, name, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name.trim(), note?.trim() || null, t, t]
  )
  return id
}

/** 更新借还对象（传入的字段才修改） */
export async function updateContact(
  id: string,
  patch: { name?: string; note?: string | null }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  if (patch.name !== undefined) {
    sets.push('name = ?')
    params.push(patch.name.trim())
  }
  if (patch.note !== undefined) {
    sets.push('note = ?')
    params.push(patch.note?.trim() || null)
  }
  params.push(id)
  await db.execute(`UPDATE ${TABLES.CONTACTS} SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 删除借还对象（关联的借还记录 contact_id 置 NULL 保留） */
export async function deleteContact(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CONTACTS} WHERE id = ?`, [id])
}
