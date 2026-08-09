/**
 * 收藏编辑规则（纯函数，无 DB/SQL 依赖）
 * 删除/状态判定集中于此，仓储层只负责调用。
 */

import type { CollectionLang, CollectionStatus } from '../types'

export const COLLECTION_STATUSES: readonly CollectionStatus[] = ['owned', 'wishlist', 'ordered']

/** 任一数量 > 0 时状态自动提升为 owned */
export function resolveStatus(
  status: CollectionStatus,
  normalQty: number,
  foilQty: number
): CollectionStatus {
  if (normalQty > 0 || foilQty > 0) return 'owned'
  return status
}

/** owned 双零 → 删语言行；wishlist/ordered 双零 → 保留行（状态仍记录） */
export function shouldKeepLangRow(
  status: CollectionStatus,
  normalQty: number,
  foilQty: number
): boolean {
  if (normalQty > 0 || foilQty > 0) return true
  return status !== 'owned'
}

/** 卡牌无任何语言行 → 删除卡牌行 */
export function shouldDeleteVariant(
  langs: Pick<CollectionLang, 'status' | 'normal_qty' | 'foil_qty'>[]
): boolean {
  return langs.length === 0
}
