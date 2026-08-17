/**
 * 复盘导入跨页状态（M1）
 *
 * 解析后的 ImportBundle 驻留内存跨页传递（/replay → /replay/[key]），
 * 同时保存卡组绑定与逐局结果标记（供 M2 并入记录使用）。
 * 页面刷新后数据丢失：查看器页检测不到 bundle 会跳回导入页。
 */

import type { ImportBundle } from '$lib/replay/types'

export type ReplayResultMark = 'win' | 'loss' | 'draw'

let pendingBundle = $state<ImportBundle | null>(null)
let boundDeckId = $state<string | null>(null)
let resultMarks = $state<Record<string, ReplayResultMark>>({})

export function setReplayBundle(bundle: ImportBundle): void {
  pendingBundle = bundle
  boundDeckId = null
  resultMarks = {}
}

export function peekReplayBundle(): ImportBundle | null {
  return pendingBundle
}

export function clearReplayBundle(): void {
  pendingBundle = null
}

export function getBoundDeckId(): string | null {
  return boundDeckId
}

export function setBoundDeckId(id: string | null): void {
  boundDeckId = id
}

export function getReplayResultMarks(): Record<string, ReplayResultMark> {
  return resultMarks
}

export function markReplayResult(key: string, mark: ReplayResultMark | null): void {
  if (mark === null) {
    const { [key]: _removed, ...rest } = resultMarks
    resultMarks = rest
  } else {
    resultMarks = { ...resultMarks, [key]: mark }
  }
}
