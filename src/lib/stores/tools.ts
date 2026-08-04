import { writable } from 'svelte/store'
import { Store } from '@tauri-apps/plugin-store'

let storePromise: Promise<Store> | null = null

function getStore() {
  if (!storePromise) {
    storePromise = Store.load('tools.json')
  }
  return storePromise
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isGameRecord(v: unknown): v is GameRecord {
  if (!isObject(v)) return false
  return (
    typeof v.gameNumber === 'number' &&
    (v.winner === 'me' || v.winner === 'opp') &&
    typeof v.myScore === 'number' &&
    typeof v.oppScore === 'number' &&
    (v.winType === 'normal' || v.winType === 'special' || v.winType === 'concede')
  )
}

export function persistentWritable<T>(key: string, defaultValue: T) {
  const s = writable(defaultValue)

  getStore().then(async (store) => {
    const value = await store.get<T>(key)
    if (value !== undefined) {
      s.set(value)
    }

    s.subscribe(async (v) => {
      await store.set(key, v)
      await store.save()
    })
  })

  return s
}

export interface GameRecord {
  gameNumber: number
  winner: 'me' | 'opp'
  myScore: number
  oppScore: number
  winType: 'normal' | 'special' | 'concede'
  time: string
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
  bestOf: string
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
  bestOf: '3',
}

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
  }
})
