import { isTauri } from '$lib/db'
import { preloadImage, readCachedImageBytes } from './image-cache-service'

export function loadObjectUrl(url: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // canvas.toDataURL 要求画布不被污染：asset:// 与页面不同源，
    // 必须显式发起 CORS 请求，Tauri 资产协议会回传 Access-Control-Allow-Origin。
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

async function loadBlobElement(blob: Blob): Promise<HTMLImageElement> {
  const objUrl = URL.createObjectURL(blob)
  try {
    return await loadObjectUrl(objUrl)
  } finally {
    URL.revokeObjectURL(objUrl)
  }
}

async function fetchImageElement(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`图片下载失败: ${response.status}`)
  return await loadBlobElement(await response.blob())
}

/**
 * 读取本地缓存文件字节后用 blob: URL 加载。
 * blob: 与页面同源，画布不会被污染，作为 asset:// 的兜底方案。
 */
async function readCachedImageElement(url: string, cacheName: string): Promise<HTMLImageElement> {
  const bytes = await readCachedImageBytes(url, cacheName)
  if (!bytes) throw new Error('缓存图片不可用')
  return await loadBlobElement(new Blob([bytes]))
}

/**
 * 加载卡图并返回 HTMLImageElement。
 * Tauri 环境走本地缓存（preloadImage，asset://），Web 环境直接 fetch。
 */
export async function loadCardImageElement(
  url: string,
  cacheName: string
): Promise<HTMLImageElement> {
  if (!isTauri) return await fetchImageElement(url)

  const assetUrl = await preloadImage(url, cacheName)
  if (assetUrl) {
    try {
      return await loadObjectUrl(assetUrl, true)
    } catch (error) {
      console.warn('[CardImage] asset 协议加载失败，回退为读取缓存文件:', cacheName, error)
    }
  }
  return await readCachedImageElement(url, cacheName)
}
