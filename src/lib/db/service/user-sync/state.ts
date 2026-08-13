/**
 * 玩家数据同步状态管理（sync_meta 高层封装）
 * - device_id：本机唯一标识（snowflake），用于 LWW 相等时确定性决胜。
 * - last_sync：上次成功同步时间（ISO）。
 * - push 游标预留：后续按实体增量 push 用。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import { getSyncMeta, setSyncMeta } from '../../repository/sync-repository'

export const SYNC_META_DEVICE_ID = 'device_id'
export const SYNC_META_LAST_SYNC = 'last_sync'

/** 获取本机设备 id；不存在则生成并持久化 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getSyncMeta(SYNC_META_DEVICE_ID)
  if (existing) return existing
  const id = Snowflake.generate()
  await setSyncMeta(SYNC_META_DEVICE_ID, id)
  return id
}

/** 读取上次成功同步时间（ISO；从未同步返回 null） */
export async function getLastSync(): Promise<string | null> {
  return getSyncMeta(SYNC_META_LAST_SYNC)
}

/** 记录上次成功同步时间 */
export async function setLastSync(ts: string): Promise<void> {
  await setSyncMeta(SYNC_META_LAST_SYNC, ts)
}
