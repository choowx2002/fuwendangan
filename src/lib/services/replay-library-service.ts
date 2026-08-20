/**
 * 复盘本地库服务（桌面持久化）
 *
 * 拖入的复盘文件保存到 $APPLOCALDATA/replays/<id>.json（每份导入一个文件，
 * 内容为规范化后的 RiftAtlasMatchRecord[]，version: 3），元信息维护在 replays/index.json。
 * 仅 Tauri 环境持久化；web 环境返回空库（该模式数据页本就不可用）。
 * 去重：按文件内容 hash，相同文件重复导入 → 覆盖替换。
 * 单系列删除：过滤目标 group.key 后重写文件；文件清空则整删并更新索引。
 * 手动指定先手选择者：updateGameStarterChooser 直接改写磁盘记录并回写。
 *
 * 导入两段式（新流程）：解析后每个 series 先写 replays/tmp/{key}-{ts}.json 暂存
 * （writeImportTmp），用户选择要导入的 series 后逐系列写入真实文件
 * （saveSeriesFile，每 series 一个文件、按 key 替换更新），确认/取消后
 * cleanupImportTmp 清空暂存目录。
 */

import { isTauri } from '$lib/db/env'
import {
  writeTextFile,
  readTextFile,
  readDir,
  mkdir,
  exists,
  remove,
  BaseDirectory,
} from '@tauri-apps/plugin-fs'
import { migrateV1Group, migrateV2ToV3, type V1ReplayGroup } from '$lib/replay/import-parser'
import type { ReplayGroupAnnotation, RiftAtlasMatchRecord } from '$lib/replay/types'

export interface StoredReplayFile {
  id: string
  fileName: string
  importedAt: number
  hash: string
  /** 磁盘格式版本：3 = Schema v3（RiftAtlasMatchRecord，series 化） */
  version: 3
  groups: RiftAtlasMatchRecord[]
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
/** 导入暂存目录：解析后按 series 暂存，用户确认后写入真实文件并清理 */
const TMP_DIR = 'replays/tmp'

let dirReady: Promise<boolean> | null = null
let writeChain: Promise<void> = Promise.resolve()

function ensureDir(): Promise<boolean> {
  if (!dirReady) {
    dirReady = (async () => {
      try {
        if (!(await exists(REPLAYS_DIR, { baseDir: BaseDirectory.AppLocalData }))) {
          await mkdir(REPLAYS_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
        }
        if (!(await exists(TMP_DIR, { baseDir: BaseDirectory.AppLocalData }))) {
          await mkdir(TMP_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
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

/** 判别磁盘记录是否为 v1 格式（无 players/perspective 即旧版） */
function isV1Group(g: unknown): g is V1ReplayGroup {
  return typeof g === 'object' && g !== null && !('players' in g)
}

/** 旧库迁移：v1（ReplayGroup）→ v3（RiftAtlasMatchRecord），一次性 */
function migrateGroupToV3(g: unknown): RiftAtlasMatchRecord | null {
  if (isV1Group(g)) return migrateV1Group(g)
  return migrateV2ToV3(g as RiftAtlasMatchRecord)
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
      const parsed = JSON.parse(raw) as { version?: number; groups?: unknown }
      if (!Array.isArray(parsed.groups)) throw new Error('bad shape')
      let migrated = parsed.version !== 3
      const groups = parsed.groups.map((g) => {
        const v3 = migrateGroupToV3(g)
        if (v3) {
          migrated = true
          return v3
        }
        return g
      }) as RiftAtlasMatchRecord[]
      if (migrated) {
        writeChain = writeChain
          .then(async () => {
            if (await ensureDir()) {
              await writeTextFile(
                `replays/${entry.id}.json`,
                JSON.stringify({ ...parsed, version: 3, groups }),
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
        version: 3,
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
  groups: RiftAtlasMatchRecord[]
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
    version: 3,
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

/** 文件名安全化：seriesId/key 中的非法字符替换为下划线 */
function sanitizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

/**
 * 写入一个 series 的导入暂存文件（$APPLOCALDATA/replays/tmp/{key}-{ts}.json）。
 * 供导入流程的「解析 → 选择」阶段暂存，确认后写入真实文件并清理。
 * 非桌面环境返回 null。
 */
export async function writeImportTmp(
  key: string,
  group: RiftAtlasMatchRecord
): Promise<string | null> {
  if (!isTauri) {
    console.warn('[replay-import] writeImportTmp: 非桌面环境，跳过暂存', { key })
    return null
  }
  const name = `${sanitizeName(key)}-${Date.now()}.json`
  writeChain = writeChain
    .then(async () => {
      if (!(await ensureDir())) {
        console.error('[replay-import] writeImportTmp: 目录初始化失败', { name })
        return
      }
      await writeTextFile(`${TMP_DIR}/${name}`, JSON.stringify(group, null, 2), {
        baseDir: BaseDirectory.AppLocalData,
      })
      console.log('[replay-import] 暂存文件已写入', `${TMP_DIR}/${name}`)
    })
    .catch((e) => {
      console.error('[replay-import] 暂存文件写入失败', { name }, e)
    })
  await writeChain
  return name
}

/** 清空导入暂存目录（确认后 / 取消时调用） */
export async function cleanupImportTmp(): Promise<void> {
  if (!isTauri) return
  writeChain = writeChain
    .then(async () => {
      if (!(await ensureDir())) return
      let entries = []
      try {
        entries = await readDir(TMP_DIR, { baseDir: BaseDirectory.AppLocalData })
      } catch (e) {
        console.error('[replay-import] 读取暂存目录失败', e)
        return
      }
      let removedCount = 0
      for (const e of entries) {
        if (!e.isDirectory) {
          try {
            await remove(`${TMP_DIR}/${e.name}`, { baseDir: BaseDirectory.AppLocalData })
            removedCount++
          } catch (err) {
            console.warn('[replay-import] 清理单个暂存文件失败', { name: e.name }, err)
          }
        }
      }
      console.log('[replay-import] 暂存目录已清理', { removedCount })
    })
    .catch((e) => {
      console.error('[replay-import] 清理暂存目录异常', e)
    })
  await writeChain
}

/**
 * 按 series 写入一个真实文件：
 * - 按 group.key 去重：库中已存在同 key 的 series → 复用其 id 替换更新并刷新 importedAt；
 *   （若命中旧版多 series 文件，仅替换同 key 的组，保留同文件内的其他组避免丢数据）
 * - 否则新建 uuid 文件。
 * 文件内容为可读的 pretty JSON。非桌面环境返回 null。
 */
export async function saveSeriesFile(
  group: RiftAtlasMatchRecord,
  fileName: string | null
): Promise<StoredReplayFile | null> {
  if (!isTauri) {
    console.warn('[replay-import] saveSeriesFile: 非桌面环境，跳过落盘', { key: group.key })
    return null
  }
  const index = await readIndex()
  let existingId: string | null = null
  let existingGroups: RiftAtlasMatchRecord[] | null = null
  for (const e of index) {
    try {
      const raw = await readTextFile(`replays/${e.id}.json`, {
        baseDir: BaseDirectory.AppLocalData,
      })
      const parsed = JSON.parse(raw) as { groups?: unknown }
      const groups = Array.isArray(parsed.groups) ? (parsed.groups as RiftAtlasMatchRecord[]) : []
      if (groups.some((g) => g.key === group.key)) {
        existingId = e.id
        existingGroups = groups
        console.log('[replay-import] 命中同 key 已存在文件（替换更新）', {
          key: group.key,
          fileId: e.id,
          existingGroups: groups.length,
        })
        break
      }
    } catch {
      // 读取失败的文件不参与去重，保持 broken 状态
    }
  }
  const file: StoredReplayFile = {
    id: existingId ?? newId(),
    fileName: fileName ?? 'replay.json',
    importedAt: Date.now(),
    hash: hashText(JSON.stringify(group)),
    version: 3,
    groups:
      existingGroups && existingGroups.some((g) => g.key === group.key)
        ? existingGroups.map((g) => (g.key === group.key ? group : g))
        : [group],
  }
  const entry: IndexEntry = {
    id: file.id,
    fileName: file.fileName,
    importedAt: file.importedAt,
    hash: file.hash,
  }
  writeChain = writeChain
    .then(async () => {
      if (!(await ensureDir())) {
        console.error('[replay-import] saveSeriesFile: 目录初始化失败', { id: file.id })
        return
      }
      await writeTextFile(`replays/${file.id}.json`, JSON.stringify(file, null, 2), {
        baseDir: BaseDirectory.AppLocalData,
      })
      console.log('[replay-import] 真实文件已写入', {
        fileId: file.id,
        key: group.key,
        groupsInFile: file.groups.length,
      })
      const next = index.filter((e) => e.id !== file.id)
      next.push(entry)
      next.sort((a, b) => b.importedAt - a.importedAt)
      await writeIndex(next)
      console.log('[replay-import] index.json 已更新', { totalEntries: next.length })
    })
    .catch((e) => {
      console.error('[replay-import] 真实文件写入失败', { fileId: file.id }, e)
    })
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
        const groups = Array.isArray(parsed.groups) ? (parsed.groups as RiftAtlasMatchRecord[]) : []
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

export async function readGroupAnnotation(groupKey: string): Promise<ReplayGroupAnnotation | null> {
  if (!isTauri) return null
  const index = await readIndex()
  for (const e of index) {
    try {
      const raw = await readTextFile(`replays/${e.id}.json`, {
        baseDir: BaseDirectory.AppLocalData,
      })
      const parsed = JSON.parse(raw) as { annotations?: Record<string, ReplayGroupAnnotation> }
      const ann = parsed.annotations?.[groupKey]
      if (ann) return ann
    } catch {
      // 跳过损坏/缺失文件
    }
  }
  return null
}

/**
 * 将对局资料注解写入复盘文件（顶层 annotations[key]，纯本地、随 json 走）。
 * 返回是否写入成功（非桌面 / 库中无该 group → false）。
 */
export async function saveGroupAnnotation(
  groupKey: string,
  annotation: ReplayGroupAnnotation
): Promise<boolean> {
  if (!isTauri) return false
  const index = await readIndex()
  if (index.length === 0) return false
  let saved = false
  writeChain = writeChain
    .then(async () => {
      for (const e of index) {
        try {
          const raw = await readTextFile(`replays/${e.id}.json`, {
            baseDir: BaseDirectory.AppLocalData,
          })
          const parsed = JSON.parse(raw) as {
            groups?: unknown
            annotations?: Record<string, ReplayGroupAnnotation>
          }
          const groups = Array.isArray(parsed.groups) ? parsed.groups : []
          const found = groups.some(
            (g) => g && typeof g === 'object' && (g as { key?: unknown }).key === groupKey
          )
          if (!found) continue
          await writeTextFile(
            `replays/${e.id}.json`,
            JSON.stringify({
              ...parsed,
              annotations: { ...(parsed.annotations ?? {}), [groupKey]: annotation },
            }),
            { baseDir: BaseDirectory.AppLocalData }
          )
          saved = true
          return
        } catch {
          // 跳过损坏/缺失文件
        }
      }
    })
    .catch(() => {})
  await writeChain
  return saved
}

/**
 * 手动指定某局先手选择者并持久化到磁盘记录（播放页 starterChooser 提示条使用）。
 * 返回是否写回成功（非桌面 / 文件不存在 / 未找到目标局 → false）。
 */
export async function updateGameStarterChooser(
  fileId: string,
  groupKey: string,
  gameNumber: number,
  playerId: string | null
): Promise<boolean> {
  if (!isTauri) return false
  const index = await readIndex()
  if (!index.some((e) => e.id === fileId)) return false
  let updated = false
  writeChain = writeChain
    .then(async () => {
      try {
        const raw = await readTextFile(`replays/${fileId}.json`, {
          baseDir: BaseDirectory.AppLocalData,
        })
        const parsed = JSON.parse(raw) as { groups?: unknown }
        const groups = Array.isArray(parsed.groups) ? (parsed.groups as RiftAtlasMatchRecord[]) : []
        const group = groups.find((g) => g.key === groupKey)
        const game = group?.games?.find((gg) => gg.gameNumber === gameNumber)
        if (!group || !game) return
        game.starterChooserPlayerId = playerId
        await writeTextFile(
          `replays/${fileId}.json`,
          JSON.stringify({ ...parsed, version: 3, groups }),
          { baseDir: BaseDirectory.AppLocalData }
        )
        updated = true
      } catch {
        // 读取/写入失败：不更新
      }
    })
    .catch(() => {})
  await writeChain
  return updated
}
