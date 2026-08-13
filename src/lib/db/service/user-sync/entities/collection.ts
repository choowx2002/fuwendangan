/**
 * 收藏实体：以 (card_no, card_no_extend) 变体为聚合，语言行行级 LWW + 墓碑 'collection'。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import { Snowflake } from '@theinternetfolks/snowflake'
import { lwwWinner, type DbLike } from './common'
import type { SyncCollection, SyncCollectionLang, SyncTombstone } from '../types'

export const COLLECTION_KEY_SEP = '|'
export const COLLECTION_TOMBSTONE = 'collection'

export function extractCollection(): Promise<SyncCollection[]> {
  return (async () => {
    const db = await getDatabase()
    const rows = (await db.select(
      `SELECT col.card_no AS card_no, col.card_no_extend AS card_no_extend,
         col.updated_at AS col_updated_at,
         cl.language_code AS language_code, cl.normal_qty AS normal_qty,
         cl.foil_qty AS foil_qty, cl.updated_at AS updated_at
       FROM ${TABLES.COLLECTION} col
       JOIN ${TABLES.COLLECTION_LANGS} cl ON cl.collection_id = col.id
       WHERE cl.normal_qty > 0 OR cl.foil_qty > 0
       ORDER BY col.card_no, col.card_no_extend, cl.language_code`
    )) as {
      card_no: string
      card_no_extend: string
      col_updated_at: string
      language_code: string
      normal_qty: number
      foil_qty: number
      updated_at: string
    }[]

    const variants = new Map<string, SyncCollection>()
    for (const r of rows) {
      const key = `${r.card_no}${COLLECTION_KEY_SEP}${r.card_no_extend}`
      let v = variants.get(key)
      if (!v) {
        v = {
          card_no: r.card_no,
          card_no_extend: r.card_no_extend,
          updated_at: r.col_updated_at ?? '',
          langs: [],
        }
        variants.set(key, v)
      }
      v.langs.push({
        language_code: r.language_code,
        normal_qty: r.normal_qty,
        foil_qty: r.foil_qty,
        updated_at: r.updated_at,
      })
      if (r.updated_at > v.updated_at) v.updated_at = r.updated_at
    }
    return [...variants.values()]
  })()
}

export function mergeCollection(opts: {
  local: SyncCollection[]
  remote: SyncCollection[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): { upsert: SyncCollection[]; deleteKeys: string[] } {
  const { local, remote, localTomb, remoteTomb, localDeviceId, remoteDeviceId, live } = opts
  const localMap = new Map(
    local.map((c) => [`${c.card_no}${COLLECTION_KEY_SEP}${c.card_no_extend}`, c])
  )
  const remoteMap = new Map(
    remote.map((c) => [`${c.card_no}${COLLECTION_KEY_SEP}${c.card_no_extend}`, c])
  )
  const keys = new Set([...localMap.keys(), ...remoteMap.keys()])
  const upsert: SyncCollection[] = []
  const deleteKeys: string[] = []

  for (const key of keys) {
    const l = localMap.get(key)
    const r = remoteMap.get(key)
    const localT = localTomb.get(key)?.updated_at
    const remoteT = remoteTomb.get(key)?.updated_at
    const maxEntity = [l?.updated_at, r?.updated_at].filter(Boolean).sort().pop() as
      string | undefined

    if (remoteT && (!maxEntity || remoteT > maxEntity)) {
      if (l) deleteKeys.push(key)
      continue
    }
    if (localT && (!maxEntity || localT > maxEntity)) {
      if (l) deleteKeys.push(key)
      continue
    }
    if (!r) {
      if (l) live.set(key, l.updated_at)
      continue
    }

    const localLangs = new Map(l?.langs.map((x) => [x.language_code, x]) ?? [])
    const remoteLangs = new Map(r.langs.map((x) => [x.language_code, x]))
    const mergedLangs: SyncCollectionLang[] = []
    const langCodes = new Set([...localLangs.keys(), ...remoteLangs.keys()])
    for (const code of langCodes) {
      const localLang = localLangs.get(code)
      const remoteLang = remoteLangs.get(code)
      const winner = lwwWinner(
        localLang?.updated_at,
        remoteLang?.updated_at,
        localDeviceId,
        remoteDeviceId
      )
      const chosen = winner === 'remote' ? remoteLang : localLang
      if (chosen) mergedLangs.push(chosen)
    }

    if (mergedLangs.length === 0) {
      if (l) deleteKeys.push(key)
      continue
    }

    const variantUpdated = mergedLangs.reduce(
      (max, x) => (x.updated_at > max ? x.updated_at : max),
      ''
    )
    upsert.push({
      card_no: r.card_no,
      card_no_extend: r.card_no_extend,
      updated_at: variantUpdated,
      langs: mergedLangs,
    })
    live.set(key, variantUpdated)
  }
  return { upsert, deleteKeys }
}

function deriveSeriesCode(cardNoExtend: string): string {
  return cardNoExtend.toUpperCase().slice(0, 3)
}

/** 写回单个收藏变体（upsert collection 行 + 语言行，保留 winner 时间戳） */
async function upsertCollectionVariant(db: DbLike, col: SyncCollection): Promise<void> {
  const exists = (await db.select(
    `SELECT id FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`,
    [col.card_no, col.card_no_extend]
  )) as { id: string }[]
  let collectionId: string
  if (exists[0]?.id) {
    collectionId = exists[0].id
    await db.execute(
      `UPDATE ${TABLES.COLLECTION}
       SET series_code = COALESCE(series_code, ?), updated_at = ?, last_edited_at = ? WHERE id = ?`,
      [deriveSeriesCode(col.card_no_extend), col.updated_at, col.updated_at, collectionId]
    )
  } else {
    collectionId = Snowflake.generate()
    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION}
       (id, card_no, card_no_extend, series_code, last_edited_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        collectionId,
        col.card_no,
        col.card_no_extend,
        deriveSeriesCode(col.card_no_extend),
        col.updated_at,
        col.updated_at,
        col.updated_at,
      ]
    )
  }

  for (const lang of col.langs) {
    if (lang.normal_qty <= 0 && lang.foil_qty <= 0) continue
    const lrow = (await db.select(
      `SELECT id FROM ${TABLES.COLLECTION_LANGS} WHERE collection_id = ? AND language_code = ?`,
      [collectionId, lang.language_code]
    )) as { id: string }[]
    if (lrow[0]?.id) {
      await db.execute(
        `UPDATE ${TABLES.COLLECTION_LANGS}
         SET normal_qty = ?, foil_qty = ?, status = 'owned', updated_at = ? WHERE id = ?`,
        [lang.normal_qty, lang.foil_qty, lang.updated_at, lrow[0].id]
      )
    } else {
      await db.execute(
        `INSERT INTO ${TABLES.COLLECTION_LANGS}
         (id, collection_id, language_code, status, normal_qty, foil_qty, created_at, updated_at)
         VALUES (?, ?, ?, 'owned', ?, ?, ?, ?)`,
        [
          Snowflake.generate(),
          collectionId,
          lang.language_code,
          lang.normal_qty,
          lang.foil_qty,
          lang.updated_at,
          lang.updated_at,
        ]
      )
    }
  }
}

export async function applyCollection(
  db: DbLike,
  upsert: SyncCollection[],
  deleteKeys: string[]
): Promise<void> {
  for (const key of deleteKeys) {
    const sep = key.indexOf(COLLECTION_KEY_SEP)
    const cardNo = key.slice(0, sep)
    const cardNoExtend = key.slice(sep + 1)
    await db.execute(`DELETE FROM ${TABLES.COLLECTION} WHERE card_no = ? AND card_no_extend = ?`, [
      cardNo,
      cardNoExtend,
    ])
  }
  for (const col of upsert) {
    await upsertCollectionVariant(db, col)
  }
}
