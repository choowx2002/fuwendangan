/**
 * 卡组实体：实体聚合（头 + 全部版本 + 版本卡牌），LWW + 墓碑 'deck'。
 * 写回保留 deck/version id，卡牌按 print_code 解析存活打印 id。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import {
  getDecks,
  getDeckVersions,
  getDeckCardsByVersion,
} from '../../../repository/deck-repository'
import { serializeTags } from '../../../helper'
import { Snowflake } from '@theinternetfolks/snowflake'
import { mergeById, type DbLike, type MergeResult } from './common'
import type { SyncDeck, SyncTombstone } from '../types'

export const DECK_TOMBSTONE = 'deck'

export function extractDecks(): Promise<SyncDeck[]> {
  return (async () => {
    const decks = await getDecks()
    const result: SyncDeck[] = []
    for (const deck of decks) {
      const versions = await getDeckVersions(deck.id)
      const syncVersions = []
      for (const v of versions) {
        const cards = await getDeckCardsByVersion(v.id)
        syncVersions.push({
          id: v.id,
          version_number: v.version_number,
          note: v.note,
          created_at: v.created_at,
          cards: cards.map((c) => ({
            id: c.id,
            card_id: c.card_id,
            print_code: c.print_code ?? null,
            quantity: c.quantity,
            zone: c.zone,
            created_at: c.created_at,
          })),
        })
      }
      result.push({
        id: deck.id,
        name: deck.name,
        description: deck.description,
        format: deck.format,
        cover_image: deck.cover_image,
        tags: deck.tags,
        is_favorite: deck.is_favorite as unknown as boolean | number,
        created_at: deck.created_at,
        updated_at: deck.updated_at ?? deck.created_at ?? new Date().toISOString(),
        versions: syncVersions,
      })
    }
    return result
  })()
}

export function mergeDecks(opts: {
  local: SyncDeck[]
  remote: SyncDeck[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncDeck> {
  return mergeById(opts)
}

/** 构建 print_code → 存活 card_prints.id 映射（SC 优先） */
export async function buildPrintCodeResolution(db: DbLike): Promise<Map<string, string>> {
  const rows = (await db.select(
    `SELECT id, card_no_extend, language FROM ${TABLES.CARD_PRINTS}
     ORDER BY (language = 'SC') DESC, print_order ASC`
  )) as { id: string; card_no_extend: string | null; language: string | null }[]
  const map = new Map<string, string>()
  for (const r of rows) {
    if (!r.card_no_extend || map.has(r.card_no_extend)) continue
    map.set(r.card_no_extend, r.id)
  }
  return map
}

/** 写回单个卡组实体（保留 deck/version id，卡牌按 print_code 解析存活打印 id） */
async function upsertDeckEntity(
  db: DbLike,
  deck: SyncDeck,
  resolution: Map<string, string>
): Promise<number> {
  const t = deck.updated_at
  const exists = (await db.select(`SELECT id FROM ${TABLES.DECKS} WHERE id = ?`, [deck.id])) as {
    id: string
  }[]
  if (exists[0]?.id) {
    await db.execute(
      `UPDATE ${TABLES.DECKS}
       SET name = ?, description = ?, format = ?, cover_image = ?, tags = ?, is_favorite = ?, updated_at = ?
       WHERE id = ?`,
      [
        deck.name,
        deck.description ?? null,
        deck.format ?? null,
        deck.cover_image ?? null,
        serializeTags(deck.tags),
        deck.is_favorite ? 1 : 0,
        t,
        deck.id,
      ]
    )
  } else {
    await db.execute(
      `INSERT INTO ${TABLES.DECKS}
       (id, name, description, format, cover_image, tags, is_favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deck.id,
        deck.name,
        deck.description ?? null,
        deck.format ?? null,
        deck.cover_image ?? null,
        serializeTags(deck.tags),
        deck.is_favorite ? 1 : 0,
        deck.created_at ?? t,
        t,
      ]
    )
  }

  await db.execute(`DELETE FROM ${TABLES.DECK_VERSIONS} WHERE deck_id = ?`, [deck.id])

  let missing = 0
  const seenNumbers = new Set<number>()
  for (const v of deck.versions) {
    if (seenNumbers.has(v.version_number)) continue
    seenNumbers.add(v.version_number)
    await db.execute(
      `INSERT INTO ${TABLES.DECK_VERSIONS} (id, deck_id, version_number, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [v.id, deck.id, v.version_number, v.note ?? null, v.created_at]
    )

    const groups = new Map<string, SyncDeck['versions'][number]['cards'][number]>()
    for (const c of v.cards) {
      if (!c.zone || c.quantity <= 0) continue
      const resolvedId = c.print_code ? resolution.get(c.print_code) : undefined
      if (!resolvedId) {
        missing++
        continue
      }
      const gkey = `${c.zone}|${resolvedId}`
      const prev = groups.get(gkey)
      if (prev) prev.quantity += c.quantity
      else groups.set(gkey, { ...c, card_id: resolvedId })
    }
    for (const card of groups.values()) {
      await db.execute(
        `INSERT INTO ${TABLES.DECK_CARDS}
         (id, deck_version_id, card_id, print_code, quantity, zone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          Snowflake.generate(),
          v.id,
          card.card_id,
          card.print_code ?? null,
          card.quantity,
          card.zone,
          card.created_at ?? t,
        ]
      )
    }
  }
  return missing
}

export async function applyDecks(
  db: DbLike,
  upsert: SyncDeck[],
  deleteIds: string[]
): Promise<number> {
  for (const id of deleteIds) {
    await db.execute(`DELETE FROM ${TABLES.DECKS} WHERE id = ?`, [id])
  }
  const resolution = await buildPrintCodeResolution(db)
  let missing = 0
  for (const deck of upsert) {
    missing += await upsertDeckEntity(db, deck, resolution)
  }
  return missing
}
