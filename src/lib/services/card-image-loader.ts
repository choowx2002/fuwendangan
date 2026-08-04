import { isTauri } from '$lib/db'
import { preloadImage } from './image-cache-service'

export function loadObjectUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

async function fetchImageElement(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`图片下载失败: ${response.status}`)
  const blob = await response.blob()
  const objUrl = URL.createObjectURL(blob)
  try {
    return await loadObjectUrl(objUrl)
  } finally {
    URL.revokeObjectURL(objUrl)
  }
}

/**
 * 加载卡图并返回 HTMLImageElement。
 * Tauri 环境走本地缓存（preloadImage），Web 环境直接 fetch。
 */
export async function loadCardImageElement(
  url: string,
  cacheName: string
): Promise<HTMLImageElement> {
  if (isTauri) {
    const objUrl = await preloadImage(url, cacheName)
    if (!objUrl) throw new Error('缓存图片不可用')
    return await loadObjectUrl(objUrl)
  }
  return await fetchImageElement(url)
}
