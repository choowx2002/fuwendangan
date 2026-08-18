/**
 * Rift Atlas 对局导入：类型定义（M0 纯函数层）
 *
 * 数据来源：Rift Atlas 扩展导出的 JSON（meta.version 0.2.x 实测）。
 * 关键认知：一个 roomCode = 一局游戏；同一房间内多条记录 = 断线重连的多个 session。
 *
 * Schema v2：视角解耦（players + perspective），战场选择保留过程数据（候选池/随机/时间戳），
 * 静态资源（卡图元数据）与对局业务数据分离。
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

// ==================== 规范化模型（Schema v2） ====================

/** 单张卡牌条目（卡组分区 / 传奇等） */
export interface CardEntry {
  count: number
  name: string
  cardCode: string
}

/** 卡组分区（分区名与原始 payload 对齐：battlefields/runes 复数） */
export interface Decklist {
  legend: CardEntry[]
  champion: CardEntry[]
  mainDeck: CardEntry[]
  battlefields: CardEntry[]
  runes: CardEntry[]
  sideboard: CardEntry[]
}

/**
 * 战场选择过程数据（结构化为主，推断为辅，缺失兜底）：
 * - options：系统分配的候选战场池（结构化字段探测，缺失为空数组）
 * - finalPick：最终锁定的战场卡号（无信号为 null）
 * - isRandom：结构化随机标记；无标记但 finalPick 不在候选池时推断为 true；再无可为 null
 * - pickTimestamp：锁定事件时间戳（可用于分析选择耗时）
 */
export interface BattlefieldSelection {
  options: string[]
  finalPick: string | null
  isRandom: boolean | null
  pickTimestamp: number | null
}

/** 玩家实体（与视角无关，支持 1v1 与未来多人/观战） */
export interface ReplayPlayer {
  id: string
  name: string | null
  legend: CardEntry | null
  deck: Decklist | null
  decklistRaw: string | null
  battlefield: BattlefieldSelection
}

/** 对局元数据 */
export interface MatchMeta {
  roomCode: string | null
  /** 队列赛制（payload matchFormat 或 URL bo{n}；实测恒为 bo1，仅展示用） */
  format: string | null
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  firstPlayerId: string | null
}

/** 对局结果（winnerId 保持 null，胜负由用户手动标记 ReplayResultMark，不做自动推断） */
export interface MatchResult {
  winnerId: string | null
  /** playerId → 最终比分（无数据时缺省） */
  score: Record<string, number>
}

/** 遥测与网络状态（sessions 为回放引擎的原始事件源，必须强类型保留） */
export interface MatchTelemetry {
  totalEvents: number
  snapshotCount: number
  reconnectCount: number
  parseFailures: number
  hasReplayableData: boolean
  sessions: ReplaySession[]
  matchmakingSession: ReplaySession | null
}

/** 一个房间 = 一局游戏（可能包含多个重连 session）；顶层对局记录（Schema v2） */
export interface RiftAtlasMatchRecord {
  key: string
  meta: MatchMeta
  /** 视角：标识这份日志是哪个客户端导出的（渲染时决定我方/对方） */
  perspective: {
    localPlayerId: string | null
  }
  /** 玩家数据池（1v1；未来可扩展 2v2/观战） */
  players: Record<string, ReplayPlayer>
  result: MatchResult
  telemetry: MatchTelemetry
  // 注意：卡图元数据不持久化到记录里——渲染期直接查本地数据库
  // （传奇按 cardCode、战场按英文名，与全应用其他页面行为一致）
}

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

export interface ImportBundle {
  fileName: string | null
  meta: RiftExportMeta
  rawMatchCount: number
  groups: RiftAtlasMatchRecord[]
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
