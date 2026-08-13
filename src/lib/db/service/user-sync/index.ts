/**
 * 玩家数据同步编排入口（传输无关：Bundle 全实体 + Supabase BYO）
 * - export：提取本地实体 + 墓碑 → 生成 Bundle JSON 文本。
 * - import：解析校验 → 与本地合并（LWW + 墓碑）→ withTransaction 写回 →
 *   重链卡组引用 / 清理孤儿收藏 / 刷新进度快照 → 更新 last_sync。
 * - Supabase：pull（远端 body）→ mergeRemoteBody → 重提取 → push（校验和去重跳过未变上行）。
 * 文件读写由调用方负责（桌面走 db-file-service，Web 走 Blob），本层只处理数据体。
 */

import { extractSyncBody, buildSyncWritePlan, applySyncPlan } from './engine'
import { createBundle, parseBundle, computeBodyChecksum } from './bundle'
import { getOrCreateDeviceId, getLastSync, setLastSync } from './state'
import { getSyncMeta, setSyncMeta } from '../../repository/sync-repository'
import { repointDeckCardReferences } from '../../repository/deck-repository'
import { cleanupOrphans } from '../../repository/collection-repository'
import { captureCollectionSnapshot } from '../../repository/collection-snapshot-repository'
import {
  fetchRemoteBody,
  pushBody,
  getSupabaseUser,
  signInSupabase,
  signOutSupabase,
  testSupabaseConnection,
  buildSupabaseCreateTableSql,
} from './supabase-transport'
import type { ApplyResult } from './engine'
import type { SyncBundleBody } from './types'

export {
  getSupabaseUser,
  signInSupabase,
  signOutSupabase,
  testSupabaseConnection,
  buildSupabaseCreateTableSql,
  parseBundle,
}

export const SUPABASE_LAST_PUSH_CHECKSUM = 'supabase_last_push_checksum'

export interface SyncExportInfo {
  deckCount: number
  collectionCount: number
  tombstoneCount: number
}

export interface SyncImportResult extends ApplyResult {
  remoteDeviceId: string
  remoteDeviceName: string
}

/** 提取当前设备全部同步实体并生成 Bundle JSON 文本 */
export async function buildSyncBundleText(deviceName: string): Promise<string> {
  const body = await extractSyncBody()
  const bundle = await createBundle(body, deviceName)
  return JSON.stringify(bundle, null, 2)
}

/**
 * 把远端数据体合并进本地（LWW + 墓碑），随后清理孤儿/重链/刷新快照/更新 last_sync。
 * 供 Bundle 导入与 Supabase 同步共用。
 */
export async function mergeRemoteBody(
  remote: SyncBundleBody,
  remoteDeviceId: string
): Promise<SyncImportResult> {
  const local = await extractSyncBody()
  const localDeviceId = await getOrCreateDeviceId()

  const plan = buildSyncWritePlan({ local, remote, localDeviceId, remoteDeviceId })
  const applied = await applySyncPlan(plan)

  // 内容引用重链 / 孤儿清理 / 进度快照（事务外，走全局串行队列）
  await repointDeckCardReferences()
  await cleanupOrphans()
  void captureCollectionSnapshot('auto')

  await setLastSync(new Date().toISOString())

  return { ...applied, remoteDeviceId, remoteDeviceName: '' }
}

/** 从 Bundle 文本导入并合并（幂等：行级 upsert 按稳定键，重复导入不产生重复行） */
export async function importSyncBundleText(
  text: string,
  deviceName: string
): Promise<SyncImportResult> {
  const bundle = parseBundle(text)
  const result = await mergeRemoteBody(
    { entities: bundle.entities, tombstones: bundle.tombstones },
    bundle.device.id
  )
  result.remoteDeviceName = bundle.device.name
  return result
}

/** 同步状态（设置页展示 last_sync） */
export async function getSyncStatus(): Promise<{ lastSync: string | null }> {
  return { lastSync: await getLastSync() }
}

/**
 * Supabase BYO 一键同步：pull → merge → 重提取 → push（校验和去重）。
 * 首次（云端无数据）直接 push 本机全量。
 */
export async function syncViaSupabase(): Promise<SyncImportResult> {
  const localDeviceId = await getOrCreateDeviceId()
  const remote = await fetchRemoteBody()

  let applied: ApplyResult | null = null
  if (remote.body) {
    applied = await mergeRemoteBody(remote.body, remote.remoteDeviceId ?? '')
  }

  const merged = await extractSyncBody()
  const checksum = computeBodyChecksum(merged)
  const lastPushed = await getSyncMeta(SUPABASE_LAST_PUSH_CHECKSUM)
  if (checksum !== lastPushed) {
    await pushBody(merged, localDeviceId)
    await setSyncMeta(SUPABASE_LAST_PUSH_CHECKSUM, checksum)
  }

  await setLastSync(new Date().toISOString())

  return {
    ...(applied ?? {
      missingCards: 0,
      deletedDecks: 0,
      upsertedDecks: 0,
      deletedVariants: 0,
      upsertedVariants: 0,
      upsertedWishlist: 0,
      upsertedLoans: 0,
      upsertedContacts: 0,
      upsertedPurchaseLists: 0,
      upsertedMatches: 0,
      upsertedLockers: 0,
      upsertedCustomPrints: 0,
      appliedSettings: 0,
      skippedMatches: 0,
    }),
    remoteDeviceId: remote.remoteDeviceId ?? '',
    remoteDeviceName: '',
  }
}
