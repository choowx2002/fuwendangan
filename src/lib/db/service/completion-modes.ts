/**
 * 收藏完成度模式注册表
 * 每种模式只描述规则（谓词），SQL 拼装由仓储/服务层负责；
 * 新增完成度模式 = 在此添加一条目，无需改写仓储层。
 *
 * 谓词约定：
 * - ownedPredicate：作用在 collection_langs 行（别名 cl）上的「已拥有」条件
 * - bucketPredicate：作用在变体桶（base/alt/overnum/rune/token）上的条件
 */

import type { CollectionLang, CompletionModeId } from '../types'
import type { VariantBucket } from '$lib/cards/utils/variant-utils'

type LangInfo = Pick<CollectionLang, 'status' | 'normal_qty' | 'foil_qty'>

export interface CompletionMode {
  id: CompletionModeId
  labelZh: string
  ownedPredicate: string | null
  bucketPredicate: string | null
  isOwned(lang: LangInfo, bucket: VariantBucket): boolean
}

const hasAny = (l: LangInfo) => l.status === 'owned' && (l.normal_qty > 0 || l.foil_qty > 0)

export const COMPLETION_MODES: Record<CompletionModeId, CompletionMode> = {
  base: {
    id: 'base',
    labelZh: '基础完成',
    ownedPredicate: `cl.status = 'owned' AND (cl.normal_qty > 0 OR cl.foil_qty > 0)`,
    bucketPredicate: null,
    isOwned: (l) => hasAny(l),
  },
  foil: {
    id: 'foil',
    labelZh: '闪卡完成',
    ownedPredicate: `cl.status = 'owned' AND cl.foil_qty > 0`,
    bucketPredicate: null,
    isOwned: (l) => l.status === 'owned' && l.foil_qty > 0,
  },
  alt: {
    id: 'alt',
    labelZh: '异画完成',
    ownedPredicate: `cl.status = 'owned' AND (cl.normal_qty > 0 OR cl.foil_qty > 0)`,
    bucketPredicate: `bucket = 'alt'`,
    isOwned: (l, bucket) => bucket === 'alt' && hasAny(l),
  },
  master: {
    id: 'master',
    labelZh: '大师完成',
    ownedPredicate: `cl.status = 'owned' AND cl.normal_qty > 0 AND cl.foil_qty > 0`,
    bucketPredicate: null,
    isOwned: (l) => l.status === 'owned' && l.normal_qty > 0 && l.foil_qty > 0,
  },
}

/** 获取完成度模式（缺省 base，与现有行为一致） */
export function getCompletionMode(mode?: CompletionModeId): CompletionMode {
  return COMPLETION_MODES[mode ?? 'base']
}
