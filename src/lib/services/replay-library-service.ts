/**
 * 复盘本地库服务（桌面持久化）
 *
 * 拖入的复盘文件保存到 $APPLOCALDATA/replays/<id>.json（每份导入一个文件，
 * 内容为规范化后的 ReplayGroup[]），元信息维护在 replays/index.json。
 * 仅 Tauri 环境持久化；web 环境返回空库（该模式数据页本就不可用）。
 * 去重：按文件内容 hash，相同文件重复导入 → 覆盖替换。
 * 单局删除：过滤目标 group.key 后重写文件；文件清空则整删并更新索引。
 */

import { isTauri } from '$lib/db/env'
import {
  writeTextFile,
  readTextFile,
  mkdir,
  exists,
  remove,
  BaseDirectory,
} from '@tauri-apps/plugin-fs'
import { deriveGroupLegends } from '$lib/replay/import-parser'
import type { ReplayGroup } from '$lib/replay/types'

export interface StoredReplayFile {
  id: string
  fileName: string
  importedAt: number
  hash: string
  groups: ReplayGroup[]
}

export interface LibraryResult {
  files: StoredReplayFile[]
  /** 索引里存在但读取/解析失败的文件 id（可整份删除兜底） */
  brokenIds: string[]
}

interface IndexEntry {
  id: string
  fileName: string
  importedAt: number
  hash: string
}

const REPLAYS_DIR = 'replays'
const INDEX_PATH = 'replays/index.json'

let dirReady: Promise<boolean> | null = null
let writeChain: Promise<void> = Promise.resolve()

function ensureDir(): Promise<boolean> {
  if (!dirReady) {
    dirReady = (async () => {
      try {
        if (!(await exists(REPLAYS_DIR, { baseDir: BaseDirectory.AppLocalData }))) {
          await mkdir(REPLAYS_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
        }
        return true
      } catch {
        return false
      }
    })()
  }
  return dirReady
}

/** FNV-1a 内容 hash（相同导出文件 → 相同 hash，用于去重） */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function readIndex(): Promise<IndexEntry[]> {
  try {
    const raw = await readTextFile(INDEX_PATH, { baseDir: BaseDirectory.AppLocalData })
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : []
  } catch {
    return []
  }
}

async function writeIndex(entries: IndexEntry[]): Promise<void> {
  if (!(await ensureDir())) return
  await writeTextFile(INDEX_PATH, JSON.stringify(entries), { baseDir: BaseDirectory.AppLocalData })
}

/** 旧库迁移：补全 selfLegend/opponentLegend（加入前保存的文件缺失），有改动则返回 true */
function migrateGroupLegends(group: ReplayGroup): boolean {
  let changed = false
  if (group.selfLegend == null || group.opponentLegend == null) {
    const derived = deriveGroupLegends(group)
    if (derived.selfLegend && group.selfLegend == null) {
      group.selfLegend = derived.selfLegend
      changed = true
    }
    if (derived.opponentLegend && group.opponentLegend == null) {
      group.opponentLegend = derived.opponentLegend
      changed = true
    }
  }
  return changed
}

/** 读取全部已保存复盘（按导入时间倒序；损坏/缺失的文件在 brokenIds 中列出） */
export async function loadLibrary(): Promise<LibraryResult> {
  if (!isTauri) return { files: [], brokenIds: [] }
  const index = await readIndex()
  const files: StoredReplayFile[] = []
  const brokenIds: string[] = []
  for (const entry of index) {
    try {
      const raw = await readTextFile(`replays/${entry.id}.json`, {
        baseDir: BaseDirectory.AppLocalData,
      })
      const parsed = JSON.parse(raw) as { groups?: unknown }
      if (!Array.isArray(parsed.groups)) throw new Error('bad shape')
      const groups = parsed.groups as ReplayGroup[]
      const migrated = groups.some(migrateGroupLegends)
      if (migrated) {
        writeChain = writeChain
          .then(async () => {
            if (await ensureDir()) {
              await writeTextFile(
                `replays/${entry.id}.json`,
                JSON.stringify({ ...parsed, groups }),
                { baseDir: BaseDirectory.AppLocalData }
              )
            }
          })
          .catch(() => {})
      }
      files.push({
        id: entry.id,
        fileName: entry.fileName,
        importedAt: entry.importedAt,
        hash: entry.hash,
        groups,
      })
    } catch {
      brokenIds.push(entry.id)
    }
  }
  await writeChain
  return { files, brokenIds }
}

/** 保存一份导入：按内容 hash 去重，相同文件覆盖替换并刷新 importedAt */
export async function saveLibraryFile(
  fileName: string | null,
  text: string,
  groups: ReplayGroup[]
): Promise<StoredReplayFile | null> {
  if (!isTauri) return null
  const hash = hashText(text)
  const index = await readIndex()
  const existing = index.find((e) => e.hash === hash)
  const file: StoredReplayFile = {
    id: existing?.id ?? newId(),
    fileName: fileName ?? 'replay.json',
    importedAt: Date.now(),
    hash,
    groups,
  }
  const entry: IndexEntry = {
    id: file.id,
    fileName: file.fileName,
    importedAt: file.importedAt,
    hash,
  }
  writeChain = writeChain
    .then(async () => {
      if (!(await ensureDir())) return
      await writeTextFile(`replays/${file.id}.json`, JSON.stringify(file), {
        baseDir: BaseDirectory.AppLocalData,
      })
      const next = index.filter((e) => e.id !== file.id)
      next.push(entry)
      next.sort((a, b) => b.importedAt - a.importedAt)
      await writeIndex(next)
    })
    .catch(() => {})
  await writeChain
  return file
}

/** 从指定文件删除一局（按 group.key）；文件清空则整份删除并移除索引项 */
export async function removeRoom(fileId: string, groupKey: string): Promise<boolean> {
  if (!isTauri) return false
  const index = await readIndex()
  if (!index.some((e) => e.id === fileId)) return false
  let removed = false
  writeChain = writeChain
    .then(async () => {
      try {
        const raw = await readTextFile(`replays/${fileId}.json`, {
          baseDir: BaseDirectory.AppLocalData,
        })
        const parsed = JSON.parse(raw) as { groups?: unknown }
        const groups = Array.isArray(parsed.groups) ? (parsed.groups as ReplayGroup[]) : []
        const rest = groups.filter((g) => g.key !== groupKey)
        if (rest.length === 0) {
          await remove(`replays/${fileId}.json`, { baseDir: BaseDirectory.AppLocalData })
          await writeIndex(index.filter((e) => e.id !== fileId))
        } else {
          await writeTextFile(
            `replays/${fileId}.json`,
            JSON.stringify({ ...parsed, groups: rest }),
            { baseDir: BaseDirectory.AppLocalData }
          )
        }
        removed = true
      } catch {
        // 读取/写入失败等场景：不删
      }
    })
    .catch(() => {})
  await writeChain
  return removed
}

/** 整份删除一个已保存文件（用于损坏文件等兜底场景） */
export async function removeFile(fileId: string): Promise<boolean> {
  if (!isTauri) return false
  const index = await readIndex()
  if (!index.some((e) => e.id === fileId)) return false
  let removed = false
  writeChain = writeChain
    .then(async () => {
      try {
        await remove(`replays/${fileId}.json`, { baseDir: BaseDirectory.AppLocalData })
        await writeIndex(index.filter((e) => e.id !== fileId))
        removed = true
      } catch {
        // 忽略
      }
    })
    .catch(() => {})
  await writeChain
  return removed
}
