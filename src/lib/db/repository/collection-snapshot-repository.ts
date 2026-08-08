/**
 * 收藏进度快照仓储层
 * 编辑后 fire-and-forget 捕获整体统计快照；相邻去重：距上一条 < 10 分钟且数值无变化时跳过。
 * getCollectionStats 动态导入以避免与 collection-repository 静态循环依赖。
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import type { CollectionStatsSnapshot, SnapshotTrigger } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

const now = () => new Date().toISOString()
const SNAPSHOT_MIN_INTERVAL_MS = 10 * 60 * 1000

let capturing = false

/** 捕获一次快照（去重 + 防并发），失败静默（不影响收藏操作） */
export async function captureCollectionSnapshot(trigger: SnapshotTrigger = 'auto'): Promise<void> {
  if (capturing) return
  capturing = true
  try {
    const db = await getDatabase()
    const lastRows = await db.select<any[]>(
      `SELECT overall_owned, overall_count, promo_owned, foil_owned, created_at
       FROM ${TABLES.COLLECTION_STATS_SNAPSHOTS}
       ORDER BY created_at DESC LIMIT 1`
    )
    const last = lastRows[0]

    const { getCollectionStats } = await import('./collection-repository')
    const stats = await getCollectionStats()

    if (last) {
      const withinInterval =
        Date.now() - new Date(last.created_at).getTime() < SNAPSHOT_MIN_INTERVAL_MS
      const unchanged =
        last.overall_owned === stats.overallOwned &&
        last.overall_count === stats.overallCount &&
        last.promo_owned === stats.promoOwned &&
        last.foil_owned === stats.foilOwned
      if (withinInterval && unchanged) return
    }

    await db.execute(
      `INSERT INTO ${TABLES.COLLECTION_STATS_SNAPSHOTS}
       (id, trigger, overall_owned, overall_count, promo_owned, foil_owned, series_stats, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Snowflake.generate(),
        trigger,
        stats.overallOwned,
        stats.overallCount,
        stats.promoOwned,
        stats.foilOwned,
        JSON.stringify(stats.series),
        now(),
      ]
    )
  } catch (err) {
    console.warn('快照捕获失败：', err)
  } finally {
    capturing = false
  }
}

/** 按时间升序返回快照（供趋势图绘制） */
export async function getCollectionSnapshots(limit = 200): Promise<CollectionStatsSnapshot[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT id, trigger, overall_owned, overall_count, promo_owned, foil_owned, series_stats, created_at
     FROM ${TABLES.COLLECTION_STATS_SNAPSHOTS}
     ORDER BY created_at ASC LIMIT ?`,
    [limit]
  )
  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger as SnapshotTrigger,
    overallOwned: r.overall_owned,
    overallCount: r.overall_count,
    promoOwned: r.promo_owned,
    foilOwned: r.foil_owned,
    seriesStats: r.series_stats
      ? (JSON.parse(r.series_stats) as CollectionStatsSnapshot['seriesStats'])
      : null,
    createdAt: r.created_at,
  }))
}
