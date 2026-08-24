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

import type { BattlefieldSelection, ReplaySession } from './types.js'

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
  /** 本局选定的战场（英文卡名，如 "Shadow Temple"） */
  selectedBattlefield?: string | null
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

/** 回放关键帧（回合切换 / 阶段切换 / 得分变化） */
export interface ReplayKeyframe {
  frame: number
  kind: 'turn' | 'phase' | 'score'
  value: number | string
  /** score 专用：得分玩家 id */
  playerId?: string | null
  /** score 专用：本次获得/变化的分数 */
  delta?: number | null
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

/** 宽容解析 payload：字符串走 JSON.parse（失败返 null），已解析对象直接用 */
function parsePayloadObject(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === 'string') {
    try {
      const v = JSON.parse(payload)
      return isRecord(v) ? v : null
    } catch {
      return null
    }
  }
  return isRecord(payload) ? payload : null
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
      // cloneState：op 携带的卡对象与 build.frames 共享引用，直接插入会被后续 patch
      // 原地改写（跨帧污染），克隆后插入保证每帧状态相互独立。
      ;(op.cards ?? []).forEach((c, i) => z.splice(idx + i, 0, cloneState(c)))
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
      // op.card 与 build.frames 共享引用，克隆后插入，避免跨帧污染（见 zone_insert）
      to.splice(idx, 0, op.card ? cloneState(op.card) : card)
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
        state.chainEntries!.splice(idx + i, 0, cloneState(en) as ChainEntry)
      )
      return true
    }
    case 'chain_remove': {
      const ids = new Set<string | undefined>(op.entryIds ?? [])
      state.chainEntries = (state.chainEntries ?? []).filter((en) => !ids.has(en.id))
      return true
    }
    case 'chain_replace': {
      // 整体替换同样克隆，避免与 build.frames 共享引用导致跨帧污染
      state.chainEntries = (op.entries ?? []).map((en) => cloneState(en) as ChainEntry)
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

/** 判定服务端阶段是否处于「对局进行中」（实测快照 phase 值为 in_game） */
function isInGamePhase(phase: unknown): boolean {
  if (typeof phase !== 'string' || !phase) return false
  const p = phase.toLowerCase()
  return p === 'in_game' || p.includes('in_game') || p.includes('ingame')
}

/**
 * 找到「回合 1 进入 in_game 阶段」的帧下标，作为打开对局时的初始帧（跳过选战场/调度等前期阶段）。
 * 逐帧增量推演（base 快照变化时重置运行态），O(总 ops)。
 * 找不到 in_game 时回退到回合 1 首帧；再找不到回退第 0 帧。
 */
export function findTurnOneInGameFrame(build: ReplayBuild): number {
  const frames = build.frames
  if (frames.length === 0) return 0
  let state: GameState | null = null
  let lastBase = -1
  let firstTurnOne: number | null = null
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const baseKey = f.base ? f.base.atFrame : -1
    if (baseKey !== lastBase) {
      lastBase = baseKey
      state = cloneState(f.base ? f.base.state : { players: [] })
    }
    if (!state) continue
    applyFrame(state, f)
    const tn = typeof state.turnNumber === 'number' ? state.turnNumber : null
    if (tn === 1) {
      if (firstTurnOne === null) firstTurnOne = i
      if (isInGamePhase(state.phase)) return i
    }
  }
  return firstTurnOne ?? 0
}

/**
 * 收集关键帧：回合切换 / 阶段切换 / 得分变化。
 * 逐帧增量推演（base 快照变化时重置运行态），比只扫快照更精确，
 * 能在补丁帧之间检测到变化。复杂度 O(总 ops)，每局只算一次。
 */
export function collectKeyframes(build: ReplayBuild): ReplayKeyframe[] {
  const frames = build.frames
  if (frames.length === 0) return []
  const out: ReplayKeyframe[] = []
  let state: GameState | null = null
  let lastBase = -1
  let lastTurn: number | null = null
  let lastPhase: string | null = null
  const scores = new Map<string, number>()

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const baseKey = f.base ? f.base.atFrame : -1
    if (baseKey !== lastBase) {
      lastBase = baseKey
      state = cloneState(f.base ? f.base.state : { players: [] })
      lastTurn = typeof state.turnNumber === 'number' ? state.turnNumber : null
      lastPhase = typeof state.phase === 'string' && state.phase ? state.phase : null
      scores.clear()
      for (const pl of state.players ?? []) {
        const s = typeof pl.board?.score === 'number' ? pl.board.score : 0
        scores.set(pl.id, s)
      }
    }
    if (!state) continue
    applyFrame(state, f)

    const tn = typeof state.turnNumber === 'number' ? state.turnNumber : null
    if (tn !== null && tn !== lastTurn) {
      lastTurn = tn
      out.push({ frame: i, kind: 'turn', value: tn })
    }
    const ph = typeof state.phase === 'string' && state.phase ? state.phase : null
    if (ph !== null && ph !== lastPhase) {
      lastPhase = ph
      out.push({ frame: i, kind: 'phase', value: ph })
    }
    for (const pl of state.players ?? []) {
      const s = typeof pl.board?.score === 'number' ? pl.board.score : 0
      const prev = scores.get(pl.id)
      if (prev !== undefined && s !== prev) {
        scores.set(pl.id, s)
        out.push({ frame: i, kind: 'score', value: s, playerId: pl.id, delta: s - prev })
      }
    }
  }
  return out
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

// ==================== 战场选择提取 ====================

/** 可参与事件扫描的最简事件形态（RiftEvent 及自定义 { payload: string } 均兼容） */
export interface SnapshotCandidateEvent {
  payload?: unknown
  ts?: number
  seq?: number
}

/** 战场候选池的结构化字段候选名（服务端无稳定契约，宽容探测） */
const BATTLEFIELD_OPTION_FIELDS = [
  'battlefieldOptions',
  'options',
  'battlefieldPool',
  'candidates',
] as const

/** 战场值归一化（兼容 string 与 { cardCode }）；string 顺手 trim 统一 key */
function toBattlefieldCode(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (isRecord(value) && typeof value.cardCode === 'string' && value.cardCode.trim()) {
    return value.cardCode.trim()
  }
  return null
}

/** 候选池归一化（兼容 string[] 与 { cardCode }[]） */
function toOptionCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const code = toBattlefieldCode(item)
    if (code) out.push(code)
  }
  return out
}

/** 结构化候选池探测：按候选字段名依次取，第一个非空生效（缺失兜底为空数组） */
function probeOptionCodes(fields: Record<string, unknown>): string[] {
  for (const key of BATTLEFIELD_OPTION_FIELDS) {
    if (key in fields) {
      const options = toOptionCodes(fields[key])
      if (options.length > 0) return options
    }
  }
  return []
}

/**
 * 从一堆 events 提取某局（可选按 gameInstanceId 过滤）每位玩家的战场选择过程数据
 * （候选池 / 最终锁定 / 随机标记 / 锁定时间戳）。
 *
 * 数据源（结构化为主）：authoritative_patch_commit 中 op='set_player_fields' 且 fields 含
 * selectedBattlefield（或候选池字段）的块（不依赖 Chat/Log 文本，无截断/延迟问题）。
 * 兜底：op 流缺失时扫描快照 payload 的 players[]（服务端权威状态）。
 * 同一玩家多次出现时以最后一条生效为准：先按 (ts → seq → 原数组下标) 排序副本
 * （不改原数组），再逐条覆盖，后写胜出。
 * 推断为辅：isRandom 无结构化标记但 finalPick 不在候选池时推断为 true；缺失兜底不抛错。
 */
export function extractBattlefieldSelections(
  events: ReadonlyArray<SnapshotCandidateEvent>,
  gameInstanceId?: string | null
): Map<string, BattlefieldSelection> {
  interface Pick {
    ts: number | null
    seq: number | null
    index: number
    playerId: string
    battlefield: string | null
    options: string[]
    isRandom: boolean | null
  }
  const picks: Pick[] = []

  const pushPick = (index: number, playerId: unknown, value: unknown, raw: unknown) => {
    if (typeof playerId !== 'string' || !playerId) return
    const battlefield = toBattlefieldCode(value)
    const fields = isRecord(raw) ? raw : {}
    const options = probeOptionCodes(fields)
    if (battlefield === null && options.length === 0) return
    const randomFlag = fields.random ?? fields.isRandom
    const isRandom = typeof randomFlag === 'boolean' ? randomFlag : null
    const ev = events[index]
    picks.push({
      ts: typeof ev?.ts === 'number' ? ev.ts : null,
      seq: typeof ev?.seq === 'number' ? ev.seq : null,
      index,
      playerId,
      battlefield,
      options,
      isRandom,
    })
  }

  events.forEach((ev, index) => {
    const p = parsePayloadObject(ev.payload)
    if (!p) return
    if (gameInstanceId != null && p.gameInstanceId !== gameInstanceId) return

    // 主路径：patch.operations 里的 set_player_fields 块
    if (isRecord(p.patch) && Array.isArray(p.patch.operations)) {
      for (const raw of p.patch.operations as unknown[]) {
        if (!isRecord(raw)) continue
        if (raw.op !== 'set_player_fields' || !isRecord(raw.fields)) continue
        if (!('selectedBattlefield' in raw.fields)) continue
        pushPick(index, raw.playerId, raw.fields.selectedBattlefield, raw.fields)
      }
    }

    // 防御性：顶层 op 形态
    if (p.op === 'set_player_fields' && isRecord(p.fields) && 'selectedBattlefield' in p.fields) {
      pushPick(index, p.playerId, p.fields.selectedBattlefield, p.fields)
    }
    // 兜底：权威快照 players[] 自带（服务端全量状态）
    if (
      p.type === 'authoritative_snapshot' &&
      isRecord(p.snapshot) &&
      Array.isArray(p.snapshot.players)
    ) {
      for (const pl of p.snapshot.players as unknown[]) {
        if (isRecord(pl)) pushPick(index, pl.id, pl.selectedBattlefield, pl)
      }
    }
  })

  if (picks.length === 0) return new Map()
  picks.sort((a, b) => {
    if (a.ts !== null && b.ts !== null && a.ts !== b.ts) return a.ts - b.ts
    if (a.seq !== null && b.seq !== null && a.seq !== b.seq) return a.seq - b.seq
    return a.index - b.index
  })

  // 后写胜出：同玩家多条只保留最后一条
  const last = new Map<string, Pick>()
  for (const pick of picks) last.set(pick.playerId, pick)

  const result = new Map<string, BattlefieldSelection>()
  for (const [playerId, pick] of last) {
    let isRandom = pick.isRandom
    // 推断为辅：无结构化标记但最终锁定不在候选池 → 视为随机
    if (isRandom === null && pick.options.length > 0 && pick.battlefield !== null) {
      if (!pick.options.includes(pick.battlefield)) isRandom = true
    }
    result.set(playerId, {
      options: pick.options,
      finalPick: pick.battlefield,
      isRandom,
      pickTimestamp: pick.ts,
    })
  }
  return result
}
