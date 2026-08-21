/**
 * Rift Atlas 对局导入：类型定义（M0 纯函数层）
 *
 * 数据来源：Rift Atlas 扩展导出的 JSON（meta.version 0.2.x 实测）。
 * 关键认知：一个 roomCode = 一局游戏；同一房间内多条记录 = 断线重连的多个 session。
 *
 * Schema v3：系列（Series）化——同一 BO3 的多个 room 通过服务器权威字段
 * seriesId/gameNumber/previousRoomCode/nextRoomCode 合并成一条记录（games[]），
 * 不再依赖 Battlefield/sequence 推断局数；胜负（winsByPlayerId/pendingGameResult）
 * 与先手选择者（starterChooserPlayerId）取服务器权威值，缺失时玩家可手动指定。
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

/** 对局元数据（series 级汇总；单局详情见 RiftAtlasGame） */
export interface MatchMeta {
  /** 系列标识（服务器权威，如 series_xxx）；无则单局独立 */
  seriesId: string | null
  /** 系列首局房间号（v2 迁移兼容；v3 新导入仅 games 内有效） */
  roomCode: string | null
  /** 赛制（sessionDoc.matchFormat 权威，如 bo3；兜底 matchmaking payload 或 URL bo{n}，仅展示用） */
  format: string | null
  /** 模拟器来源网站 host（由 match 记录级 url 探测，如 realtime.riftatlas-workers.com） */
  source: string | null
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  firstPlayerId: string | null
}

/** 对局结果（winnerId 为服务器权威系列胜者；仍允许用户手动覆盖 ReplayResultMark） */
export interface MatchResult {
  winnerId: string | null
  /** playerId → 最终比分（系列：winsByPlayerId 累计；无数据时缺省） */
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

/** 一局游戏（原 v2 单局记录的大部分内容下沉至此） */
export interface RiftAtlasGame {
  gameNumber: number
  roomCode: string | null
  gameInstanceId: string | null
  previousRoomCode: string | null
  nextRoomCode: string | null
  /** 服务器权威本局胜者（pendingGameResult / winsByPlayerId 差分推断）；无则 null */
  winnerId: string | null
  /** 先手选择者（服务器权威字段；null = 未知，播放页可手动指定并持久化） */
  starterChooserPlayerId: string | null
  /** 本局实际先手玩家（choose_first_player.patch.set_room_fields.firstPlayerId / 快照 room 兜底） */
  firstPlayerId: string | null
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  /** 本局最终比分（final board.score） */
  score: Record<string, number>
  /** 每玩家本局战场选择过程数据 */
  battlefieldSelections: Record<string, BattlefieldSelection>
  telemetry: MatchTelemetry
}

/**
 * 顶层对局记录（Schema v3）：一个系列（BO3）= 一条记录。
 * key = seriesId（服务器权威；无 seriesId 的单局以 roomCode 为 key）。
 * 视角解耦：players + perspective（渲染时决定我方/对方）。
 * 注意：卡图元数据不持久化到记录里——渲染期直接查本地数据库
 * （传奇按 cardCode、战场按英文名，与全应用其他页面行为一致）。
 */
export interface RiftAtlasMatchRecord {
  key: string
  meta: MatchMeta
  /** 视角：标识这份日志是哪个客户端导出的（渲染时决定我方/对方） */
  perspective: {
    localPlayerId: string | null
    /** 观战视角导出：无本地玩家，localPlayerId 恒 null */
    isSpectator?: boolean
  }
  /** 玩家数据池（series 级跨局稳定信息；1v1，未来可扩展 2v2/观战） */
  players: Record<string, ReplayPlayer>
  result: MatchResult
  /** 系列内各局（按 gameNumber 升序）；单局回放数据在 game.telemetry */
  games: RiftAtlasGame[]
  telemetry: MatchTelemetry
}

/**
 * 对局资料注解（复盘文件顶层 annotations[key]，纯本地、随 json 文件走）。
 * 未绑定卡组时，每小局结果/备注/视角写入此结构；绑定时以 match_records 为准。
 */
export interface ReplayGroupAnnotation {
  /** 用户选定的「我方」playerId（决定分数方向与胜负判定）；null = 未选定 */
  myPlayerId: string | null
  /** gameNumber → 结果；仅含用户标记过的小局 */
  results: Record<number, 'win' | 'loss' | 'draw'>
  /** 备注（null = 无） */
  note: string | null
  /** 最后更新毫秒时间戳 */
  updatedAt: number
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

export type ReplayImportErrorCode = 'not-json' | 'bad-shape' | 'no-matches' | 'no-replay-data'

export class ReplayImportError extends Error {
  code: ReplayImportErrorCode

  constructor(code: ReplayImportErrorCode, message: string) {
    super(message)
    this.name = 'ReplayImportError'
    this.code = code
  }
}
