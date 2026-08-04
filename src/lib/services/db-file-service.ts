import { invoke } from '@tauri-apps/api/core'
import { writeFile, remove, BaseDirectory } from '@tauri-apps/plugin-fs'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { CARD_IMAGE, ensureDir } from './image-cache-service'

/**
 * 数据库文件 / 数据文件操作服务
 * 封装 Tauri 文件相关 command（copy_file / write_text_file / read_text_file）
 */

export async function copyFile(source: string, dest: string): Promise<void> {
  await invoke('copy_file', { source, dest })
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_file', { path, content })
}

export async function readTextFile(path: string): Promise<string> {
  return await invoke<string>('read_text_file', { path })
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

/**
 * 读取本地图片文件并返回 dataURL（Tauri 环境，走 Rust read_image_file command）。
 */
export async function readImageFileAsDataUrl(path: string): Promise<string> {
  const base64 = await invoke<string>('read_image_file', { path })
  const ext = path.split('.').pop()?.toLowerCase() ?? 'png'
  const mime = IMAGE_MIME[ext] ?? 'image/png'
  return `data:${mime};base64,${base64}`
}

/**
 * 把二进制数据先写入应用本地临时目录，再拷贝到目标路径（dest）。
 * 与 Rust 侧 copy_file command 配合，避免跨目录直接写入。
 */
export async function writeBytesFile(
  bytes: Uint8Array,
  dest: string,
  tempName: string
): Promise<void> {
  const localDataDir = await appLocalDataDir()
  const relativePath = await join(CARD_IMAGE, tempName)
  const absolutePath = await join(localDataDir, CARD_IMAGE, tempName)

  await ensureDir(CARD_IMAGE)
  await writeFile(relativePath, bytes, { baseDir: BaseDirectory.AppLocalData })
  try {
    await copyFile(absolutePath, dest)
  } finally {
    await remove(relativePath, { baseDir: BaseDirectory.AppLocalData }).catch(() => {})
  }
}
