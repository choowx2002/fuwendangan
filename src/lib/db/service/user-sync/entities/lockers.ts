/**
 * 卡柜实体：实体聚合（key = lockers.id，含隔间 + 卡牌），LWW + 墓碑 'locker'。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import { parseTags, serializeTags } from '../../../helper'
import type { SyncLocker, SyncLockerCard, SyncLockerSection, SyncTombstone } from '../types'
import { mergeById, type DbLike, type MergeResult } from './common'

export function extractLockers(): Promise<SyncLocker[]> {
  return (async () => {
    const db = await getDatabase()
    const headers = (await db.select(`SELECT * FROM ${TABLES.LOCKERS}`)) as Record<
      string,
      unknown
    >[]
    const sections = (await db.select(`SELECT * FROM ${TABLES.LOCKER_SECTIONS}`)) as Record<
      string,
      unknown
    >[]
    const cards = (await db.select(`SELECT * FROM ${TABLES.LOCKER_CARDS}`)) as Record<
      string,
      unknown
    >[]
    const cardBySection = new Map<string, SyncLockerCard[]>()
    for (const r of cards) {
      const sectionId = String(r.section_id)
      const card: SyncLockerCard = {
        id: String(r.id),
        card_no: String(r.card_no),
        card_no_extend: (r.card_no_extend as string) ?? null,
        language: (r.language as string) ?? null,
        quantity: Number(r.quantity ?? 1),
        note: (r.note as string) ?? null,
        created_at: (r.created_at as string) ?? null,
        updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
      }
      const list = cardBySection.get(sectionId)
      if (list) list.push(card)
      else cardBySection.set(sectionId, [card])
    }
    const sectionByLocker = new Map<string, SyncLockerSection[]>()
    for (const r of sections) {
      const lockerId = String(r.locker_id)
      const section: SyncLockerSection = {
        id: String(r.id),
        name: (r.name as string) ?? null,
        description: (r.description as string) ?? null,
        color: (r.color as string) ?? null,
        icon: (r.icon as string) ?? null,
        tags: parseTags((r.tags as string) ?? null),
        sort_order: Number(r.sort_order ?? 0),
        created_at: (r.created_at as string) ?? null,
        updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
        cards: cardBySection.get(String(r.id)) ?? [],
      }
      const list = sectionByLocker.get(lockerId)
      if (list) list.push(section)
      else sectionByLocker.set(lockerId, [section])
    }
    return headers.map((r) => {
      const id = String(r.id)
      return {
        id,
        name: String(r.name ?? ''),
        description: (r.description as string) ?? null,
        is_favorite: (r.is_favorite as boolean | number) ?? 0,
        icon: (r.icon as string) ?? null,
        tags: parseTags((r.tags as string) ?? null),
        created_at: (r.created_at as string) ?? null,
        updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
        sections: sectionByLocker.get(id) ?? [],
      }
    })
  })()
}

export function mergeLockers(opts: {
  local: SyncLocker[]
  remote: SyncLocker[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncLocker> {
  return mergeById(opts)
}

export async function applyLockers(
  db: DbLike,
  upsert: SyncLocker[],
  deleteIds: string[]
): Promise<void> {
  for (const id of deleteIds) {
    await db.execute(`DELETE FROM ${TABLES.LOCKERS} WHERE id = ?`, [id])
  }
  for (const l of upsert) {
    await db.execute(
      `INSERT INTO ${TABLES.LOCKERS} (id, name, description, is_favorite, icon, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description,
         is_favorite = excluded.is_favorite, icon = excluded.icon,
         tags = excluded.tags, updated_at = excluded.updated_at`,
      [
        l.id,
        l.name,
        l.description,
        l.is_favorite ? 1 : 0,
        l.icon,
        serializeTags(l.tags),
        l.created_at,
        l.updated_at,
      ]
    )

    await db.execute(`DELETE FROM ${TABLES.LOCKER_SECTIONS} WHERE locker_id = ?`, [l.id])
    for (const s of l.sections) {
      await db.execute(
        `INSERT INTO ${TABLES.LOCKER_SECTIONS}
         (id, locker_id, name, description, color, icon, tags, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          l.id,
          s.name,
          s.description,
          s.color,
          s.icon,
          serializeTags(s.tags),
          s.sort_order,
          s.created_at,
          s.updated_at,
        ]
      )
      for (const c of s.cards) {
        await db.execute(
          `INSERT INTO ${TABLES.LOCKER_CARDS}
           (id, section_id, card_no, card_no_extend, language, quantity, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.id,
            s.id,
            c.card_no,
            c.card_no_extend,
            c.language,
            c.quantity,
            c.note,
            c.created_at,
            c.updated_at,
          ]
        )
      }
    }
  }
}
