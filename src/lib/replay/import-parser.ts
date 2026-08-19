/**
 * Rift Atlas 导入解析器（M0 纯函数层）
 *
 * 职责：原始导出 JSON → 规范化 ImportBundle（Schema v3）。
 * - 分组：seriesId（服务器权威）聚合 → 一个 BO3 = 一条记录；无 seriesId 的 room 独立成单局系列
 * - 局序：gameNumber（缺失按 startedAt），previousRoomCode/nextRoomCode 交叉校验（断裂仅警告）
 * - 胜负：pendingGameResult / winsByPlayerId 权威提取（每局 winner + 系列比分与胜者）
 * - 先手选择者：starterChooserPlayerId 探测（payload / sessionDoc / 快照顶层，取最后非空），缺失播放页可手动指定
 * - 我方识别：匹配会话 payload 的 playerId / playerName → 快照带 decklistRaw 的玩家兜底
 * - 比分预填：用回放引擎重建最终状态取双方 board.score
 * - 战场选择：解析期一次提取（候选池 / 最终锁定 / 随机标记 / 时间戳），随记录持久化
 * - v1/v2 → v3 迁移：旧磁盘文件（v1 字段爆炸版 / v2 单局版）→ RiftAtlasMatchRecord（games 单局系列）
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
  type RiftAtlasGame,
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
      }
      if (isRecord(p.sessionDoc) && typeof p.sessionDoc.matchFormat === 'string') {
        const mf = p.sessionDoc.matchFormat.trim()
        if (mf) queueFormat = mf
      } else if (s.isMatchmaking && !queueFormat && typeof p.matchFormat === 'string') {
        queueFormat = p.matchFormat
      }
      if (p.type === 'authoritative_snapshot') {
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

// ==================== 服务器权威系列字段探测（无稳定契约，宽容） ====================

export interface SeriesFields {
  seriesId: string | null
  gameNumber: number | null
  previousRoomCode: string | null
  nextRoomCode: string | null
  /** playerId → 系列累计胜场（快照顶层 winsByPlayerId，取最后已知） */
  winsByPlayerId: Record<string, number> | null
  /** 本局胜者（pendingGameResult / pendingResult，string 或含 winner 字段的对象） */
  pendingGameWinner: string | null
  starterChooserPlayerId: string | null
}

/** 从 payload 顶层或快照顶层取字段（首个非空生效；snapshot 优先） */
function probeSeriesField(p: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in p) return p[key]
  }
  return undefined
}

/** 依次扫描多个容器（sessionDoc → snapshot → payload 顶层），取首个命中的键值 */
function probeAny(containers: Record<string, unknown>[], keys: string[]): unknown {
  for (const c of containers) {
    const v = probeSeriesField(c, keys)
    if (v !== undefined) return v
  }
  return undefined
}

/** 一局事件的系列字段候选容器（sessionDoc 权威优先，兼容快照/顶层） */
function seriesContainers(p: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  if (isRecord(p.sessionDoc)) out.push(p.sessionDoc)
  if (isRecord(p.snapshot)) out.push(p.snapshot)
  out.push(p)
  return out
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** pendingGameResult 归一化：string（玩家 id/名）、对象（winner 字段候选）或
 *  {winnerByReporterPlayerId: {reporter: winnerId}}（取多数派胜者） */
function winnerFromPending(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (isRecord(v)) {
    const byReporter = isRecord(v.winnerByReporterPlayerId) ? v.winnerByReporterPlayerId : null
    if (byReporter) {
      const counts = new Map<string, number>()
      for (const w of Object.values(byReporter)) {
        const s = asString(w)
        if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
      }
      let best: string | null = null
      let bestN = 0
      for (const [id, n] of counts) {
        if (n > bestN) {
          best = id
          bestN = n
        }
      }
      return best
    }
    for (const key of ['winner', 'winnerPlayerId', 'playerId', 'winnerId']) {
      const w = asString(v[key])
      if (w) return w
    }
  }
  return null
}

/** 扫描一局全部 payload（顶层 + authoritative_snapshot.snapshot 顶层），聚合权威系列字段 */
export function extractSeriesFields(sessions: ReplaySession[]): SeriesFields {
  let seriesId: string | null = null
  let gameNumber: number | null = null
  let previousRoomCode: string | null = null
  let nextRoomCode: string | null = null
  let winsByPlayerId: Record<string, number> | null = null
  let pendingGameWinner: string | null = null
  let starterChooserPlayerId: string | null = null

  for (const s of sessions) {
    for (const ev of s.events) {
      const p = parsePayload(ev.payload)
      if (!isRecord(p)) continue
      const sid = asString(probeAny(seriesContainers(p), ['seriesId', 'series_id']))
      if (sid) seriesId = sid
      const gn = probeAny(seriesContainers(p), ['gameNumber', 'game_number'])
      if (typeof gn === 'number' && Number.isFinite(gn)) gameNumber = gn
      const prev = asString(
        probeAny(seriesContainers(p), ['previousRoomCode', 'previous_room_code'])
      )
      if (prev) previousRoomCode = prev
      const next = asString(probeAny(seriesContainers(p), ['nextRoomCode', 'next_room_code']))
      if (next) nextRoomCode = next
      const wins = probeAny(seriesContainers(p), ['winsByPlayerId', 'wins_by_player_id'])
      if (isRecord(wins)) {
        const normalized: Record<string, number> = {}
        for (const [pid, v] of Object.entries(wins)) {
          if (typeof v === 'number' && Number.isFinite(v)) normalized[pid] = v
        }
        if (Object.keys(normalized).length > 0) winsByPlayerId = normalized
      }
      const pending = probeAny(seriesContainers(p), [
        'pendingGameResult',
        'pending_result',
        'pendingGameWinner',
      ])
      if (pending !== undefined) {
        const w = winnerFromPending(pending)
        if (w) pendingGameWinner = w
      }
      const starter = asString(
        probeAny(seriesContainers(p), ['starterChooserPlayerId', 'starter_chooser_player_id'])
      )
      if (starter) starterChooserPlayerId = starter
    }
  }

  return {
    seriesId,
    gameNumber,
    previousRoomCode,
    nextRoomCode,
    winsByPlayerId,
    pendingGameWinner,
    starterChooserPlayerId,
  }
}

/** 把 pendingGameWinner 的玩家名映射回 playerId（优先精确名，兜底包含匹配） */
function resolvePendingWinnerId(
  name: string,
  players: Record<string, ReplayPlayer>
): string | null {
  for (const [pid, p] of Object.entries(players)) {
    if (p.name === name) return pid
  }
  for (const [pid, p] of Object.entries(players)) {
    if (p.name && p.name.includes(name)) return pid
  }
  if (name in players) return name
  return null
}

/** 从 winsByPlayerId 序列差分推断本局胜者（比上一局多 1 胜的玩家） */
function inferGameWinnerFromWins(
  wins: Record<string, number> | null,
  prevWins: Record<string, number> | null
): string | null {
  if (!wins) return null
  if (!prevWins) {
    const entries = Object.entries(wins).filter(([, n]) => n > 0)
    if (entries.length === 1) return entries[0][0]
    return null
  }
  const diffs = Object.entries(wins).filter(([pid, n]) => (prevWins[pid] ?? 0) < n)
  if (diffs.length === 1) return diffs[0][0]
  return null
}

/** 目标胜局数（bo1→1 / bo3→2 / bo5→3；未知格式保守取 1） */
function seriesWinTarget(format: string | null): number {
  const m = /bo(\d+)/i.exec(format ?? '')
  if (!m) return 1
  const total = parseInt(m[1], 10)
  return Math.ceil(total / 2)
}

/** 战场选择缺失兜底值 */
const EMPTY_BATTLEFIELD: BattlefieldSelection = {
  options: [],
  finalPick: null,
  isRandom: null,
  pickTimestamp: null,
}

/** 一局构建产物：game + series 聚合所需数据 */
export interface BuiltGame {
  game: RiftAtlasGame
  series: SeriesFields
  players: Record<string, ReplayPlayer>
  selfId: string | null
  queueFormat: string | null
  snapshotCount: number
  /** 回放统计阶段回填（快照最后非空先手） */
  firstPlayerId: string | null
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

  // 按房间分组（roomCode 为空的分到独立组）
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

  // 2. 按房间构建一局（session 排序、权威字段探测、玩家/战场/胜负）
  const builtByRoom: { roomKey: string; built: BuiltGame }[] = []
  for (const [roomCode, list] of byRoom) {
    builtByRoom.push({ roomKey: roomCode, built: buildGame(roomCode, list) })
  }
  roomless.forEach((list, i) =>
    builtByRoom.push({ roomKey: `roomless-${i + 1}`, built: buildGame(null, list) })
  )

  // 3. 每局的比分预填与统计（用回放引擎重建最终状态）
  for (const { built } of builtByRoom) {
    const g = built.game
    const build = buildReplay({
      roomCode: g.roomCode,
      sessions: g.telemetry.sessions,
      selfId: built.selfId,
    })
    g.telemetry.parseFailures = build?.parseFailures ?? 0
    g.telemetry.hasReplayableData = build !== null
    if (g.telemetry.parseFailures > 0)
      warnings.push(`${g.roomCode ?? '?'}：${g.telemetry.parseFailures} 个事件 payload 解析失败`)
    if (!build && g.telemetry.snapshotCount > 0) {
      warnings.push(`${g.roomCode ?? '?'}：只有快照没有补丁帧，数据不完整，无法回放`)
    }
    if (build) {
      const state = finalState(build)
      if (state) {
        const self = resolveSelfPlayer(state, built.selfId)
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
        g.score = score
        // 先手（room.firstPlayerId 可能在后来的快照里才出现，取最后一个非空）
        for (const snap of build.snapshots) {
          const v = snap.state.firstPlayerId
          if (typeof v === 'string' && v) built.firstPlayerId = v
        }
      }
      const ignored = Object.keys(build.ignoredOps)
      if (ignored.length > 0) {
        warnings.push(
          `${g.roomCode ?? '?'}：存在未识别的补丁操作 ${ignored.join(', ')}（共 ${Object.values(build.ignoredOps).reduce((a, b) => a + b, 0)} 次）`
        )
      }
    }
    if (g.telemetry.sessions.every((s) => s.isMatchmaking)) {
      warnings.push(`${g.roomCode ?? '?'}：只有匹配记录，无可回放的对局内容`)
    }
  }

  // 4. 按 seriesId 聚合 → 系列记录（无 seriesId 的 room 独立成单局系列）
  const bySeries = new Map<
    string,
    { seriesId: string | null; format: string | null; built: BuiltGame[] }
  >()
  for (const { roomKey, built } of builtByRoom) {
    const sid = built.series.seriesId
    if (sid) {
      const item = bySeries.get(sid) ?? { seriesId: sid, format: null, built: [] }
      if (!item.format) item.format = built.queueFormat
      item.built.push(built)
      bySeries.set(sid, item)
    } else {
      bySeries.set(`single:${roomKey}`, {
        seriesId: null,
        format: built.queueFormat,
        built: [built],
      })
    }
  }

  const groups: RiftAtlasMatchRecord[] = []
  for (const [aggKey, item] of bySeries) {
    const key = item.seriesId ?? item.built[0].game.roomCode ?? aggKey.replace(/^single:/, '')
    groups.push(
      buildSeriesRecord({
        key,
        seriesId: item.seriesId,
        format: item.format,
        built: item.built,
        firstPlayerId: item.built[0].firstPlayerId ?? null,
        warnings,
      })
    )
  }

  groups.sort((a, b) => a.meta.startedAt - b.meta.startedAt || a.key.localeCompare(b.key))

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

/**
 * 一局的规范化（Schema v3 的 game 级）：
 * session 排序、权威系列字段探测、自我/对手识别、卡组与传奇信息、战场选择。
 * 胜负/先手选择者取服务器权威值；score 等回放统计由调用方在 buildReplay 后回填。
 */
export function buildGame(roomCode: string | null, list: ReplaySession[]): BuiltGame {
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

  // 服务器权威系列字段（seriesId/gameNumber/链字段/胜负/先手选择者）
  const series = extractSeriesFields(sessions)

  // 本局战场选择：解析期只算一次（候选池/最终锁定/随机标记/时间戳），随记录持久化
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

  // 本局胜者：pendingGameResult 优先（名字 → id），差分推断兜底
  let winnerId = series.pendingGameWinner
    ? resolvePendingWinnerId(series.pendingGameWinner, players)
    : null
  if (!winnerId) winnerId = inferGameWinnerFromWins(series.winsByPlayerId, null)
  const starterChooserId =
    series.starterChooserPlayerId && series.starterChooserPlayerId in players
      ? series.starterChooserPlayerId
      : series.starterChooserPlayerId
        ? resolvePendingWinnerId(series.starterChooserPlayerId, players)
        : null

  const game: RiftAtlasGame = {
    gameNumber: series.gameNumber ?? 1,
    roomCode,
    gameInstanceId: null,
    previousRoomCode: series.previousRoomCode,
    nextRoomCode: series.nextRoomCode,
    winnerId,
    starterChooserPlayerId: starterChooserId,
    startedAt,
    endedAt,
    durationMs,
    score: {},
    battlefieldSelections: Object.fromEntries(battlefieldMap),
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

  return { game, series, players, selfId, queueFormat, snapshotCount, firstPlayerId: null }
}

/**
 * 系列级记录组装（Schema v3）：一局独立成系列或按 seriesId 聚合多局。
 * games 按 gameNumber 升序；玩家池跨局合并；系列胜负/比分取 winsByPlayerId 权威。
 */
export function buildSeriesRecord(opts: {
  key: string
  seriesId: string | null
  format: string | null
  built: BuiltGame[]
  firstPlayerId: string | null
  warnings: string[]
}): RiftAtlasMatchRecord {
  const { key, seriesId, format, built, firstPlayerId, warnings } = opts
  const games = [...built].sort(
    (a, b) => a.game.gameNumber - b.game.gameNumber || a.game.startedAt - b.game.startedAt
  )

  // 玩家池跨局合并：legend/deck 取首个有数据的局；名字取最后已知
  const players: Record<string, ReplayPlayer> = {}
  for (const b of games) {
    for (const [pid, p] of Object.entries(b.players)) {
      const existing = players[pid]
      if (!existing) {
        players[pid] = p
        continue
      }
      existing.name = p.name ?? existing.name
      if (!existing.legend && p.legend) existing.legend = p.legend
      if (!existing.deck && p.deck) existing.deck = p.deck
      if (!existing.decklistRaw && p.decklistRaw) existing.decklistRaw = p.decklistRaw
      if (!existing.battlefield.finalPick && p.battlefield.finalPick)
        existing.battlefield = p.battlefield
    }
  }

  // 系列胜负：最后已知 winsByPlayerId → 达到目标胜局的玩家为系列胜者
  const lastWins =
    [...games].reverse().find((b) => b.series.winsByPlayerId)?.series.winsByPlayerId ?? null
  const target = seriesWinTarget(format)
  let seriesWinnerId: string | null = null
  if (lastWins) {
    const candidates = Object.entries(lastWins)
      .filter(([, n]) => n >= target)
      .sort((a, b) => b[1] - a[1])
    if (candidates.length > 0) seriesWinnerId = candidates[0][0]
  }

  // 链验证：previous/nextRoomCode 交叉检查（仅警告不阻断）
  const roomByNumber = new Map<number, string>()
  for (const b of games) {
    if (b.game.roomCode) roomByNumber.set(b.game.gameNumber, b.game.roomCode)
  }
  for (const b of games) {
    const g = b.game
    if (g.previousRoomCode && g.gameNumber > 1) {
      const expect = roomByNumber.get(g.gameNumber - 1)
      if (expect && expect !== g.previousRoomCode) {
        warnings.push(
          `${key}：第 ${g.gameNumber} 局 previousRoomCode 与第 ${g.gameNumber - 1} 局房间不一致（${g.previousRoomCode} ≠ ${expect}）`
        )
      }
    }
  }

  const first = games[0]
  const last = games[games.length - 1]
  const totalEvents = games.reduce((s, b) => s + b.game.telemetry.totalEvents, 0)
  const snapshotTotal = games.reduce((s, b) => s + b.game.telemetry.snapshotCount, 0)
  const reconnectTotal = games.reduce((s, b) => s + b.game.telemetry.reconnectCount, 0)
  const parseTotal = games.reduce((s, b) => s + b.game.telemetry.parseFailures, 0)
  const replayable = games.some((b) => b.game.telemetry.hasReplayableData)

  const score: Record<string, number> = {}
  if (lastWins) {
    for (const [pid, n] of Object.entries(lastWins)) {
      if (pid in players) score[pid] = n
    }
  }

  return {
    key,
    meta: {
      seriesId,
      roomCode: first.game.roomCode,
      format,
      startedAt: first.game.startedAt,
      endedAt: last.game.endedAt,
      durationMs:
        last.game.endedAt !== null && first.game.startedAt
          ? last.game.endedAt - first.game.startedAt
          : null,
      firstPlayerId,
    },
    perspective: { localPlayerId: built[0]?.selfId ?? null },
    players,
    result: { winnerId: seriesWinnerId, score },
    games: games.map((b) => b.game),
    telemetry: {
      totalEvents,
      snapshotCount: snapshotTotal,
      reconnectCount: reconnectTotal,
      parseFailures: parseTotal,
      hasReplayableData: replayable,
      sessions: [],
      matchmakingSession: null,
    },
  }
}

// ==================== v1 / v2 → v3 迁移（一次性，仅旧磁盘文件） ====================

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

/** 旧库迁移：v1 对局记录 → v3 RiftAtlasMatchRecord（基于 sessions 重建，语义与重新导入一致） */
export function migrateV1Group(g: V1ReplayGroup): RiftAtlasMatchRecord {
  const built = buildGame(g.roomCode, g.sessions)
  const selfId = built.selfId
  let oppId: string | null = null
  for (const pid of Object.keys(built.players)) {
    if (pid !== selfId) {
      oppId = pid
      break
    }
  }

  // 保留 v1 已算好的结果（与重建等价，但含当时已识别的名字等）
  if (selfId && g.selfName && built.players[selfId]) built.players[selfId].name = g.selfName
  if (oppId && g.opponentName && built.players[oppId]) built.players[oppId].name = g.opponentName
  built.game.telemetry.hasReplayableData = g.hasReplayableData
  built.game.telemetry.parseFailures = g.parseFailures
  built.game.telemetry.snapshotCount = g.snapshotCount
  built.game.telemetry.totalEvents = g.totalEvents
  built.game.telemetry.reconnectCount = g.reconnectCount
  const score: Record<string, number> = {}
  if (selfId && typeof g.finalScore?.my === 'number') score[selfId] = g.finalScore.my
  if (oppId && typeof g.finalScore?.opp === 'number') score[oppId] = g.finalScore.opp
  built.game.score = score

  return buildSeriesRecord({
    key: g.key ?? g.roomCode ?? 'unknown',
    seriesId: built.series.seriesId,
    format: g.queueFormat ?? built.queueFormat,
    built: [built],
    firstPlayerId: g.firstPlayerId ?? null,
    warnings: [],
  })
}

/**
 * 旧库迁移：v2 单局记录 → v3 系列记录。
 * v2 的 telemetry.sessions 整体挪进单局 game，胜负/比分原样保留。
 */
export function migrateV2ToV3(g: RiftAtlasMatchRecord): RiftAtlasMatchRecord {
  if (Array.isArray(g.games) && g.games.length > 0) return g
  const sessions = g.telemetry?.sessions ?? []
  const first = g.players
  const game: RiftAtlasGame = {
    gameNumber: 1,
    roomCode: g.meta?.roomCode ?? null,
    gameInstanceId: null,
    previousRoomCode: null,
    nextRoomCode: null,
    winnerId: null,
    starterChooserPlayerId: null,
    startedAt: g.meta?.startedAt ?? 0,
    endedAt: g.meta?.endedAt ?? null,
    durationMs: g.meta?.durationMs ?? null,
    score: g.result?.score ?? {},
    battlefieldSelections: Object.fromEntries(
      Object.entries(first ?? {}).map(([pid, p]) => [pid, p?.battlefield])
    ),
    telemetry: g.telemetry,
  }
  return {
    key: g.key,
    meta: {
      seriesId: null,
      roomCode: g.meta?.roomCode ?? null,
      format: g.meta?.format ?? null,
      startedAt: g.meta?.startedAt ?? 0,
      endedAt: g.meta?.endedAt ?? null,
      durationMs: g.meta?.durationMs ?? null,
      firstPlayerId: g.meta?.firstPlayerId ?? null,
    },
    perspective: g.perspective,
    players: g.players,
    result: { winnerId: null, score: g.result?.score ?? {} },
    games: [game],
    telemetry: {
      totalEvents: g.telemetry?.totalEvents ?? sessions.reduce((s, x) => s + x.events.length, 0),
      snapshotCount: g.telemetry?.snapshotCount ?? 0,
      reconnectCount: g.telemetry?.reconnectCount ?? 0,
      parseFailures: g.telemetry?.parseFailures ?? 0,
      hasReplayableData: g.telemetry?.hasReplayableData ?? false,
      sessions: [],
      matchmakingSession: null,
    },
  }
}
