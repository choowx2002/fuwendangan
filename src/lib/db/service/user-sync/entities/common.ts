/**
 * 实体合并共享工具（传输无关）
 * - mergeById：按 id 键 + 实体级 LWW + 墓碑判定的通用合并（卡组/心愿/借还/联系人/清单/对局/卡柜/自定义打印均适用）。
 * - 行级 / 语言行级合并由各实体模块自行实现。
 */

import type { SyncTombstone } from '../types'

export interface MergeResult<T> {
  upsert: T[]
  deleteIds: string[]
}

export interface IdEntity {
  id: string
  updated_at: string
}

export interface MergeByIdOptions<T extends IdEntity> {
  local: T[]
  remote: T[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  /** 输出：合并后仍存活的实体 key → updated_at（供墓碑收敛） */
  live: Map<string, string>
}

export function tsMax(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

/** 行级 LWW 决胜：返回胜者 'local' | 'remote' | 'none' */
export function lwwWinner(
  localTs: string | undefined,
  remoteTs: string | undefined,
  localDeviceId: string,
  remoteDeviceId: string
): 'local' | 'remote' | 'none' {
  if (!localTs && !remoteTs) return 'none'
  if (!localTs) return 'remote'
  if (!remoteTs) return 'local'
  if (localTs > remoteTs) return 'local'
  if (remoteTs > localTs) return 'remote'
  return localDeviceId >= remoteDeviceId ? 'local' : 'remote'
}

/** 构建某类型墓碑 key → tombstone 的映射（同 key 取 updated_at 更大者） */
export function buildTombstoneMap(
  tombstones: SyncTombstone[],
  type: string
): Map<string, SyncTombstone> {
  const map = new Map<string, SyncTombstone>()
  for (const t of tombstones) {
    if (t.entity_type !== type) continue
    const prev = map.get(t.entity_key)
    if (!prev || t.updated_at > prev.updated_at) map.set(t.entity_key, t)
  }
  return map
}

/**
 * 通用实体合并（按 id 键）：
 * 墓碑.updated_at > 实体.updated_at → 删除；实体.updated_at > 墓碑 → 复活；
 * 存活实体按 LWW（updated_at，相等按 deviceId 大者胜）决定采用本机/远端。
 */
export function mergeById<T extends IdEntity>(opts: MergeByIdOptions<T>): MergeResult<T> {
  const { local, remote, localTomb, remoteTomb, localDeviceId, remoteDeviceId, live } = opts
  const localMap = new Map(local.map((e) => [e.id, e]))
  const remoteMap = new Map(remote.map((e) => [e.id, e]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])
  const upsert: T[] = []
  const deleteIds: string[] = []

  for (const id of ids) {
    const l = localMap.get(id)
    const r = remoteMap.get(id)
    const localT = localTomb.get(id)?.updated_at
    const remoteT = remoteTomb.get(id)?.updated_at
    const maxEntity = tsMax(l?.updated_at, r?.updated_at)

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
    if (winner === 'remote') {
      upsert.push(r)
      live.set(id, r.updated_at)
    } else {
      live.set(id, l.updated_at)
    }
  }
  return { upsert, deleteIds }
}

export type DbLike = {
  select: (query: string, bindValues?: unknown[]) => Promise<unknown>
  execute: (query: string, bindValues?: unknown[]) => Promise<unknown>
}

/** 判断某 id 是否在目标表中存在 */
export async function existsIn(db: DbLike, table: string, id: string): Promise<boolean> {
  const rows = (await db.select(`SELECT 1 FROM ${table} WHERE id = ?`, [id])) as { 1?: number }[]
  return rows.length > 0
}
