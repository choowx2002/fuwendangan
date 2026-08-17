/**
 * Rift Atlas 对局导入：类型定义（M0 纯函数层）
 *
 * 数据来源：Rift Atlas 扩展导出的 JSON（meta.version 0.2.x 实测）。
 * 关键认知：一个 roomCode = 一局游戏；同一房间内多条记录 = 断线重连的多个 session。
 */

// ==================== 原始导出格式（尽量宽松，容忍未知字段） ====================

export interface RiftExportMeta {
  exporter?: string | null
  version?: string | null
  exportedAt?: string | null
}

export interface RiftEvent {
  seq: number
  ts: number
  direction: string
  kind?: string | null
  size?: number | null
  /** 事件信封上的类型（可为 null；真实类型以 payload.type 为准） */
  type?: string | null
  /** ⚠️ 字符串形式的 JSON，需 parsePayload 解析 */
  payload: string
}

export interface RiftMatchRecord {
  sessionId: string
  roomCode?: string | null
  url?: string | null
  startedAt: number
  endedAt?: number | null
  durationMs?: number | null
  state?: string | null
  reason?: string | null
  eventCount?: number | null
  lastSeq?: number | null
  events: RiftEvent[]
  [key: string]: unknown
}

export interface RiftExport {
  meta?: RiftExportMeta | null
  matchCount?: number | null
  eventCount?: number | null
  matches?: RiftMatchRecord[] | null
}

// ==================== 规范化模型 ====================

export interface ReplaySession {
  sessionId: string
  /** 是否为匹配队列会话（URL 含 /matchmaking/，无对局内容，仅元数据） */
  isMatchmaking: boolean
  startedAt: number
  endedAt: number | null
  reason: string | null
  events: RiftEvent[]
  raw: RiftMatchRecord
}

export interface DeckSectionEntry {
  count: number
  name: string
  cardCode: string
}

export interface DeckSections {
  legend: DeckSectionEntry[]
  champion: DeckSectionEntry[]
  mainDeck: DeckSectionEntry[]
  battlefield: DeckSectionEntry[]
  rune: DeckSectionEntry[]
  sideboard: DeckSectionEntry[]
}

/** 一个房间 = 一局游戏（可能包含多个重连 session） */
export interface ReplayGroup {
  key: string
  roomCode: string | null
  /** 全部 session（含匹配会话），按 startedAt 升序 */
  sessions: ReplaySession[]
  /** 非匹配的游戏 session */
  gameSessions: ReplaySession[]
  matchmakingSession: ReplaySession | null
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  /** 队列赛制（payload matchFormat 或 URL bo{n}；实测恒为 bo1，仅展示用） */
  queueFormat: string | null
  selfPlayerId: string | null
  selfName: string | null
  opponentPlayerId: string | null
  opponentName: string | null
  selfDecklistRaw: string | null
  /** 我方卡组分区（从快照 deck.sections 规范化，无则为 null） */
  selfSections: DeckSections | null
  /** 我方传奇（卡组 sections 优先，快照 board.legend 兜底） */
  selfLegend: DeckSectionEntry | null
  opponentDecklistRaw: string | null
  opponentLegend: DeckSectionEntry | null
  totalEvents: number
  sessionCount: number
  /** 重连次数 = 游戏 session 数 - 1 */
  reconnectCount: number
  /** 是否有可回放数据（任意快照或补丁帧） */
  hasReplayableData: boolean
  /** 最终状态重建后的比分预填（我方/对方），无数据时为 null */
  finalScore: { my: number | null; opp: number | null } | null
  /** 本局先手玩家 id（快照 room.firstPlayerId，缺失为 null） */
  firstPlayerId: string | null
  /** 本局事件 payload 解析失败数 */
  parseFailures: number
  /** 权威快照事件数（无补丁帧但存在快照 = 数据不完整） */
  snapshotCount: number
}

export interface ImportBundle {
  fileName: string | null
  meta: RiftExportMeta
  rawMatchCount: number
  groups: ReplayGroup[]
  warnings: string[]
}

export type ReplayImportErrorCode = 'not-json' | 'bad-shape' | 'no-matches'

export class ReplayImportError extends Error {
  code: ReplayImportErrorCode

  constructor(code: ReplayImportErrorCode, message: string) {
    super(message)
    this.name = 'ReplayImportError'
    this.code = code
  }
}
