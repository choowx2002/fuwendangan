/**
 * Rift Atlas 对局回放引擎（M0 纯函数层）
 *
 * 逻辑移植自临时 demo replay.html，并补齐实测发现的操作类型：
 * - chain_replace（整体替换 Chain）
 * - unset_board_fields（删除玩家 board 字段）
 *
 * 多 session（断线重连）合并：组内全部事件按 ts 合并排序，重连后服务器重发全量快照，
 * sequence 无缝衔接，回放天然连续；在 session 边界处标记帧并插入 reconnect 解说条目。
 */

import type { ReplaySession } from './types.js'

// ==================== 状态与操作类型 ====================

/** 对局状态（宽松结构，字段随服务端扩展） */
export interface GameState {
  phase?: string | null
  turnNumber?: number | null
  activeTurnPlayerId?: string | null
  chainEntries?: ChainEntry[]
  players?: GamePlayer[]
  [key: string]: unknown
}

export interface GamePlayer {
  id: string
  seat?: number | null
  name?: string | null
  decklistRaw?: string | null
  deck?: { sections?: unknown } | null
  board?: Record<string, unknown>
  [key: string]: unknown
}

export interface ChainEntry {
  id?: string
  card?: unknown
  [key: string]: unknown
}

/** 服务端补丁操作（字段全部可选，宽容解析） */
export interface ReplayOp {
  op: string
  playerId?: string | null
  zone?: string | null
  index?: number | null
  cardIds?: string[] | null
  cards?: unknown[] | null
  cardId?: string | null
  card?: unknown | null
  from?: { playerId?: string; zone?: string; index?: number } | null
  to?: { playerId?: string; zone?: string; index?: number } | null
  fields?: Record<string, unknown> | string[] | null
  entries?: unknown[] | null
  entryIds?: string[] | null
}

/** 已知操作全集（用于统计被忽略的未知 op） */
export const KNOWN_OPS = new Set([
  'zone_insert',
  'zone_remove',
  'zone_move',
  'zone_reorder',
  'patch_card_fields',
  'unset_card_fields',
  'set_player_fields',
  'set_board_fields',
  'unset_board_fields',
  'set_room_fields',
  'unset_room_fields',
  'chain_insert',
  'chain_remove',
  'chain_replace',
  'log_insert',
  'log_remove',
])

// ==================== 帧与构建结果 ====================

export interface NarrationEntry {
  ts: number
  text: string
  /** 归属帧下标 */
  at: number
  kind: 'log' | 'chat' | 'reconnect'
  sessionId: string | null
}

export interface ReplayFrame {
  /** 服务端权威 sequence */
  seq: number
  ts: number
  sessionId: string
  ops: ReplayOp[]
  logs: NarrationEntry[]
  /** 本帧是否为 session 边界（重连后的第一帧） */
  isSessionBoundary: boolean
  /** 回放时使用的 base 快照（构建阶段回填） */
  base?: SnapshotRef | null
  /** base 快照所在帧下标（构建阶段回填） */
  baseStart?: number
}

export interface SnapshotRef {
  seq: number
  ts: number
  sessionId: string
  state: GameState
  atFrame: number
}

export interface ReplayBuild {
  roomCode: string | null
  frames: ReplayFrame[]
  snapshots: SnapshotRef[]
  narration: NarrationEntry[]
  selfId: string | null
  sessionCount: number
  /** 被忽略的未知 op 统计 */
  ignoredOps: Record<string, number>
  /** payload 解析失败数 */
  parseFailures: number
}

export interface BuildReplayInput {
  roomCode: string | null
  sessions: ReplaySession[]
  selfId?: string | null
}

// ==================== 工具 ====================

/** 解析事件 payload（字符串 JSON），失败返回 null */
export function parsePayload(raw: string): unknown {
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 深拷贝状态。
 * 注意：不能用 structuredClone —— 状态对象可能是 Svelte $state 深代理（ReplayViewer 中
 * build 为 $state，读取嵌套快照会得到 Proxy），structuredClone(Proxy) 会抛 DataCloneError。
 * JSON 拷贝对纯 JSON 数据（快照/补丁）安全且 Proxy 透明（读取走 get trap 返回原始值）。
 */
function cloneState<T>(v: T): T {
  return v == null ? v : (JSON.parse(JSON.stringify(v)) as T)
}

function zoneOf(
  state: GameState,
  playerId: string | null | undefined,
  zone: string | null | undefined
): unknown[] | null {
  if (!playerId || !zone) return null
  const pl = (state.players ?? []).find((p) => p.id === playerId)
  const z = pl?.board?.[zone]
  return Array.isArray(z) ? z : null
}

/** 按 id 查找区内卡牌；隐藏占位 `__hidden_zone__:{pid}:{zone}:{index}` 按序号映射 */
function findCardInZone(z: unknown[], id: string | null | undefined): unknown | null {
  if (!id) return null
  const exact = z.find((c) => isRecord(c) && c.id === id)
  if (exact) return exact
  const mm = /^__hidden_zone__:[^:]+:[^:]+:(\d+)$/.exec(String(id))
  if (mm) {
    const i = Number(mm[1])
    if (z[i]) return z[i]
  }
  return null
}

// ==================== 补丁应用 ====================

/**
 * 应用单个补丁操作到状态。
 * @returns true 表示已识别并应用，false 表示未知 op（已忽略）
 */
export function applyOp(state: GameState, op: ReplayOp): boolean {
  switch (op.op) {
    case 'zone_insert': {
      const z = zoneOf(state, op.playerId, op.zone)
      if (!z) break
      const idx = Math.min(op.index == null ? z.length : op.index, z.length)
      ;(op.cards ?? []).forEach((c, i) => z.splice(idx + i, 0, c))
      return true
    }
    case 'zone_remove': {
      const z = zoneOf(state, op.playerId, op.zone)
      if (!z) break
      const found: unknown[] = []
      for (const id of op.cardIds ?? []) {
        const c = findCardInZone(z, id)
        if (c && !found.includes(c)) found.push(c)
      }
      for (const c of found) {
        const i = z.indexOf(c)
        if (i >= 0) z.splice(i, 1)
      }
      return true
    }
    case 'zone_move': {
      const from = zoneOf(state, op.from?.playerId, op.from?.zone)
      const to = zoneOf(state, op.to?.playerId, op.to?.zone)
      if (!from || !to) break
      const card = findCardInZone(from, op.cardId)
      if (!card) break
      const i = from.indexOf(card)
      from.splice(i, 1)
      const idx = Math.min(op.to?.index == null ? to.length : op.to.index, to.length)
      to.splice(idx, 0, op.card ?? card)
      return true
    }
    case 'zone_reorder': {
      const z = zoneOf(state, op.playerId, op.zone)
      if (!z) break
      const ordered: unknown[] = []
      for (const id of op.cardIds ?? []) {
        const c = findCardInZone(z, id)
        if (c && !ordered.includes(c)) ordered.push(c)
      }
      for (const c of z) if (!ordered.includes(c)) ordered.push(c)
      z.length = 0
      z.push(...ordered)
      return true
    }
    case 'patch_card_fields': {
      const z = zoneOf(state, op.playerId, op.zone)
      if (!z) break
      const c = findCardInZone(z, op.cardId)
      if (c && isRecord(c) && isRecord(op.fields)) Object.assign(c, op.fields)
      return true
    }
    case 'unset_card_fields': {
      const z = zoneOf(state, op.playerId, op.zone)
      if (!z) break
      const c = findCardInZone(z, op.cardId)
      if (c && isRecord(c) && Array.isArray(op.fields)) {
        for (const k of op.fields) delete c[k]
      }
      return true
    }
    case 'set_player_fields': {
      const pl = (state.players ?? []).find((p) => p.id === op.playerId)
      if (pl && isRecord(op.fields)) Object.assign(pl, op.fields)
      return true
    }
    case 'set_board_fields': {
      const pl = (state.players ?? []).find((p) => p.id === op.playerId)
      if (pl && isRecord(pl.board) && isRecord(op.fields)) Object.assign(pl.board, op.fields)
      return true
    }
    case 'unset_board_fields': {
      const pl = (state.players ?? []).find((p) => p.id === op.playerId)
      if (pl && isRecord(pl.board) && Array.isArray(op.fields)) {
        for (const k of op.fields) delete pl.board[k]
      }
      return true
    }
    case 'set_room_fields': {
      if (isRecord(op.fields)) Object.assign(state, op.fields)
      return true
    }
    case 'unset_room_fields': {
      if (Array.isArray(op.fields)) {
        for (const k of op.fields) delete state[k]
      }
      return true
    }
    case 'chain_insert': {
      if (!Array.isArray(state.chainEntries)) state.chainEntries = []
      const idx = Math.min(
        op.index == null ? state.chainEntries.length : op.index,
        state.chainEntries.length
      )
      ;(op.entries ?? []).forEach((en, i) =>
        state.chainEntries!.splice(idx + i, 0, en as ChainEntry)
      )
      return true
    }
    case 'chain_remove': {
      const ids = new Set<string | undefined>(op.entryIds ?? [])
      state.chainEntries = (state.chainEntries ?? []).filter((en) => !ids.has(en.id))
      return true
    }
    case 'chain_replace': {
      state.chainEntries = (op.entries ?? []) as ChainEntry[]
      return true
    }
    // log 类操作只影响服务端对局日志，不影响状态；narration 为历史记录，无需回滚
    case 'log_insert':
    case 'log_remove':
      return true
    default:
      return false
  }
  return true
}

export function applyFrame(state: GameState, frame: ReplayFrame): void {
  for (const op of frame.ops) applyOp(state, op)
}

// ==================== 构建与取帧 ====================

/**
 * 构建一局（一个房间）的回放数据：
 * 合并全部 session 事件按 ts 排序 → 抽快照/补丁帧/解说，回填每帧的 base 快照。
 * 无任何补丁帧时返回 null。
 */
export function buildReplay(input: BuildReplayInput): ReplayBuild | null {
  const sessions = input.sessions
  const events = sessions.flatMap((s, si) =>
    s.events.map((e) => ({ ...e, _sessionId: s.sessionId, _sessionIndex: si }))
  )
  events.sort((a, b) => a.ts - b.ts || a.seq - b.seq || a._sessionIndex - b._sessionIndex)

  const frames: ReplayFrame[] = []
  const snapshots: SnapshotRef[] = []
  const narration: NarrationEntry[] = []
  const ignoredOps: Record<string, number> = {}
  let parseFailures = 0
  let lastSessionId: string | null = null

  for (const ev of events) {
    const sessionId = ev._sessionId
    const p = parsePayload(ev.payload)
    if (!isRecord(p)) {
      parseFailures++
      continue
    }
    if (p.type === 'authoritative_snapshot') {
      const seq = typeof p.sequence === 'number' ? p.sequence : 0
      if (isRecord(p.snapshot)) {
        snapshots.push({
          seq,
          ts: ev.ts,
          sessionId,
          state: p.snapshot as GameState,
          atFrame: frames.length,
        })
      }
    } else if (p.type === 'authoritative_patch_commit') {
      const ops: ReplayOp[] = []
      const logs: NarrationEntry[] = []
      const rawOps = (
        isRecord(p.patch) && Array.isArray(p.patch.operations) ? p.patch.operations : []
      ) as unknown[]
      for (const raw of rawOps) {
        if (!isRecord(raw)) continue
        const op = raw as unknown as ReplayOp
        if (!KNOWN_OPS.has(op.op)) ignoredOps[op.op] = (ignoredOps[op.op] ?? 0) + 1
        ops.push(op)
        if (op.op === 'log_insert') {
          for (const en of (op.entries ?? []) as unknown[]) {
            if (isRecord(en)) {
              logs.push({
                ts: typeof en.at === 'number' ? en.at : ev.ts,
                text: typeof en.text === 'string' ? en.text : '',
                at: frames.length,
                kind: 'log',
                sessionId,
              })
            }
          }
        }
      }
      const isBoundary = lastSessionId !== null && sessionId !== lastSessionId
      frames.push({
        seq: typeof p.sequence === 'number' ? p.sequence : ev.seq,
        ts: ev.ts,
        sessionId,
        ops,
        logs,
        isSessionBoundary: isBoundary,
      })
      narration.push(...logs)
      if (isBoundary) {
        narration.push({
          ts: ev.ts,
          text: '',
          at: frames.length - 1,
          kind: 'reconnect',
          sessionId,
        })
      }
      lastSessionId = sessionId
    } else if (p.type === 'chat_append') {
      const en = isRecord(p.entry) ? p.entry : null
      if (en && typeof en.text === 'string') {
        let at = frames.length - 1
        for (let i = 0; i < frames.length; i++) {
          if ((frames[i].ts ?? 0) >= (typeof en.at === 'number' ? en.at : ev.ts)) {
            at = i
            break
          }
        }
        narration.push({
          ts: typeof en.at === 'number' ? en.at : ev.ts,
          text: (typeof en.author === 'string' ? en.author + ': ' : '') + en.text,
          at: Math.max(at, 0),
          kind: 'chat',
          sessionId,
        })
      }
    }
  }

  if (frames.length === 0) return null

  // 每帧回填 base 快照（seq 不晚于帧、且帧序不晚于帧）
  let si = 0
  for (let i = 0; i < frames.length; i++) {
    while (
      si + 1 < snapshots.length &&
      snapshots[si + 1].seq <= frames[i].seq &&
      snapshots[si + 1].atFrame <= i
    )
      si++
    const base = snapshots[si]
    if (base && base.atFrame <= i) {
      frames[i].base = base
      frames[i].baseStart = base.atFrame
    }
  }

  return {
    roomCode: input.roomCode,
    frames,
    snapshots,
    narration,
    selfId: input.selfId ?? null,
    sessionCount: sessions.length,
    ignoredOps,
    parseFailures,
  }
}

/**
 * 还原第 index 帧的完整状态：克隆 base 快照并依次应用 baseStart..index 的补丁。
 * 帧不存在时返回 null。
 */
export function stateAt(build: ReplayBuild, index: number): GameState | null {
  const frame = build.frames[index]
  if (!frame) return null
  const base = frame.base
  const state: GameState = base ? cloneState(base.state) : { players: [] }
  const start = frame.baseStart ?? 0
  for (let k = start; k <= index; k++) applyFrame(state, build.frames[k])
  return state
}

/** 最终状态（最后一帧），无帧时返回 null */
export function finalState(build: ReplayBuild): GameState | null {
  if (build.frames.length === 0) return null
  return stateAt(build, build.frames.length - 1)
}

/** 从状态中解析「我方」：优先 selfId，其次带 decklistRaw 的玩家，再 seat 0，最后第一个玩家 */
export function resolveSelfPlayer(state: GameState, selfId: string | null): GamePlayer | null {
  const players = state.players ?? []
  if (selfId) {
    const exact = players.find((p) => p.id === selfId)
    if (exact) return exact
  }
  return (
    players.find((p) => !!p.decklistRaw) ?? players.find((p) => p.seat === 0) ?? players[0] ?? null
  )
}
