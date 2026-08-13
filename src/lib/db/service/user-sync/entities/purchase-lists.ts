/**
 * 购买清单实体：实体聚合（头 LWW + 条目行级 LWW + 墓碑 'purchase_list'）。
 * 头按 purchase_lists.id 实体 LWW；条目按 (list_id, card_no, card_no_extend, language_pref, finish_pref)
 * 行级 LWW 做并集合并（纯合并不删除单条目，除非整单被墓碑删除）。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import type { SyncPurchaseList, SyncPurchaseListItem, SyncTombstone } from '../types'
import { lwwWinner, existsIn, type DbLike, type MergeResult } from './common'

const ITEM_SEP = '|'
function itemKey(i: SyncPurchaseListItem): string {
  return [i.card_no, i.card_no_extend, i.language_pref, i.finish_pref].join(ITEM_SEP)
}

export function extractPurchaseLists(): Promise<SyncPurchaseList[]> {
  return (async () => {
    const db = await getDatabase()
    const headers = (await db.select(`SELECT * FROM ${TABLES.PURCHASE_LISTS}`)) as Record<
      string,
      unknown
    >[]
    const items = (await db.select(`SELECT * FROM ${TABLES.PURCHASE_LIST_ITEMS}`)) as Record<
      string,
      unknown
    >[]
    const byList = new Map<string, SyncPurchaseListItem[]>()
    for (const r of items) {
      const listId = String(r.list_id)
      const item: SyncPurchaseListItem = {
        id: String(r.id),
        card_no: String(r.card_no),
        card_no_extend: String(r.card_no_extend),
        collection_id: (r.collection_id as string) ?? null,
        language_pref: String(r.language_pref ?? 'SC'),
        finish_pref: String(r.finish_pref ?? 'any'),
        qty_required: Number(r.qty_required ?? 0),
        qty_owned: Number(r.qty_owned ?? 0),
        qty_to_buy: Number(r.qty_to_buy ?? 0),
        qty_ordered: Number(r.qty_ordered ?? 0),
        qty_borrowed: Number(r.qty_borrowed ?? 0),
        qty_bought: Number(r.qty_bought ?? 0),
        status: String(r.status ?? 'pending'),
        created_at: (r.created_at as string) ?? null,
        updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
      }
      const list = byList.get(listId)
      if (list) list.push(item)
      else byList.set(listId, [item])
    }
    return headers.map((r) => {
      const id = String(r.id)
      return {
        id,
        name: String(r.name ?? ''),
        deck_id: (r.deck_id as string) ?? null,
        deck_version_id: (r.deck_version_id as string) ?? null,
        status: String(r.status ?? 'open'),
        created_at: (r.created_at as string) ?? null,
        updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
        items: byList.get(id) ?? [],
      }
    })
  })()
}

function mergeItems(
  local: SyncPurchaseListItem[],
  remote: SyncPurchaseListItem[],
  localDeviceId: string,
  remoteDeviceId: string
): SyncPurchaseListItem[] {
  const localMap = new Map(local.map((i) => [itemKey(i), i]))
  const remoteMap = new Map(remote.map((i) => [itemKey(i), i]))
  const keys = new Set([...localMap.keys(), ...remoteMap.keys()])
  const merged: SyncPurchaseListItem[] = []
  for (const key of keys) {
    const l = localMap.get(key)
    const r = remoteMap.get(key)
    const winner = lwwWinner(l?.updated_at, r?.updated_at, localDeviceId, remoteDeviceId)
    const chosen = winner === 'remote' ? r : l
    if (chosen) merged.push(chosen)
  }
  return merged
}

export function mergePurchaseLists(opts: {
  local: SyncPurchaseList[]
  remote: SyncPurchaseList[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncPurchaseList> {
  const { local, remote, localTomb, remoteTomb, localDeviceId, remoteDeviceId, live } = opts
  const localMap = new Map(local.map((e) => [e.id, e]))
  const remoteMap = new Map(remote.map((e) => [e.id, e]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])
  const upsert: SyncPurchaseList[] = []
  const deleteIds: string[] = []

  for (const id of ids) {
    const l = localMap.get(id)
    const r = remoteMap.get(id)
    const localT = localTomb.get(id)?.updated_at
    const remoteT = remoteTomb.get(id)?.updated_at
    const maxEntity = [l?.updated_at, r?.updated_at].filter(Boolean).sort().pop() as
      string | undefined

    if (remoteT && (!maxEntity || remoteT > maxEntity)) {
      if (l) deleteIds.push(id)
      continue
    }
    if (localT && (!maxEntity || localT > maxEntity)) {
      if (l) deleteIds.push(id)
      continue
    }
    if (!r) {
      if (l) live.set(id, l.updated_at)
      continue
    }
    if (!l) {
      upsert.push(r)
      live.set(id, r.updated_at)
      continue
    }
    const winner = lwwWinner(l.updated_at, r.updated_at, localDeviceId, remoteDeviceId)
    const header = winner === 'remote' ? r : l
    upsert.push({
      ...header,
      items: mergeItems(l.items, r.items, localDeviceId, remoteDeviceId),
    })
    live.set(id, header.updated_at)
  }
  return { upsert, deleteIds }
}

export async function applyPurchaseLists(
  db: DbLike,
  upsert: SyncPurchaseList[],
  deleteIds: string[]
): Promise<void> {
  for (const id of deleteIds) {
    await db.execute(`DELETE FROM ${TABLES.PURCHASE_LISTS} WHERE id = ?`, [id])
  }
  for (const p of upsert) {
    let deckId = p.deck_id
    if (deckId && !(await existsIn(db, TABLES.DECKS, deckId))) deckId = null
    let deckVersionId = p.deck_version_id
    if (deckVersionId && !(await existsIn(db, TABLES.DECK_VERSIONS, deckVersionId)))
      deckVersionId = null

    await db.execute(
      `INSERT INTO ${TABLES.PURCHASE_LISTS} (id, name, deck_id, deck_version_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, deck_id = excluded.deck_id, deck_version_id = excluded.deck_version_id,
         status = excluded.status, updated_at = excluded.updated_at`,
      [p.id, p.name, deckId, deckVersionId, p.status, p.created_at, p.updated_at]
    )

    for (const item of p.items) {
      await db.execute(
        `INSERT INTO ${TABLES.PURCHASE_LIST_ITEMS}
         (id, list_id, card_no, card_no_extend, collection_id, language_pref, finish_pref,
          qty_required, qty_owned, qty_to_buy, qty_ordered, qty_borrowed, qty_bought,
          status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(list_id, card_no, card_no_extend, language_pref, finish_pref) DO UPDATE SET
           id = excluded.id, collection_id = excluded.collection_id,
           qty_required = excluded.qty_required, qty_owned = excluded.qty_owned,
           qty_to_buy = excluded.qty_to_buy, qty_ordered = excluded.qty_ordered,
           qty_borrowed = excluded.qty_borrowed, qty_bought = excluded.qty_bought,
           status = excluded.status, updated_at = excluded.updated_at`,
        [
          item.id,
          p.id,
          item.card_no,
          item.card_no_extend,
          item.collection_id,
          item.language_pref,
          item.finish_pref,
          item.qty_required,
          item.qty_owned,
          item.qty_to_buy,
          item.qty_ordered,
          item.qty_borrowed,
          item.qty_bought,
          item.status,
          item.created_at,
          item.updated_at,
        ]
      )
    }
  }
}
