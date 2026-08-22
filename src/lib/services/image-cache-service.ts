import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  exists,
  writeFile,
  mkdir,
  remove,
  readDir,
  stat,
} from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { printCacheName } from '$lib/db/helper'
import { whenOnline } from '$lib/stores/network.svelte'

// ==================== 类型定义 ====================

export interface ImageItem {
  url: string
  name: string
}

export type ObjectFitType = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'

// ==================== 常量与内存缓存 ====================

export const CARD_IMAGE = 'cardImages'
const cache = new Map<string, string>()

// 下载去重：记录正在进行的下载 Promise，防止并发重复下载同一文件
const downloadingPromises = new Map<string, Promise<boolean>>()

// ==================== 工具函数 ====================

function safeSegment(str: string): string {
  return str.replace(/[<>:"/\|?*\x00-\x1F]/g, '_')
}

function urlToFilename(dataUrl: string | null | undefined, name: string = 'undefined'): string {
  if (!dataUrl) return safeSegment(`${name}-file`)
  const cleanUrl = dataUrl.replace(/\/$/, '')
  const id = cleanUrl.split('/').pop()?.split('.')[0] || 'file'
  const filename = `${name}-${id}`
  return safeSegment(filename)
}

export const LOCAL_IMG_PREFIX = 'local://'

/**
 * 计算某打印的期望缓存文件名（= urlToFilename(url, printCacheName)）。
 * 无可用图片来源时返回 null（无法缓存）。
 */
export function expectedCardImageName(
  p:
    | {
        img_cdn?: string | null
        tts_cdn?: string | null
        card_no_extend?: string | null
        language?: string | null
        id?: string | null
      }
    | null
    | undefined
): string | null {
  const url = p?.img_cdn ?? p?.tts_cdn
  if (!url) return null
  return urlToFilename(url, printCacheName(p))
}

/**
 * 从 local:// 协议 URL 中提取缓存文件名（形如 local://custom-123 → custom-123）。
 * 非 local:// 返回 null。
 */
export function localImgToken(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(LOCAL_IMG_PREFIX)) return null
  const token = url.slice(LOCAL_IMG_PREFIX.length).replace(/\/+$/, '')
  return token ? safeSegment(token) : null
}

/**
 * 获取图片在本地文件系统的绝对路径
 */
const getAbsoluteImagePath = async (filename: string): Promise<string> => {
  const localDataDir = await appLocalDataDir()
  return await join(localDataDir, CARD_IMAGE, filename)
}

/**
 * 根据文件名推断 MIME type
 */
const getMimeType = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
  }
  return mimeTypes[ext || ''] || 'image/*'
}

export const ensureDir = async (dir: string): Promise<void> => {
  const ok = await exists(dir, {
    baseDir: BaseDirectory.AppLocalData,
  })
  if (!ok) {
    await mkdir(dir, {
      baseDir: BaseDirectory.AppLocalData,
      recursive: true,
    })
  }
}

// ==================== 外部资源加载（打包资源，保持 Blob 方案） ====================

import { resolveResource } from '@tauri-apps/api/path'
import { readFile } from '@tauri-apps/plugin-fs'
import { BaseDirectory } from '@tauri-apps/plugin-fs'

export async function loadExternalImage(
  fileName: string,
  folder: string = 'card_img'
): Promise<string> {
  if (cache.has(fileName)) return cache.get(fileName)!

  try {
    const paths = await resolveResource(`resources/external/${folder}/${fileName}`)
    const bytes = await readFile(paths)
    const mimeType = getMimeType(fileName)
    const blob = new Blob([bytes], { type: mimeType })
    const url = URL.createObjectURL(blob)
    cache.set(fileName, url)
    return url
  } catch (err) {
    console.warn('[Cache] 加载图片失败:', fileName, err)
    return ''
  }
}

// ==================== 图片缓存管理 ====================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const saveImageToAppFolder = async (dataUrl: string, filename: string, maxRetry = 3): Promise<boolean> => {
  if (!(await whenOnline())) {
    console.warn(`[Cache] 网络不可用，跳过下载: ${filename}`)
    return false
  }
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      const controller = new AbortController()

      const timeout = setTimeout(() => {
        controller.abort()
      }, 30000)

      const response = await fetch(dataUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      })

      clearTimeout(timeout)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const blob = await response.blob()
      const arrayBuffer = await blob.arrayBuffer()

      await ensureDir(CARD_IMAGE)

      const absolutePath = await getAbsoluteImagePath(filename)
      await writeFile(absolutePath, new Uint8Array(arrayBuffer))

      console.log(`[Cache] 保存图片成功: ${filename}`)

      return true
    } catch (error) {
      console.warn(`[Cache] 下载失败 (${attempt}/${maxRetry}):`, filename, error)

      if (attempt < maxRetry) {
        await sleep(1000 * Math.pow(2, attempt - 1))
      } else {
        console.error(`[Cache] 最终失败: ${filename}`)
        return false
      }
    }
  }

  return false
}

/** 下载远程图片到卡图缓存目录（自定义打印 URL 导入，token 形如 custom-{id}，无扩展名） */
export async function saveRemoteImageAsToken(url: string, token: string): Promise<boolean> {
  return saveImageToAppFolder(url, token)
}

/**
 * 轻量级并发控制器
 * @param tasks 任务数组
 * @param concurrency 最大并发数（默认 4）
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency = 4
): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result)
    })
    executing.push(p)

    if (executing.length >= concurrency) {
      await Promise.race(executing)
      // 移除已完成的
      const idx = executing.findIndex((e) => e === p)
      if (idx >= 0) executing.splice(idx, 1)
    }
  }

  await Promise.all(executing)
  return results
}

export const loadImageFromAppFolder = async (url: string, name: string): Promise<string | null> => {
  if (!url) return null

  const localToken = localImgToken(url)
  const filename = localToken || urlToFilename(url, name)
  const cacheKey = localToken ? `local://${localToken}` : filename

  // 1. 内存缓存命中
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  // 2. 获取绝对路径并检查文件存在
  const absolutePath = await getAbsoluteImagePath(filename)
  const fileExists = await exists(absolutePath)

  if (!fileExists) {
    // 3. 防并发下载
    if (downloadingPromises.has(filename)) {
      await downloadingPromises.get(filename)
    } else {
      const downloadPromise = saveImageToAppFolder(url, filename).finally(() => {
        downloadingPromises.delete(filename)
      })
      downloadingPromises.set(filename, downloadPromise)
      const success = await downloadPromise
      if (!success) return null
    }
  }

  // 4. 使用 convertFileSrc 生成 asset:// URL
  try {
    const assetUrl = convertFileSrc(absolutePath)
    cache.set(cacheKey, assetUrl)
    return assetUrl
  } catch (error) {
    console.error(
      '[Cache] convertFileSrc 失败，请检查 tauri.conf.json 中的 assetProtocol.scope 是否包含 $APPLOCALDATA/cardImages/**',
      error
    )
    return null
  }
}

export const preloadImage = async (url: string, name: string): Promise<string | null> => {
  if (!url) return null

  const localToken = localImgToken(url)
  const filename = localToken || urlToFilename(url, name)
  const cacheKey = localToken ? `local://${localToken}` : filename

  // 1. 内存缓存命中
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  // 2. 获取绝对路径并检查文件存在
  const absolutePath = await getAbsoluteImagePath(filename)
  const fileExists = await exists(absolutePath)

  if (!fileExists) {
    // 3. 防并发下载
    if (downloadingPromises.has(filename)) {
      await downloadingPromises.get(filename)
    } else {
      const downloadPromise = saveImageToAppFolder(url, filename).finally(() => {
        downloadingPromises.delete(filename)
      })
      downloadingPromises.set(filename, downloadPromise)
      const success = await downloadPromise
      if (!success) return null
    }
  }

  // 4. 使用 convertFileSrc 生成 asset:// URL
  try {
    const assetUrl = convertFileSrc(absolutePath)
    cache.set(cacheKey, assetUrl)
    return assetUrl
  } catch (error) {
    console.error(
      '[Cache] convertFileSrc 失败，请检查 tauri.conf.json 中的 assetProtocol.scope 是否包含 $APPLOCALDATA/cardImages/**',
      error
    )
    return null
  }
}

/**
 * 批量预加载图片（带并发限制，默认 4 个并发）
 */
export const preloadImages = async (imageList: ImageItem[], concurrency = 4): Promise<(string | null)[]> => {
  const tasks = imageList.map(({ url, name }) => () => preloadImage(url, name))
  return runWithConcurrency(tasks, concurrency)
}

// ==================== 缓存管理功能 ====================

/**
 * 清除内存缓存
 */
export const clearMemoryCache = (): void => {
  cache.forEach((url) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  })
  cache.clear()
  downloadingPromises.clear()
  console.log('[Cache] 内存缓存及下载队列已清除')
}

/**
 * 从缓存中移除特定项
 */
export const removeFromCache = (fileName: string): void => {
  const url = cache.get(fileName)
  if (url) {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
    cache.delete(fileName)
  }
}

/**
 * 获取缓存大小
 */
export const getCacheSize = (): number => {
  return cache.size
}

/**
 * 检查缓存中是否存在某个文件
 */
export const isInCache = (fileName: string): boolean => {
  return cache.has(fileName)
}

export const getImageDirSize = async (): Promise<number> => {
  const imagesDir = CARD_IMAGE

  const dirExists = await exists(imagesDir, {
    baseDir: BaseDirectory.AppLocalData,
  })

  if (!dirExists) {
    return 0
  }

  const getDirSize = async (dir: string): Promise<number> => {
    let total = 0

    const entries = await readDir(dir, {
      baseDir: BaseDirectory.AppLocalData,
    })

    for (const entry of entries) {
      const path = entry.name ? `${dir}/${entry.name}` : dir

      if (entry.isDirectory) {
        total += await getDirSize(path)
      } else {
        const info = await stat(path, {
          baseDir: BaseDirectory.AppLocalData,
        })

        total += info.size ?? 0
      }
    }

    return total
  }
  return getDirSize(imagesDir)
}

export async function getMissingCardPrints(
  cardPrints: any[],
  imagePath: string
): Promise<{
  missing: any[]
  existingCount: number
  totalCount: number
}> {
  await ensureDir(CARD_IMAGE)

  const files = await readDir(imagePath, {
    baseDir: BaseDirectory.AppLocalData,
  })

  const fileNames = new Set(
    files.filter((file) => file.name).map((file) => file.name!.split('.')[0])
  )

  const missing = cardPrints.filter((print) => {
    if (localImgToken(print.img_cdn)) return false
    const url = print.img_cdn ?? print.tts_cdn
    if (!url) return false
    const expectedName = urlToFilename(url, printCacheName(print))

    return !fileNames.has(expectedName)
  })

  return {
    missing,
    existingCount: cardPrints.length - missing.length,
    totalCount: cardPrints.length,
  }
}

/**
 * 删除本地存储的图片
 */
export const deleteLocalImage = async (filename: string): Promise<boolean> => {
  try {
    const targetPath = await join(CARD_IMAGE, filename)
    await remove(targetPath, {
      baseDir: BaseDirectory.AppLocalData,
    })
    return true
  } catch (error) {
    console.error('[Cache] 删除图片失败:', error)
    return false
  }
}

/**
 * 清除所有本地缓存图片
 */
export const clearLocalCache = async (): Promise<boolean> => {
  try {
    const imagesDir = CARD_IMAGE
    const dirExists = await exists(imagesDir, {
      baseDir: BaseDirectory.AppLocalData,
    })

    if (!dirExists) return false

    const entries = await readDir(imagesDir, {
      baseDir: BaseDirectory.AppLocalData,
    })

    let removed = 0
    for (const entry of entries) {
      const fileName = entry.name
      if (!fileName) continue
      if (fileName.startsWith('custom-')) continue
      await remove(`${imagesDir}/${fileName}`, {
        baseDir: BaseDirectory.AppLocalData,
      }).catch(() => {})
      removed++
    }

    console.log(`[Cache] 本地缓存已清除（保留自定义卡图 ${entries.length - removed} 个）`)
    clearMemoryCache()
    return true
  } catch (error) {
    console.error('[Cache] 清除本地缓存失败:', error)
    return false
  }
}

/**
 * 获取缓存目录路径
 */
export const getCacheDirPath = async (): Promise<string> => {
  return await join(CARD_IMAGE)
}

/**
 * 获取所有缓存的文件名列表
 */
export const getCachedFileNames = (): string[] => {
  return Array.from(cache.keys())
}

/**
 * 刷新缓存中的某个图片（重新从源加载）
 */
export const refreshCache = async (url: string, name: string): Promise<string | null> => {
  if (!url) return null
  if (localImgToken(url)) return null
  const filename = urlToFilename(url, name)

  removeFromCache(filename)
  await deleteLocalImage(filename)

  return await preloadImage(url, name)
}