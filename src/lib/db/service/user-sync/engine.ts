/**
 * 玩家数据同步合并引擎（传输无关核心）
 * - 实体提取：从本地库抽取全部同步实体（decks / collection / wishlist / loans / contacts /
 *   purchaseLists / matches / lockers / customPrints / settings / tombstones）。
 * - LWW 合并：同键比较 updated_at，相等按 deviceId 字典序大者胜（确定性决胜）。
 * - 墓碑应用：墓碑.updated_at > 实体.updated_at → 删除；实体.updated_at > 墓碑 → 复活。
 * - 写回：withTransaction 内直接 SQL（FK ON，依赖级联与写序），保留 winner 的 updated_at。
 */

import { getDatabase, withTransaction } from '../../repository/database'
import { TABLES } from '../../config/constants'
import { getAllTombstones } from '../../repository/sync-repository'
import { buildTombstoneMap } from './entities/common'
import { DECK_TOMBSTONE, extractDecks, mergeDecks, applyDecks } from './entities/decks'
import {
  COLLECTION_TOMBSTONE,
  extractCollection,
  mergeCollection,
  applyCollection,
} from './entities/collection'
import { extractContacts, mergeContacts, applyContacts } from './entities/contacts'
import { extractLoans, mergeLoans, applyLoans } from './entities/loans'
import { extractWishlist, mergeWishlist, applyWishlist } from './entities/wishlist'
import {
  extractPurchaseLists,
  mergePurchaseLists,
  applyPurchaseLists,
} from './entities/purchase-lists'
import { extractMatches, mergeMatches, applyMatches } from './entities/matches'
import { extractLockers, mergeLockers, applyLockers } from './entities/lockers'
import { extractCustomPrints, mergeCustomPrints, applyCustomPrints } from './entities/custom-prints'
import { extractSettings, mergeSettings, applySettings } from './entities/settings'
import type {
  SyncBundleBody,
  SyncCollection,
  SyncContact,
  SyncCustomPrint,
  SyncDeck,
  SyncEntityType,
  SyncLoan,
  SyncLocker,
  SyncMatch,
  SyncPurchaseList,
  SyncSetting,
  SyncTombstone,
  SyncWishlist,
} from './types'

/** 全部受管墓碑类型（除 settings 无墓碑） */
const ALL_TOMBSTONE_TYPES: SyncEntityType[] = [
  DECK_TOMBSTONE,
  COLLECTION_TOMBSTONE,
  'wishlist',
  'loan',
  'contact',
  'purchase_list',
  'match',
  'locker',
  'custom_print',
]

/** 写回计划：合并后的最终落库操作 */
export interface SyncWritePlan {
  upsertDecks: SyncDeck[]
  deleteDeckIds: string[]
  upsertCollection: SyncCollection[]
  deleteCollectionKeys: string[]
  upsertWishlist: SyncWishlist[]
  deleteWishlistIds: string[]
  upsertLoans: SyncLoan[]
  deleteLoanIds: string[]
  upsertContacts: SyncContact[]
  deleteContactIds: string[]
  upsertPurchaseLists: SyncPurchaseList[]
  deletePurchaseListIds: string[]
  upsertMatches: SyncMatch[]
  deleteMatchIds: string[]
  upsertLockers: SyncLocker[]
  deleteLockerIds: string[]
  upsertCustomPrints: SyncCustomPrint[]
  deleteCustomPrintIds: string[]
  settings: SyncSetting[]
  finalTombstones: SyncTombstone[]
}

export interface MergeInput {
  local: SyncBundleBody
  remote: SyncBundleBody
  localDeviceId: string
  remoteDeviceId: string
}

export interface ApplyResult {
  missingCards: number
  deletedDecks: number
  upsertedDecks: number
  deletedVariants: number
  upsertedVariants: number
  upsertedWishlist: number
  upsertedLoans: number
  upsertedContacts: number
  upsertedPurchaseLists: number
  upsertedMatches: number
  upsertedLockers: number
  upsertedCustomPrints: number
  appliedSettings: number
  skippedMatches: number
}

// ==================== 提取 ====================

/** 从本地库抽取全部同步实体 + 墓碑 */
export async function extractSyncBody(): Promise<SyncBundleBody> {
  // DEBUG: 逐实体提取并捕获失败点（老库缺列时定位是哪张表）
  const extractWithLog = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      console.error(`[SYNC] extract ${label} 失败:`, e)
      console.error(`[SYNC] extract ${label} 失败 string:`, e instanceof Error ? e.message : String(e))
      throw e
    }
  }
  const [
    decks,
    collection,
    wishlist,
    loans,
    contacts,
    purchaseLists,
    matches,
    lockers,
    customPrints,
    settings,
    tombstones,
  ] = await Promise.all([
    extractWithLog('decks', extractDecks),
    extractWithLog('collection', extractCollection),
    extractWithLog('wishlist', extractWishlist),
    extractWithLog('loans', extractLoans),
    extractWithLog('contacts', extractContacts),
    extractWithLog('purchaseLists', extractPurchaseLists),
    extractWithLog('matches', extractMatches),
    extractWithLog('lockers', extractLockers),
    extractWithLog('customPrints', extractCustomPrints),
    extractWithLog('settings', extractSettings),
    extractWithLog('tombstones', extractTombstones),
  ])
  return {
    entities: {
      decks,
      collection,
      wishlist,
      loans,
      contacts,
      purchaseLists,
      matches,
      lockers,
      customPrints,
      settings,
    },
    tombstones,
  }
}

/** 提取本地墓碑 */
export async function extractTombstones(): Promise<SyncTombstone[]> {
  const rows = await getAllTombstones()
  return rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type as SyncEntityType,
    entity_key: r.entity_key,
    updated_at: r.updated_at,
  }))
}

// ==================== LWW 合并 ====================

/** 计算合并写回计划（纯函数，不碰库） */
export function buildSyncWritePlan(input: MergeInput): SyncWritePlan {
  const { local, remote, localDeviceId, remoteDeviceId } = input

  const liveByType = new Map<string, Map<string, string>>()
  const getLive = (type: string): Map<string, string> => {
    let m = liveByType.get(type)
    if (!m) {
      m = new Map()
      liveByType.set(type, m)
    }
    return m
  }
  const tomb = (type: string) => ({
    localTomb: buildTombstoneMap(local.tombstones, type),
    remoteTomb: buildTombstoneMap(remote.tombstones, type),
  })

  const deckRes = mergeDecks({
    local: local.entities.decks,
    remote: remote.entities.decks,
    ...tomb(DECK_TOMBSTONE),
    localDeviceId,
    remoteDeviceId,
    live: getLive(DECK_TOMBSTONE),
  })
  const colRes = mergeCollection({
    local: local.entities.collection,
    remote: remote.entities.collection,
    ...tomb(COLLECTION_TOMBSTONE),
    localDeviceId,
    remoteDeviceId,
    live: getLive(COLLECTION_TOMBSTONE),
  })
  const wishlistRes = mergeWishlist({
    local: local.entities.wishlist,
    remote: remote.entities.wishlist,
    ...tomb('wishlist'),
    localDeviceId,
    remoteDeviceId,
    live: getLive('wishlist'),
  })
  const loanRes = mergeLoans({
    local: local.entities.loans,
    remote: remote.entities.loans,
    ...tomb('loan'),
    localDeviceId,
    remoteDeviceId,
    live: getLive('loan'),
  })
  const contactRes = mergeContacts({
    local: local.entities.contacts,
    remote: remote.entities.contacts,
    ...tomb('contact'),
    localDeviceId,
    remoteDeviceId,
    live: getLive('contact'),
  })
  const purchaseRes = mergePurchaseLists({
    local: local.entities.purchaseLists,
    remote: remote.entities.purchaseLists,
    ...tomb('purchase_list'),
    localDeviceId,
    remoteDeviceId,
    live: getLive('purchase_list'),
  })
  const matchRes = mergeMatches({
    local: local.entities.matches,
    remote: remote.entities.matches,
    ...tomb('match'),
    localDeviceId,
    remoteDeviceId,
    live: getLive('match'),
  })
  const lockerRes = mergeLockers({
    local: local.entities.lockers,
    remote: remote.entities.lockers,
    ...tomb('locker'),
    localDeviceId,
    remoteDeviceId,
    live: getLive('locker'),
  })
  const customRes = mergeCustomPrints({
    local: local.entities.customPrints,
    remote: remote.entities.customPrints,
    ...tomb('custom_print'),
    localDeviceId,
    remoteDeviceId,
    live: getLive('custom_print'),
  })
  const settings = mergeSettings({
    local: local.entities.settings,
    remote: remote.entities.settings,
    localDeviceId,
    remoteDeviceId,
  })

  // ---- 墓碑收敛：本地 ∪ 远端（每键取 max），被存活实体复活的丢弃 ----
  const tombCandidates = new Map<
    string,
    { type: SyncEntityType; key: string; tomb: SyncTombstone }
  >()
  const collect = (list: SyncTombstone[]) => {
    for (const t of list) {
      if (!ALL_TOMBSTONE_TYPES.includes(t.entity_type)) continue
      const mapKey = `${t.entity_type}|${t.entity_key}`
      const prev = tombCandidates.get(mapKey)
      if (!prev || t.updated_at > prev.tomb.updated_at)
        tombCandidates.set(mapKey, { type: t.entity_type, key: t.entity_key, tomb: t })
    }
  }
  collect(local.tombstones)
  collect(remote.tombstones)

  const finalTombstones: SyncTombstone[] = []
  for (const { type, key, tomb } of tombCandidates.values()) {
    const liveUpdated = liveByType.get(type)?.get(key)
    if (liveUpdated && liveUpdated >= tomb.updated_at) continue
    finalTombstones.push({
      id: tomb.id,
      entity_type: type,
      entity_key: key,
      updated_at: tomb.updated_at,
    })
  }

  return {
    upsertDecks: deckRes.upsert,
    deleteDeckIds: deckRes.deleteIds,
    upsertCollection: colRes.upsert,
    deleteCollectionKeys: colRes.deleteKeys,
    upsertWishlist: wishlistRes.upsert,
    deleteWishlistIds: wishlistRes.deleteIds,
    upsertLoans: loanRes.upsert,
    deleteLoanIds: loanRes.deleteIds,
    upsertContacts: contactRes.upsert,
    deleteContactIds: contactRes.deleteIds,
    upsertPurchaseLists: purchaseRes.upsert,
    deletePurchaseListIds: purchaseRes.deleteIds,
    upsertMatches: matchRes.upsert,
    deleteMatchIds: matchRes.deleteIds,
    upsertLockers: lockerRes.upsert,
    deleteLockerIds: lockerRes.deleteIds,
    upsertCustomPrints: customRes.upsert,
    deleteCustomPrintIds: customRes.deleteIds,
    settings,
    finalTombstones,
  }
}

// ==================== 写回 ====================

/** 应用写回计划（withTransaction 内；settings 事务外应用） */
export async function applySyncPlan(plan: SyncWritePlan): Promise<ApplyResult> {
  const result: ApplyResult = {
    missingCards: 0,
    deletedDecks: plan.deleteDeckIds.length,
    upsertedDecks: plan.upsertDecks.length,
    deletedVariants: plan.deleteCollectionKeys.length,
    upsertedVariants: plan.upsertCollection.length,
    upsertedWishlist: plan.upsertWishlist.length,
    upsertedLoans: plan.upsertLoans.length,
    upsertedContacts: plan.upsertContacts.length,
    upsertedPurchaseLists: plan.upsertPurchaseLists.length,
    upsertedMatches: plan.upsertMatches.length,
    upsertedLockers: plan.upsertLockers.length,
    upsertedCustomPrints: plan.upsertCustomPrints.length,
    appliedSettings: plan.settings.length,
    skippedMatches: 0,
  }

  await withTransaction(async () => {
    const db = await getDatabase()

    // 1. 收敛墓碑：清空受管类型墓碑后写入最终集合
    await db.execute(
      `DELETE FROM ${TABLES.SYNC_TOMBSTONES} WHERE entity_type IN (${ALL_TOMBSTONE_TYPES.map(() => '?').join(',')})`,
      ALL_TOMBSTONE_TYPES
    )
    for (const t of plan.finalTombstones) {
      await db.execute(
        `INSERT INTO ${TABLES.SYNC_TOMBSTONES} (id, entity_type, entity_key, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_key) DO UPDATE SET updated_at = excluded.updated_at`,
        [t.id, t.entity_type, t.entity_key, t.updated_at]
      )
    }
    console.log('[SYNC] 写回: 墓碑完成')

    // 2. 自定义打印先写（卡组写回需按 print_code 解析自定义打印）
    await applyCustomPrints(db, plan.upsertCustomPrints, plan.deleteCustomPrintIds)
    console.log('[SYNC] 写回: 自定义打印完成')

    // 3. 卡组
    result.missingCards += await applyDecks(db, plan.upsertDecks, plan.deleteDeckIds)
    console.log('[SYNC] 写回: 卡组完成')

    // 4. 收藏
    await applyCollection(db, plan.upsertCollection, plan.deleteCollectionKeys)
    console.log('[SYNC] 写回: 收藏完成')

    // 5. 联系人（借还外键依赖）
    await applyContacts(db, plan.upsertContacts, plan.deleteContactIds)
    console.log('[SYNC] 写回: 联系人完成')

    // 6. 借还
    await applyLoans(db, plan.upsertLoans, plan.deleteLoanIds)
    console.log('[SYNC] 写回: 借还完成')

    // 7. 心愿单
    await applyWishlist(db, plan.upsertWishlist, plan.deleteWishlistIds)
    console.log('[SYNC] 写回: 心愿单完成')

    // 8. 购买清单（卡组外键依赖）
    await applyPurchaseLists(db, plan.upsertPurchaseLists, plan.deletePurchaseListIds)
    console.log('[SYNC] 写回: 购买清单完成')

    // 9. 对局（卡组外键依赖；卡组不存在则跳过）
    result.skippedMatches += await applyMatches(db, plan.upsertMatches, plan.deleteMatchIds)
    console.log('[SYNC] 写回: 对局完成')

    // 10. 卡柜
    await applyLockers(db, plan.upsertLockers, plan.deleteLockerIds)
    console.log('[SYNC] 写回: 卡柜完成')
  })

  // 11. 设置（事务外写 store + 游标；失败不阻断已提交的合并）
  try {
    await applySettings(plan.settings)
  } catch {
    // 设置写回失败不阻断导入
  }

  return result
}
