import { writable } from 'svelte/store'
import { Store } from '@tauri-apps/plugin-store'

let storePromise: Promise<Store> | null = null

function getStore() {
  if (!storePromise) {
    storePromise = Store.load('tools.json')
  }
  return storePromise
}

const pendingReads: Promise<unknown>[] = []

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isActionEntry(v: unknown): v is ActionEntry {
  if (!isObject(v)) return false
  return (
    (v.side === 'me' || v.side === 'opp') &&
    (v.delta === 1 || v.delta === -1) &&
    typeof v.mePoints === 'number' &&
    typeof v.oppPoints === 'number' &&
    typeof v.time === 'string'
  )
}

function isGameRecord(v: unknown): v is GameRecord {
  if (!isObject(v)) return false
  const actions = (v as any).actions
  if (actions !== undefined && (!Array.isArray(actions) || !actions.every(isActionEntry))) {
    return false
  }
  return (
    typeof v.gameNumber === 'number' &&
    (v.winner === 'me' || v.winner === 'opp' || v.winner === 'draw') &&
    typeof v.myScore === 'number' &&
    typeof v.oppScore === 'number' &&
    (v.winType === 'normal' ||
      v.winType === 'special' ||
      v.winType === 'concede' ||
      v.winType === 'draw')
  )
}

export function persistentWritable<T>(key: string, defaultValue: T) {
  const s = writable(defaultValue)

  const ready = getStore().then(async (store) => {
    const value = await store.get<T>(key)
    if (value !== undefined) {
      s.set(value)
    }

    s.subscribe(async (v) => {
      await store.set(key, v)
      await store.save()
    })
  })
  pendingReads.push(ready)

  return s
}

/** 计分动作日志（每个 +1/-1 操作） */
export interface ActionEntry {
  time: string
  side: 'me' | 'opp'
  delta: number
  mePoints: number
  oppPoints: number
}

export interface GameRecord {
  gameNumber: number
  winner: 'me' | 'opp' | 'draw'
  myScore: number
  oppScore: number
  winType: 'normal' | 'special' | 'concede' | 'draw'
  time: string
  actions?: ActionEntry[]
  /** 先后手：true=我方先手，false=对方先手，null=未记 */
  isFirst?: boolean | null
  /** 认输/特殊胜利原因 */
  winReason?: string | null
  /** 本局复盘 */
  log?: string | null
}

export interface ScoreCounterState {
  mePoints: number
  oppPoints: number
  targetScore: number
  games: GameRecord[]
  meName: string
  oppName: string
  deckId: string
  opponentName: string
  opponentDeck: string
  oppLegendId: string | null
  oppLegendPrintId: string | null
  oppLegendName: string | null
  oppLegendImage: string | null
  bestOf: string
  currentActions: ActionEntry[]
  timerEndsAt: number | null
  timerRemaining: number | null
  timerTotalMs: number | null
  /** 卡组版本（空=最新） */
  deckVersionId: string
  groupName: string
  note: string
  /** 从对局记录弹窗带入的摘要（非空时显示"已带入"引导） */
  pendingDraftSummary: string | null
  /** 骰子 / 硬币历史（持久化，随对局重置清除） */
  diceHistory: number[]
  coinHistory: string[]
}

const DEFAULT_SCORE_STATE: ScoreCounterState = {
  mePoints: 0,
  oppPoints: 0,
  targetScore: 8,
  games: [],
  meName: '我方',
  oppName: '对方',
  deckId: '',
  opponentName: '',
  opponentDeck: '',
  oppLegendId: null,
  oppLegendPrintId: null,
  oppLegendName: null,
  oppLegendImage: null,
  bestOf: '3',
  currentActions: [],
  timerEndsAt: null,
  timerRemaining: null,
  timerTotalMs: null,
  deckVersionId: '',
  groupName: '',
  note: '',
  pendingDraftSummary: null,
  diceHistory: [],
  coinHistory: [],
}

/** 对战计分器默认倒计时时长（分钟） */
export const matchTimerMinutes = persistentWritable('matchTimerMinutes', 60)

function isValidState(v: unknown): v is ScoreCounterState {
  if (!isObject(v)) return false
  if (typeof v.mePoints !== 'number' && typeof (v as any).me !== 'number') return false
  if (!Array.isArray(v.games) || !v.games.every(isGameRecord)) return false
  return true
}

export const scoreCounterState = persistentWritable<ScoreCounterState>(
  'scoreCounter',
  DEFAULT_SCORE_STATE
)

getStore().then(async (store) => {
  const value = await store.get<ScoreCounterState>('scoreCounter')
  if (value !== undefined && !isValidState(value)) {
    await store.set('scoreCounter', DEFAULT_SCORE_STATE)
    await store.save()
    scoreCounterState.set(DEFAULT_SCORE_STATE)
  } else if (value !== undefined) {
    const normalized: ScoreCounterState = {
      ...DEFAULT_SCORE_STATE,
      ...value,
      currentActions: value.currentActions ?? [],
      opponentDeck: value.opponentDeck ?? '',
      oppLegendId: value.oppLegendId ?? null,
      oppLegendPrintId: value.oppLegendPrintId ?? null,
      oppLegendName: value.oppLegendName ?? null,
      oppLegendImage: value.oppLegendImage ?? null,
      timerEndsAt: value.timerEndsAt ?? null,
      timerRemaining: value.timerRemaining ?? null,
      timerTotalMs: value.timerTotalMs ?? null,
      deckVersionId: value.deckVersionId ?? '',
      groupName: value.groupName ?? '',
      note: value.note ?? '',
      pendingDraftSummary: value.pendingDraftSummary ?? null,
      diceHistory: Array.isArray(value.diceHistory) ? value.diceHistory : [],
      coinHistory: Array.isArray(value.coinHistory) ? value.coinHistory : [],
    }
    scoreCounterState.set(normalized)
  }
})

/**
 * 所有 tools.json 持久化项完成初始读取后的 resolve 标记。
 * 使用 setTimeout(0) 等待所有静态模块（含 chainSimulatorState 所在的 chain.ts）完成注册，
 * 再统一等待 pendingReads。
 */
export const toolsStoreReady = new Promise<void>((resolve) => {
  setTimeout(() => {
    Promise.all(pendingReads).then(() => resolve())
  }, 0)
})
