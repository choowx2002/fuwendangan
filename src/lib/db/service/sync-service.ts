/**
 * 数据同步服务层
 * 负责远程数据与本地数据库的同步。
 *
 * 同步模型：按表 timestamp 同步。
 * - 云端 version 表每张同步表一行（name = 表标识，updated_at = 该表数据最后发布时间）。
 * - 本地按表对比 updated_at，只重下更新的表（整表全量替换，不做逐行 diff）。
 * - 写入阶段临时 `PRAGMA foreign_keys = OFF`（先清后插，结束时恢复），不用跨语句事务
 *   （插件底层是 sqlx 多连接池，BEGIN/COMMIT 跨语句不可靠且会锁库）。本地 version 行最后更新，
 *   崩溃中断则下次启动自动重试。
 */

import { isTauri } from '../env'
import * as remoteApi from './remote-api'
import * as cardRepo from '../repository/card-repository'
import * as printRepo from '../repository/print-repository'
import * as iconRepo from '../repository/icon-repository'
import * as versionRepo from '../repository/version-repository'
import * as ruleRepo from '../repository/rules-repository'
import * as seriesRepo from '../repository/series-repository'
import * as collectionRepo from '../repository/collection-repository'
import { repointDeckCardReferences } from '../repository/deck-repository'
import { updateFilterOptions } from './filter-service'
import { uiState, showToast } from '$lib/stores/ui-store.svelte'
import { whenOnline, isMetered } from '$lib/stores/network.svelte'
import { openConfirm } from '$lib/stores/confirm-store.svelte'
import { getDatabase } from '../repository/database'
import { TABLES } from '../config/constants'
import { get } from 'svelte/store'
import { t } from '$lib/i18n'
import type { CardBase, CardPrint, IconDB, Rule, Series } from '../types'

/** 同步表标识，与云端 version 表的 name 保持一致 */
export const SYNC_TABLE_NAMES = ['cards', 'prints', 'icons', 'rules', 'series'] as const
type SyncTableName = (typeof SYNC_TABLE_NAMES)[number]

/**
 * 初始化数据库（在 Tauri 环境中执行数据同步）
 * opts.skipMetered = true 时，检测到按流量计费网络会跳过自动同步（默认启用）；
 * 手动触发（设置页检查更新）传入 false 以放行。
 * opts.confirm = false 时跳过升级确认框（调用方已自行确认，如启动时更新提示）。
 */
export async function initializeDatabase(opts?: {
  skipMetered?: boolean
  confirm?: boolean
}): Promise<void> {
  try {
    const check = await checkSyncStatus()
    if (!check) return

    const { remoteMap, localVersions, tablesToSync } = check
    if (tablesToSync.length === 0) {
      console.log('[DB] 本地数据已是最新，无需同步')
      return
    }

    if (opts?.skipMetered !== false && isMetered()) {
      console.warn('[DB] 当前为流量网络，跳过自动同步')
      showToast(get(t)('common.skipMeteredSync'), 'info')
      return
    }

    // 首次安装（无本地 version 行）静默同步，升级才询问
    const isFreshInstall = localVersions.length === 0
    if (!isFreshInstall && opts?.confirm !== false) {
      const accepted = await openConfirm(get(t)('common.syncDataPrompt'))
      if (!accepted) return
    }

    console.log(`[DB] 发现更新，开始同步：${tablesToSync.join(', ')}`)
    uiState.status = 'syncing'
    await performSync(tablesToSync, remoteMap)
  } catch (error) {
    // DEBUG: 内容同步失败的真实错误（不再只显示通用「同步失败」）
    console.error('[DB] 数据库初始化/同步失败:', error)
    console.error(
      '[DB] 数据库初始化/同步失败 string:',
      error instanceof Error ? error.message : String(error)
    )
    showToast(get(t)('common.syncFailed'), 'error')
  } finally {
    if (uiState.status === 'syncing') uiState.status = 'success'
  }
}

/**
 * 后台静默检查是否有内容更新（不下载、不弹框）。
 * 用于启动时提示「发现新卡牌数据」，返回是否有任一同步表需要更新。
 */
export async function checkForContentUpdates(): Promise<boolean> {
  if (!isTauri) return false
  try {
    const check = await checkSyncStatus()
    if (!check) return false
    if (check.tablesToSync.length === 0) return false
    // 流量网络下不提示（避免诱导消耗流量），由手动检查覆盖
    if (isMetered()) return false
    return true
  } catch (error) {
    console.error('[DB] 检查更新失败:', error)
    return false
  }
}

/**
 * 检查本地与远端同步状态（不写入任何数据）。
 * 返回 null 表示无需同步（非 Tauri / 离线）；否则返回各同步表的最新对比结果。
 */
async function checkSyncStatus(): Promise<{
  remoteMap: Map<string, string>
  localVersions: { name: string | null }[]
  tablesToSync: SyncTableName[]
} | null> {
  if (!isTauri) {
    console.log('[DB] Web 环境：跳过本地数据库初始化，直接使用 Supabase')
    return null
  }

  console.log('[DB] Tauri 环境：开始检查本地数据库同步状态...')

  if (!(await whenOnline())) {
    console.warn('[DB] 网络不可用，跳过同步')
    return null
  }

  await getDatabase()
  // 启动时兜底修复卡组引用（清空数据 / 远端换 id 后的残留）
  await repointDeckCardReferences()

  const remoteVersions = await remoteApi.fetchAllVersions()
  const remoteMap = new Map(remoteVersions.map((v) => [v.name, v.updated_at]))
  const localVersions = await versionRepo.getVersions()
  const localMap = new Map(localVersions.map((v) => [v.name, v.updated_at]))

  const tablesToSync = SYNC_TABLE_NAMES.filter((name) => {
    const remoteTime = remoteMap.get(name)
    if (!remoteTime) return false
    const localTime = localMap.get(name)
    return !localTime || new Date(remoteTime).getTime() > new Date(localTime).getTime()
  })

  return { remoteMap, localVersions, tablesToSync }
}

/**
 * 执行数据同步
 * @param tablesToSync 需要同步的表（均为远端 updated_at 更新的表）
 * @param remoteMap 远端版本行映射（name → updated_at）
 */
async function performSync(
  tablesToSync: SyncTableName[],
  remoteMap: Map<string, string>
): Promise<void> {
  const hasCards = tablesToSync.includes('cards')
  const hasPrints = tablesToSync.includes('prints')
  const hasIcons = tablesToSync.includes('icons')
  const hasRules = tablesToSync.includes('rules')
  const hasSeries = tablesToSync.includes('series')

  // 1. 下载阶段：全部拉取到内存后再写库，下载失败不产生任何本地写入
  const cards = hasCards ? await remoteApi.fetchAllCards() : undefined
  const prints = hasPrints ? await remoteApi.fetchAllPrints() : undefined
  const icons = hasIcons ? await remoteApi.fetchAllIcons() : undefined
  const rules = hasRules ? await remoteApi.fetchAllRules() : undefined
  const series = hasSeries ? await remoteApi.fetchAllSeries() : undefined

  const db = await getDatabase()

  // 填充云端打印的 card_no 快照（cards_base.card_no，唯一；用于 card_id 失效后重链）
  if (prints) {
    const cardNoById = new Map<string, string | null>()
    if (cards) {
      for (const c of cards) cardNoById.set(c.id, c.card_no)
    } else {
      const rows = await db.select<{ id: string; card_no: string | null }[]>(
        `SELECT id, card_no FROM ${TABLES.CARDS_BASE}`
      )
      for (const r of rows) cardNoById.set(r.id, r.card_no)
    }
    for (const p of prints) p.card_no = p.card_no ?? cardNoById.get(p.card_id ?? '') ?? null
  }

  // 2. 写入阶段：临时关闭外键检查（先清后插期间外键瞬时可能不成立：
  //    清理旧数据、同 card_no 换 id 的 REPLACE 级联、卡组引用旧打印等）。
  //    不用 BEGIN/COMMIT 跨语句事务：插件底层是 sqlx 多连接池，跨语句事务不可靠且会锁库。
  //    结束时 repoint 已把卡组引用重链到当前存在的打印，随后恢复外键即一致。
  await db.execute('PRAGMA foreign_keys = OFF')
  try {
    // 保留顺序：先清卡片再清卡图，确保 clearAllCards 能看到全部自定义打印（is_custom=1）并保留其引用的基础卡
    if (hasCards) await cardRepo.clearAllCards()
    if (hasPrints) await printRepo.clearAllPrints()
    if (hasCards) await cardRepo.saveCards(cards as CardBase[])
    if (hasPrints) await printRepo.saveCardPrints(prints as CardPrint[])

    if (hasIcons) {
      await iconRepo.clearIcons()
      await iconRepo.saveIcons(icons as IconDB[])
    }
    if (hasRules) {
      await ruleRepo.clearRules()
      await ruleRepo.saveRules(rules as Rule[])
    }
    if (hasSeries) {
      await seriesRepo.clearAllSeries()
      await seriesRepo.saveSeries(series as Series[])
    }

    // 3. 重链卡组引用：卡牌/卡图变化后把 deck_cards 指向当前存在的打印，无法映射的行删除
    if (hasCards || hasPrints) {
      await repointDeckCardReferences()
    }

    // 4. 条件后处理：卡牌/卡图变化影响收藏有效性；series 数据源在打印级，cards/prints 任一变化都重建筛选
    if (hasCards || hasPrints) {
      await collectionRepo.cleanupOrphans()
    }
    if (hasCards || hasPrints) {
      await updateFilterOptions()
    }

    // 5. 最后按表更新本地 version 行（崩溃中断则本地 version 不动 → 下次启动自动重试）
    for (const name of tablesToSync) {
      const remoteTime = remoteMap.get(name)
      if (remoteTime) await versionRepo.upsertTableVersion(name, remoteTime)
    }
  } catch (error) {
    // DEBUG: 写入阶段具体哪一步失败（老库缺列 / 外键冲突 / 锁）
    console.error('[DB] performSync 写入阶段失败:', error)
    console.error(
      '[DB] performSync 写入阶段失败 string:',
      error instanceof Error ? error.message : String(error)
    )
    throw error
  } finally {
    await db.execute('PRAGMA foreign_keys = ON')
  }

  console.log(
    `[DB] 同步完成！${cards ? `更新 ${cards.length} 张卡牌，` : ''}${prints ? `${prints.length} 个卡图，` : ''}${icons ? `${icons.length} 个图标，` : ''}${rules ? `${rules.length} 条规则，` : ''}${series ? `${series.length} 个系列` : ''}。`
  )
}
