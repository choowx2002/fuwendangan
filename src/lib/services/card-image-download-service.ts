import { getPrints } from '$lib/db'
import { printCacheName } from '$lib/db/helper'
import {
  CARD_IMAGE,
  localImgToken,
  getMissingCardPrints,
  loadImageFromAppFolder,
} from '$lib/services/image-cache-service'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { message } from '@tauri-apps/plugin-dialog'
import {
  beginDownload,
  finishDownload,
  updateDownloadProgress,
  downloadState,
} from '$lib/stores/ui-store.svelte'
import { stat, BaseDirectory } from '@tauri-apps/plugin-fs'
import { isMobile } from '$lib/utils/os'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  createChannel,
  Importance,
} from '@tauri-apps/plugin-notification'

let cancelRequested = false
let permissionGranted = false

// 固定的通知 ID 和 Channel ID，用于覆盖更新同一条通知
const NOTIFICATION_ID = 4242
const CHANNEL_ID = 'card-download-progress'

const initNotificationMobile = async () => {
  // 如果已经获取过权限，直接返回，避免重复请求和创建 Channel
  if (permissionGranted) return

  permissionGranted = await isPermissionGranted()

  if (!permissionGranted) {
    const permission = await requestPermission()
    permissionGranted = permission === 'granted'
  }

  // 获取权限后，在 Android 上创建通知通道（Channel）
  if (permissionGranted) {
    try {
      await createChannel({
        id: CHANNEL_ID,
        name: '卡图下载进度',
        description: '显示卡牌图片下载的后台进度',
        importance: Importance.Low, // Low 级别不会弹出 heads-up 遮挡屏幕
        vibration: false,
        sound: undefined,
      })
    } catch (error) {
      console.warn('[Notification] 创建 Channel 失败:', error)
    }
  }
}

/**
 * 发送/更新正在下载中的进度通知
 */
const updateProgressNotification = (completed: number, total: number, failed: number) => {
  const percent = Math.round((completed / total) * 100)
  sendNotification({
    id: NOTIFICATION_ID,
    channelId: CHANNEL_ID,
    title: '卡牌资源下载',
    body: `${percent}% (${completed}/${total})${failed ? ` · ${failed} 失败` : ''}`,
    icon: 'icon',
    ongoing: true, // 正在进行中，禁止用户滑动删除
    autoCancel: false,
    silent: true, // 更新时不发声
  })
}

/**
 * 发送最终结果通知（完成/取消/失败），并解除 ongoing 状态
 */
const finishNotification = (title: string, body: string) => {
  sendNotification({
    id: NOTIFICATION_ID,
    channelId: CHANNEL_ID,
    title,
    body,
    icon: 'icon',
    ongoing: false, // 解除锁定，允许用户滑动删除
    autoCancel: true, // 点击后自动消失
  })
}

export const isCardImageDownloading = () =>
  downloadState.active && downloadState.status === 'downloading'

export async function prepareCardImageDownload(): Promise<{
  missing: any[]
  existingCount: number
  totalCount: number
}> {
  const [cardPrints, localDataDir] = await Promise.all([getPrints(), appLocalDataDir()])
  const imagePath = await join(localDataDir, CARD_IMAGE)
  return getMissingCardPrints(cardPrints, imagePath)
}

export function cancelCardImageDownload() {
  cancelRequested = true
}

export async function startCardImageDownload(missing: any[]) {
  if (downloadState.active || missing.length === 0) {
    return
  }

  cancelRequested = false
  beginDownload(missing.length)

  const onMobile = await isMobile()

  // 初始化移动端通知权限和 Channel
  if (onMobile && missing.length > 0) {
    try {
      await initNotificationMobile()
      if (permissionGranted) {
        updateProgressNotification(0, missing.length, 0)
      }
    } catch (error) {
      console.error('[Notification] 初始化通知失败:', error)
    }
  }

  // 故意不 await，让 Settings 页面立即返回
  void runCardImageDownload(missing, onMobile)
}

async function runCardImageDownload(missing: any[], onMobile: boolean = false) {
  let completed = 0
  let failed = 0
  let bytesDownloaded = 0

  // 速度采样窗口（最近 10 秒内的字节累计）
  const samples: { bytes: number; t: number }[] = []

  const recordSpeedSample = (bytes: number, now: number): number => {
    samples.push({ bytes, t: now })
    while (samples.length > 0 && now - samples[0].t > 10000) {
      samples.shift()
    }
    if (samples.length >= 2) {
      const deltaBytes = bytes - samples[0].bytes
      const deltaTime = (now - samples[0].t) / 1000
      if (deltaTime > 0) return deltaBytes / deltaTime
    }
    return 0
  }

  try {
    const cacheDir = await join(await appLocalDataDir(), CARD_IMAGE)

    for (const fileData of missing) {      if (cancelRequested) {
        break
      }

      const url = fileData.img_cdn ?? fileData.tts_cdn

      // 本地图片（local://）不参与下载，跳过
      if (localImgToken(url)) {
        completed++
        continue
      }

      const cacheName = printCacheName(fileData)
      const result = await loadImageFromAppFolder(url, cacheName)

      if (result) {
        completed++
        try {
          const filePath = await join(cacheDir, cacheName)
          const info = await stat(filePath, { baseDir: BaseDirectory.AppLocalData })
          bytesDownloaded += info.size ?? 0
        } catch {
          // 读不到文件大小不影响下载进度
        }
      } else {
        failed++
        completed++
      }

      const now = Date.now()
      const speedBps = recordSpeedSample(bytesDownloaded, now)

      // 剩余时间估算：基于已下载字节数估算剩余总量
      let etaSeconds = 0
      if (completed > 0 && speedBps > 0) {
        const avgBytes = bytesDownloaded / completed
        const estimatedTotal = avgBytes * missing.length
        const remainingBytes = Math.max(0, estimatedTotal - bytesDownloaded)
        etaSeconds = remainingBytes / speedBps
      }

      updateDownloadProgress({
        completed,
        failed,
        bytesDownloaded,
        speedBps,
        etaSeconds,
      })

      // 在移动设备上更新通知进度（每 10% 更新一次）
      if (
        onMobile &&
        permissionGranted &&
        completed % Math.max(1, Math.floor(missing.length / 10)) === 0
      ) {
        updateProgressNotification(completed, missing.length, failed)
      }
    }

    if (cancelRequested) {
      finishDownload('cancelled')
      if (onMobile && permissionGranted) {
        finishNotification('卡牌下载已取消', `已下载 ${completed} 张，失败 ${failed} 张`)
      }
      return
    }

    // 下载完成
    finishDownload(failed > 0 ? 'partial' : 'success')

    if (onMobile && permissionGranted) {
      finishNotification(
        '卡牌资源下载完成',
        `成功 ${completed - failed} 张，失败 ${failed} 张`
      )
    }
  } catch (error) {
    console.error('[CardImageDownload]', error)
    finishDownload('error')

    if (onMobile && permissionGranted) {
      finishNotification(
        '卡牌资源下载失败',
        error instanceof Error ? error.message : '下载卡图时发生未知错误。'
      )
    }

    await message(error instanceof Error ? error.message : '下载卡图时发生未知错误。', {
      title: '下载卡牌出现问题',
      kind: 'error',
    })
  }
}
