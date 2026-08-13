/**
 * Sync Bundle 序列化 / 反序列化 + 校验（传输无关）
 * - 单文件 JSON，带 schema 版本头（对齐 docs/player-data-sync.md §6）。
 * - 校验和：FNV-1a 32（同步、零依赖），目的为截断/损坏检测，非加密。
 */

import { getOrCreateDeviceId } from './state'
import { SYNC_SCHEMA, SYNC_VERSION } from './types'
import type { SyncBundle, SyncBundleBody } from './types'

/** FNV-1a 32 位散列（hex，8 位） */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 数据体校验和（供 push 去重：内容未变则跳过上行，省带宽/请求） */
export function computeBodyChecksum(body: SyncBundleBody): string {
  return fnv1a(JSON.stringify(body))
}

/** 由数据体生成完整 Bundle（含头 + 校验和） */
export async function createBundle(body: SyncBundleBody, deviceName: string): Promise<SyncBundle> {
  const deviceId = await getOrCreateDeviceId()
  const checksum = computeBodyChecksum(body)
  return {
    schema: SYNC_SCHEMA,
    version: SYNC_VERSION,
    device: { id: deviceId, name: deviceName },
    generatedAt: new Date().toISOString(),
    checksum,
    ...body,
  }
}

/** 解析并校验 Bundle JSON；失败抛 Error（信息面向用户） */
export function parseBundle(text: string): SyncBundle {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('同步包不是有效的 JSON 文件')
  }
  const bundle = raw as Partial<SyncBundle>
  if (bundle.schema !== SYNC_SCHEMA) {
    throw new Error('同步包 schema 不匹配，无法识别')
  }
  if (bundle.version !== SYNC_VERSION) {
    throw new Error(`同步包版本不兼容（期望 v${SYNC_VERSION}，实际 v${bundle.version}）`)
  }
  const entities = bundle.entities as Partial<SyncBundle['entities']> | undefined
  if (!entities || typeof entities !== 'object') {
    throw new Error('同步包缺少实体数据')
  }
  const tombstones = Array.isArray(bundle.tombstones) ? bundle.tombstones : []

  // 归一化：缺省实体数组默认空（兼容旧版本 Phase 1 bundle）
  const body: SyncBundleBody = {
    entities: {
      decks: Array.isArray(entities.decks) ? entities.decks : [],
      collection: Array.isArray(entities.collection) ? entities.collection : [],
      wishlist: Array.isArray(entities.wishlist) ? entities.wishlist : [],
      loans: Array.isArray(entities.loans) ? entities.loans : [],
      contacts: Array.isArray(entities.contacts) ? entities.contacts : [],
      purchaseLists: Array.isArray(entities.purchaseLists) ? entities.purchaseLists : [],
      matches: Array.isArray(entities.matches) ? entities.matches : [],
      lockers: Array.isArray(entities.lockers) ? entities.lockers : [],
      customPrints: Array.isArray(entities.customPrints) ? entities.customPrints : [],
      settings: Array.isArray(entities.settings) ? entities.settings : [],
    },
    tombstones,
  }
  if (fnv1a(JSON.stringify(body)) !== bundle.checksum) {
    throw new Error('同步包校验和不匹配，文件可能已损坏')
  }

  return {
    schema: bundle.schema,
    version: bundle.version,
    device: bundle.device ?? { id: '', name: '' },
    generatedAt: bundle.generatedAt ?? '',
    checksum: bundle.checksum ?? '',
    ...body,
  }
}
