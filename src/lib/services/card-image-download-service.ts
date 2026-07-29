import { getPrints } from '$lib/db'
import {
  CARD_IMAGE,
  getMissingCardPrints,
  loadImageFromAppFolder,
} from '$lib/services/image-cache-service'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { message } from '@tauri-apps/plugin-dialog'
import { setProgressStatus, uiState, hideLoading } from '$lib/stores/ui-store.svelte'

let cancelRequested = false

export const isCardImageDownloading = () => uiState.status === 'downloading'

/**
 * 准备卡图下载任务。
 *
 * 这里只负责计算哪些图片缺失，不真正开始下载。
 */
export async function prepareCardImageDownload(): Promise<{
  missing: any[]
  existingCount: number
  totalCount: number
}> {
  const [cardPrints, localDataDir] = await Promise.all([getPrints(), appLocalDataDir()])

  const imagePath = await join(localDataDir, CARD_IMAGE)

  return getMissingCardPrints(cardPrints, imagePath)
}

/**
 * 请求取消下载。
 *
 * 当前正在进行的 HTTP 请求不会被强制杀掉，
 * 会在当前图片完成后停止。
 */
export function cancelCardImageDownload() {
  cancelRequested = true

  setProgressStatus(
    'downloading',
    '正在取消下载',
    '当前图片下载完成后将停止',
    uiState.progress ?? 0
  )
}

/**
 * 启动后台卡图下载。
 *
 * 注意这里故意不 await runCardImageDownload。
 * 这样 Settings 页面可以立即返回，下载任务继续在 service 中运行。
 */
export function startCardImageDownload(missing: any[]) {
  if (uiState.status === 'downloading' || missing.length === 0) {
    return
  }

  cancelRequested = false

  setProgressStatus('downloading', '正在下载卡牌', `准备下载 ${missing.length} 张卡图`, 0)

  void runCardImageDownload(missing)
}

async function runCardImageDownload(missing: any[]) {
  let completed = 0
  let failed = 0

  try {
    for (const fileData of missing) {
      if (cancelRequested) {
        break
      }

      const url = fileData.img_cdn ?? fileData.tts_cdn

      const result = await loadImageFromAppFolder(
        url,
        `${fileData.card_id}-${fileData?.id || 'default'}`
      )

      if (!result) {
        failed++
      }

      completed++

      const progress = (completed / missing.length) * 100

      setProgressStatus(
        'downloading',
        '正在下载卡牌',
        `${completed} / ${missing.length}${failed ? ` · ${failed} 张失败` : ''}`,
        progress
      )
    }

    if (cancelRequested) {
      return
    }

    if (failed > 0) {
      await message(`下载完成，但有 ${failed} 张卡图下载失败。`, {
        title: '卡牌资源下载',
        kind: 'warning',
      })
    }
  } catch (error) {
    console.error('[CardImageDownload]', error)

    await message(error instanceof Error ? error.message : '下载卡图时发生未知错误。', {
      title: '下载卡牌出现问题',
      kind: 'error',
    })
  } finally {
    hideLoading()
  }
}
