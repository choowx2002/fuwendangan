/**
 * 数据同步服务层
 * 负责远程数据与本地数据库的同步
 */

import { isTauri } from '../env'
import * as remoteApi from './remote-api'
import * as cardRepo from '../repository/card-repository'
import * as printRepo from '../repository/print-repository'
import * as iconRepo from '../repository/icon-repository'
import * as versionRepo from '../repository/version-repository'
import { updateFilterOptions } from './filter-service'
import { uiState } from '$lib/stores/ui-store.svelte'

/**
 * 初始化数据库（在 Tauri 环境中执行数据同步）
 */
export async function initializeDatabase(): Promise<void> {
  if (!isTauri) {
    console.log('[DB] Web 环境：跳过本地数据库初始化，直接使用 Supabase')
    return
  }

  console.log('[DB] Tauri 环境：开始检查本地数据库同步状态...')

  try {
    const remoteVersion = await remoteApi.fetchLatestVersion()
    if (!remoteVersion) {
      console.warn('[DB] 未获取到远端版本信息，跳过同步')
      return
    }

    const localVersion = await versionRepo.getVersion()

    const remoteTime = new Date(remoteVersion.updated_at).getTime()
    const localTime = localVersion ? new Date(localVersion.updated_at).getTime() : 0
    const needsSync = remoteTime > localTime

    if (needsSync) {
      console.log(`[DB] 发现新版本 (远端：${remoteVersion.updated_at})，开始同步数据...`)
      uiState.status = 'syncing'
      await performSync(remoteVersion)
    } else {
      console.log('[DB] 本地数据已是最新，无需同步')
    }
  } catch (error) {
    console.error('[DB] 数据库初始化/同步失败:', error)
  }
}

/**
 * 执行数据同步
 */
async function performSync(remoteVersion: any): Promise<void> {
  const cards = await remoteApi.fetchAllCards()
  const prints = await remoteApi.fetchAllPrints()
  const icons = await remoteApi.fetchAllIcons()

  await cardRepo.saveCards(cards)
  await printRepo.saveCardPrints(prints)
  await iconRepo.saveIcons(icons)
  await updateFilterOptions()
  await versionRepo.saveVersion(remoteVersion)

  console.log(
    `[DB] 同步完成！共更新 ${cards.length} 张卡牌，${prints.length} 个卡图，${icons.length}个图标。`
  )
}
