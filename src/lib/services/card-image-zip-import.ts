/**
 * 卡图 ZIP 导入服务
 * 用户选择 .zip（应用自身缓存导出格式：文件名形如 `{card_no_extend}-{LANG}-<cdnId>`，无扩展名）后，
 * 与 card_prints 匹配并把匹配到的卡图写入本地卡图缓存目录。
 * 流程：list（列条目）→ plan（匹配 + 检测已存在，不写盘）→ execute（提取写入）。
 */

import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { readDir, BaseDirectory } from '@tauri-apps/plugin-fs'
import { getPrints, printCacheName } from '$lib/db'
import { isTauri } from '$lib/db/env'
import { CARD_IMAGE, expectedCardImageName, LOCAL_IMG_PREFIX } from './image-cache-service'

export interface ZipEntryInfo {
  name: string
  size: number
  is_dir: boolean
}

export interface ZipImportJob {
  /** ZIP 内原始条目名（含目录前缀） */
  entry: string
  /** 写入 cardImages 的缓存文件名 */
  dest: string
}

export interface CardImageZipPlan {
  /** ZIP 内文件条目总数 */
  totalEntries: number
  /** 待写入（不存在）的作业 */
  newJobs: ZipImportJob[]
  /** 已存在、将跳过的张数 */
  existingCount: number
  /** 无法匹配到任何打印的条目数 */
  unmatchedCount: number
}

export interface ZipExtractResult {
  imported: number
  failed: string[]
}

function baseNameOf(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? name
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}

async function listZipEntries(path: string): Promise<ZipEntryInfo[]> {
  return invoke<ZipEntryInfo[]>('list_zip_entries', { path })
}

/**
 * 解析 ZIP 并与 card_prints 匹配，返回导入计划（不写盘）。
 * 匹配优先级：应用缓存精确名 → printCacheName → card_no_extend。
 */
export async function planCardImageZipImport(zipPath: string): Promise<CardImageZipPlan> {
  if (!isTauri) throw new Error('仅桌面端支持导入卡图 ZIP')

  const entries = await listZipEntries(zipPath)
  const entryByBase = new Map<string, string>()
  for (const e of entries) {
    if (e.is_dir) continue
    const base = stripExt(baseNameOf(e.name))
    if (!entryByBase.has(base)) entryByBase.set(base, e.name)
  }

  const prints = await getPrints()
  const expectedByName = new Map<string, string>()
  const destByCacheName = new Map<string, string>()
  const destsByCardNoExtend = new Map<string, string[]>()
  for (const p of prints) {
    if (p.is_custom) continue
    if (p.img_cdn?.startsWith(LOCAL_IMG_PREFIX)) continue
    const dest = expectedCardImageName(p)
    if (!dest) continue
    expectedByName.set(dest, dest)
    destByCacheName.set(printCacheName(p), dest)
    const no = p.card_no_extend?.toLowerCase()
    if (no) {
      const list = destsByCardNoExtend.get(no) ?? []
      list.push(dest)
      destsByCardNoExtend.set(no, list)
    }
  }

  const jobs: ZipImportJob[] = []
  const destSeen = new Set<string>()
  let unmatched = 0
  for (const base of entryByBase.keys()) {
    let dests: string[] | null = null
    if (expectedByName.has(base)) {
      dests = [expectedByName.get(base)!]
    } else if (destByCacheName.has(base)) {
      dests = [destByCacheName.get(base)!]
    } else if (destsByCardNoExtend.has(base.toLowerCase())) {
      dests = destsByCardNoExtend.get(base.toLowerCase())!
    }

    if (!dests || dests.length === 0) {
      unmatched++
      continue
    }
    for (const dest of dests) {
      if (destSeen.has(dest)) continue
      destSeen.add(dest)
      jobs.push({ entry: entryByBase.get(base)!, dest })
    }
  }

  // 一次性读取现有缓存目录，检测已存在
  const existingNames = new Set<string>()
  try {
    const files = await readDir(CARD_IMAGE, { baseDir: BaseDirectory.AppLocalData })
    for (const f of files) {
      if (f.name) existingNames.add(stripExt(f.name))
    }
  } catch {
    // 目录不存在视为无已存在文件
  }

  const newJobs = jobs.filter((j) => !existingNames.has(j.dest))
  return {
    totalEntries: entryByBase.size,
    newJobs,
    existingCount: jobs.length - newJobs.length,
    unmatchedCount: unmatched,
  }
}

/** 执行导入：把计划中的作业提取写入卡图缓存目录 */
export async function executeCardImageZipImport(
  zipPath: string,
  jobs: ZipImportJob[]
): Promise<ZipExtractResult> {
  if (!isTauri) throw new Error('仅桌面端支持导入卡图 ZIP')
  const localDataDir = await appLocalDataDir()
  const destDir = await join(localDataDir, CARD_IMAGE)
  return invoke<ZipExtractResult>('extract_zip_images', { path: zipPath, jobs, destDir })
}
