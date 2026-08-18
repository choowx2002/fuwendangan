/**
 * Rift Atlas 导入解析器（M0 纯函数层）
 *
 * 职责：原始导出 JSON → 规范化 ImportBundle（Schema v2）。
 * - 分组：roomCode = 一局；组内多条记录 = 断线重连 session（按 startedAt 排序）
 * - 我方识别：匹配会话 payload 的 playerId / playerName → 快照带 decklistRaw 的玩家兜底
 * - 比分预填：用回放引擎重建最终状态取双方 board.score
 * - 赛制标注：payload matchFormat（如 "bo1"）→ URL bo{n} 兜底，仅展示用
 * - 战场选择：解析期一次提取（候选池 / 最终锁定 / 随机标记 / 时间戳），随记录持久化
 * - v1 → v2 迁移：旧磁盘文件（selfXXX/opponentXXX 字段爆炸版）→ RiftAtlasMatchRecord
 */

import {
  buildReplay,
  finalState,
  parsePayload,
  resolveSelfPlayer,
  extractBattlefieldSelections,
} from './replay-engine.js'
import {
  ReplayImportError,
  type BattlefieldSelection,
  type CardEntry,
  type Decklist,
  type ImportBundle,
  type ReplayPlayer,
  type ReplaySession,
  type RiftAtlasMatchRecord,
  type RiftExport,
  type RiftMatchRecord,
} from './types.js'

export { ReplayImportError } from './types.js'

// ==================== 小工具 ====================

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isMatchmakingUrl(url: string | null | undefined): boolean {
  return /\/matchmaking\//i.test(url ?? '')
}

/** 从 URL 提取队列赛制（如 "...-bo1?..." → "bo1"） */
function queueFormatFromUrl(url: string | null | undefined): string | null {
  const m = /(?:^|[\/\-?&])bo(\d+)/i.exec(url ?? '')
  return m ? `bo${m[1].toLowerCase()}` : null
}

/** 规范化卡组分区结构（宽容：缺分区给空数组；实测服务端键为复数 battlefields/runes） */
function normalizeSections(raw: unknown): Decklist | null {
  if (!isRecord(raw)) return null
  const zoneKeys = ['legend', 'champion', 'mainDeck', 'battlefields', 'runes', 'sideboard'] as const
  const sections = {} as Decklist
  for (const key of zoneKeys) {
    const list: CardEntry[] = []
    const rawList = raw[key]
    if (Array.isArray(rawList)) {
      for (const item of rawList) {
        if (isRecord(item) && typeof item.name === 'string' && typeof item.cardCode === 'string') {
          list.push({
            count: typeof item.count === 'number' ? item.count : 1,
            name: item.name,
            cardCode: item.cardCode,
          })
        }
      }
    }
    sections[key] = list
  }
  return sections
}

/** 快照玩家信息（含从 board 兜底的传奇/英雄，用于对手卡组不可见时） */
interface SnapshotPlayerInfo {
  id: string
  name: string | null
  decklistRaw: string | null
  sections: Decklist | null
  boardLegend: CardEntry | null
  boardChampion: CardEntry | null
}

/** 快照 board 里的卡对象（name/cardCode） → 卡组条目 */
function boardEntry(v: unknown): CardEntry | null {
  if (!isRecord(v)) return null
  const cardCode = typeof v.cardCode === 'string' ? v.cardCode : ''
  if (!cardCode) return null
  return { count: 1, name: typeof v.name === 'string' && v.name ? v.name : cardCode, cardCode }
}

/** 扫描全部事件的 payload，收集首个快照的玩家信息与匹配会话元数据 */
function scanSessions(sessions: ReplaySession[]): {
  snapshotPlayers: SnapshotPlayerInfo[]
  mmPlayerId: string | null
  mmPlayerName: string | null
  queueFormat: string | null
  snapshotCount: number
} {
  const players: SnapshotPlayerInfo[] = []
  let mmPlayerId: string | null = null
  let mmPlayerName: string | null = null
  let queueFormat: string | null = null
  let snapshotCount = 0

  for (const s of sessions) {
    for (const ev of s.events) {
      const p = parsePayload(ev.payload)
      if (!isRecord(p)) continue
      if (s.isMatchmaking) {
        if (p.type === 'searching' || p.type === 'matched' || p.type === 'start') {
          if (typeof p.playerId === 'string' && !mmPlayerId) mmPlayerId = p.playerId
          if (typeof p.playerName === 'string' && !mmPlayerName) mmPlayerName = p.playerName
        }
        if (typeof p.matchFormat === 'string' && !queueFormat) queueFormat = p.matchFormat
      } else if (p.type === 'authoritative_snapshot') {
        snapshotCount++
        const snap = isRecord(p.snapshot) ? p.snapshot : null
        const rawPlayers = snap && Array.isArray(snap.players) ? snap.players : []
        for (const rp of rawPlayers) {
          if (!isRecord(rp) || typeof rp.id !== 'string') continue
          if (players.some((x) => x.id === rp.id)) continue
          const deck = isRecord(rp.deck) ? rp.deck : null
          const board = isRecord(rp.board) ? rp.board : null
          const legendList = board && Array.isArray(board.legend) ? board.legend : []
          const champList = board && Array.isArray(board.champion) ? board.champion : []
          players.push({
            id: rp.id,
            name: typeof rp.name === 'string' ? rp.name : null,
            decklistRaw: typeof rp.decklistRaw === 'string' ? rp.decklistRaw : null,
            sections: normalizeSections(deck?.sections),
            boardLegend: legendList[0] ? boardEntry(legendList[0]) : null,
            boardChampion: champList[0] ? boardEntry(champList[0]) : null,
          })
        }
      }
    }
  }
  return { snapshotPlayers: players, mmPlayerId, mmPlayerName, queueFormat, snapshotCount }
}

function pickOpponent(players: SnapshotPlayerInfo[], selfId: string | null) {
  return players.find((p) => p.id !== selfId) ?? null
}

/** 战场选择缺失兜底值 */
const EMPTY_BATTLEFIELD: BattlefieldSelection = {
  options: [],
  finalPick: null,
  isRandom: null,
  pickTimestamp: null,
}

// ==================== 主入口 ====================

export interface ParseRiftExportOptions {
  fileName?: string | null
}

/**
 * 解析 Rift Atlas 导出 JSON 为规范化 ImportBundle。
 * @throws ReplayImportError（not-json / bad-shape / no-matches）
 */
export function parseRiftExport(
  input: string | unknown,
  opts?: ParseRiftExportOptions
): ImportBundle {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch {
      throw new ReplayImportError('not-json', '文件不是合法 JSON')
    }
  }
  if (!isRecord(data)) {
    throw new ReplayImportError('bad-shape', 'JSON 顶层不是对象')
  }
  const matches = data.matches
  if (!Array.isArray(matches)) {
    throw new ReplayImportError('bad-shape', '缺少 matches 数组')
  }
  if (matches.length === 0) {
    throw new ReplayImportError('no-matches', '文件中没有对局记录（matches 为空）')
  }

  const meta = isRecord(data.meta) ? data.meta : {}
  const warnings: string[] = []

  // 1. session 化
  const sessions: ReplaySession[] = []
  let skipped = 0
  for (const raw of matches as unknown[]) {
    if (!isRecord(raw) || !Array.isArray(raw.events)) {
      skipped++
      continue
    }
    const rec = raw as unknown as RiftMatchRecord
    const startedAt = typeof rec.startedAt === 'number' ? rec.startedAt : 0
    sessions.push({
      sessionId: String(rec.sessionId ?? `session-${sessions.length}`),
      isMatchmaking: isMatchmakingUrl(rec.url),
      startedAt,
      endedAt: typeof rec.endedAt === 'number' ? rec.endedAt : null,
      reason: typeof rec.reason === 'string' ? rec.reason : null,
      events: rec.events,
      raw: rec,
    })
  }
  if (skipped > 0) warnings.push(`${skipped} 条记录缺少 events 数组，已跳过`)

  // 2. 按房间分组（roomCode 为空的分到独立组）
  const byRoom = new Map<string, ReplaySession[]>()
  const roomless: ReplaySession[][] = []
  for (const s of sessions) {
    if (s.raw.roomCode) {
      const list = byRoom.get(s.raw.roomCode) ?? []
      list.push(s)
      byRoom.set(s.raw.roomCode, list)
    } else {
      roomless.push([s])
    }
  }

  const groups: RiftAtlasMatchRecord[] = []
  for (const [roomCode, list] of byRoom) {
    groups.push(buildGroup(roomCode, list))
  }
  roomless.forEach((list, i) => groups.push(buildGroup(null, list, `roomless-${i + 1}`)))

  groups.sort((a, b) => a.meta.startedAt - b.meta.startedAt || a.key.localeCompare(b.key))

  // 3. 每组的比分预填与统计（用回放引擎重建最终状态）
  for (const g of groups) {
    const build = buildReplay({
      roomCode: g.meta.roomCode,
      sessions: g.telemetry.sessions,
      selfId: g.perspective.localPlayerId,
    })
    g.telemetry.parseFailures = build?.parseFailures ?? 0
    g.telemetry.hasReplayableData = build !== null
    if (g.telemetry.parseFailures > 0)
      warnings.push(`${g.key}：${g.telemetry.parseFailures} 个事件 payload 解析失败`)
    if (!build && g.telemetry.snapshotCount > 0) {
      warnings.push(`${g.key}：只有快照没有补丁帧，数据不完整，无法回放`)
    }
    if (build) {
      const state = finalState(build)
      if (state) {
        const self = resolveSelfPlayer(state, g.perspective.localPlayerId)
        const opp = (state.players ?? []).find((p) => p !== self) ?? null
        const scoreOf = (
          p: { board?: Record<string, unknown> } | null | undefined
        ): number | null => {
          if (!p) return null
          const v = p.board?.score
          return typeof v === 'number' ? v : null
        }
        const score: Record<string, number> = {}
        if (self?.id) {
          const v = scoreOf(self)
          if (v !== null) score[self.id] = v
        }
        if (opp?.id) {
          const v = scoreOf(opp)
          if (v !== null) score[opp.id] = v
        }
        g.result.score = score
        // 先手（room.firstPlayerId 可能在后来的快照里才出现，取最后一个非空）
        let firstPlayerId: string | null = null
        for (const snap of build.snapshots) {
          const v = snap.state.firstPlayerId
          if (typeof v === 'string' && v) firstPlayerId = v
        }
        g.meta.firstPlayerId = firstPlayerId
      }
      const ignored = Object.keys(build.ignoredOps)
      if (ignored.length > 0) {
        warnings.push(
          `${g.key}：存在未识别的补丁操作 ${ignored.join(', ')}（共 ${Object.values(build.ignoredOps).reduce((a, b) => a + b, 0)} 次）`
        )
      }
    }
    if (g.telemetry.sessions.every((s) => s.isMatchmaking)) {
      warnings.push(`${g.key}：只有匹配记录，无可回放的对局内容`)
    }
  }

  return {
    fileName: opts?.fileName ?? null,
    meta: {
      exporter: typeof meta.exporter === 'string' ? meta.exporter : null,
      version: typeof meta.version === 'string' ? meta.version : null,
      exportedAt: typeof meta.exportedAt === 'string' ? meta.exportedAt : null,
    },
    rawMatchCount: sessions.length,
    groups,
    warnings,
  }
}

/** 一组（一局）的规范化：session 排序、自我/对手识别、卡组与传奇信息（Schema v2） */
export function buildGroup(
  roomCode: string | null,
  list: ReplaySession[],
  keyOverride?: string
): RiftAtlasMatchRecord {
  const sessions = [...list].sort(
    (a, b) => a.startedAt - b.startedAt || a.sessionId.localeCompare(b.sessionId)
  )
  const gameSessions = sessions.filter((s) => !s.isMatchmaking)
  const matchmakingSession = sessions.find((s) => s.isMatchmaking) ?? null

  const first = sessions[0]
  const last = sessions[sessions.length - 1]
  const startedAt = first.startedAt
  const endedAt = last.endedAt ?? null
  const durationMs = endedAt !== null ? endedAt - startedAt : null

  const { snapshotPlayers, mmPlayerId, mmPlayerName, queueFormat, snapshotCount } =
    scanSessions(sessions)

  // 我方识别：匹配会话 playerId → 快照中带 decklistRaw 的玩家 → seat 0 → 第一个玩家
  let selfId = mmPlayerId
  if (!selfId) {
    const byDeck = snapshotPlayers.find((p) => p.decklistRaw)
    selfId = byDeck?.id ?? snapshotPlayers[0]?.id ?? null
  }

  // 本局战场选择：解析期只算一次（候选池/最终锁定/随机标记/时间戳），随记录持久化，
  // 渲染/预热直接读取；不依赖 Chat/Log 文本
  const battlefieldMap = extractBattlefieldSelections(sessions.flatMap((s) => s.events))

  // 玩家数据池（与视角解耦；1v1，未来可扩展 2v2/观战）
  const players: Record<string, ReplayPlayer> = {}
  for (const info of snapshotPlayers) {
    const legend =
      info.sections?.legend && info.sections.legend.length > 0
        ? info.sections.legend[0]
        : (info.boardLegend ?? null)
    const sel = battlefieldMap.get(info.id)
    players[info.id] = {
      id: info.id,
      name: info.name,
      legend,
      deck: info.sections,
      decklistRaw: info.decklistRaw,
      battlefield: sel ?? EMPTY_BATTLEFIELD,
    }
  }
  if (selfId && players[selfId]) {
    players[selfId].name = mmPlayerName ?? players[selfId].name
  }

  return {
    key: keyOverride ?? roomCode ?? 'unknown',
    meta: {
      roomCode,
      format: queueFormat ?? queueFormatFromUrl(matchmakingSession?.raw.url) ?? null,
      startedAt,
      endedAt,
      durationMs,
      firstPlayerId: null,
    },
    perspective: { localPlayerId: selfId },
    players,
    result: { winnerId: null, score: {} },
    telemetry: {
      totalEvents: sessions.reduce((sum, s) => sum + s.events.length, 0),
      snapshotCount,
      reconnectCount: Math.max(0, gameSessions.length - 1),
      parseFailures: 0,
      hasReplayableData: false,
      sessions,
      matchmakingSession,
    },
  }
}

// ==================== v1 → v2 迁移（一次性，仅旧磁盘文件） ====================

/** v1 磁盘文件中的对局记录形态（schema v2 之前：selfXXX/opponentXXX 字段爆炸版） */
export interface V1ReplayGroup {
  key: string
  roomCode: string | null
  sessions: ReplaySession[]
  selfPlayerId: string | null
  opponentPlayerId: string | null
  selfName: string | null
  opponentName: string | null
  queueFormat: string | null
  selfBattlefield?: string | null
  opponentBattlefield?: string | null
  totalEvents: number
  reconnectCount: number
  hasReplayableData: boolean
  finalScore: { my: number | null; opp: number | null } | null
  firstPlayerId: string | null
  parseFailures: number
  snapshotCount: number
  [key: string]: unknown
}

/** 旧库迁移：v1 对局记录 → v2 RiftAtlasMatchRecord（基于 sessions 重建，语义与重新导入一致） */
export function migrateV1Group(g: V1ReplayGroup): RiftAtlasMatchRecord {
  const v2 = buildGroup(g.roomCode, g.sessions, g.key)
  const selfId = v2.perspective.localPlayerId
  let oppId: string | null = null
  for (const pid of Object.keys(v2.players)) {
    if (pid !== selfId) {
      oppId = pid
      break
    }
  }

  // 保留 v1 已算好的结果（与重建等价，但含当时已识别的名字等）
  if (selfId && g.selfName && v2.players[selfId]) v2.players[selfId].name = g.selfName
  if (oppId && g.opponentName && v2.players[oppId]) v2.players[oppId].name = g.opponentName
  if (g.queueFormat) v2.meta.format = g.queueFormat
  if (g.firstPlayerId) v2.meta.firstPlayerId = g.firstPlayerId
  v2.telemetry.hasReplayableData = g.hasReplayableData
  v2.telemetry.parseFailures = g.parseFailures
  v2.telemetry.snapshotCount = g.snapshotCount
  v2.telemetry.totalEvents = g.totalEvents
  v2.telemetry.reconnectCount = g.reconnectCount
  const score: Record<string, number> = {}
  if (selfId && typeof g.finalScore?.my === 'number') score[selfId] = g.finalScore.my
  if (oppId && typeof g.finalScore?.opp === 'number') score[oppId] = g.finalScore.opp
  v2.result.score = score
  return v2
}
