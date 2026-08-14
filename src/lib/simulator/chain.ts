import { Snowflake } from '@theinternetfolks/snowflake'
import { persistentWritable } from '$lib/stores/tools'

/**
 * 结算链模拟器核心状态模块。
 * 纯本地演示工具：不参与内容/玩家数据同步，状态持久化到 tools.json（plugin-store）。
 */

export const CHAIN_SIM_VERSION = 1
export const CHAIN_SIM_EXPORT_TYPE = 'chain-sim'
/** 侧栏自定义条目池的区域 key */
export const POOL_KEY = 'pool'

export const MAX_HISTORY = 50

export type PlayerZoneId = 'hand' | 'base' | 'discard' | 'exile' | 'deck'
export type DisplayMode = 'text' | 'image' | 'both'
/** 显示偏好：'auto' = 按区域类型使用 DEFAULT_ZONE_MODES */
export type DisplayPreference = DisplayMode | 'auto'

export interface ChainItem {
  id: string
  /** 引用本地卡牌（cards_base.card_no），为空则纯自定义条目 */
  cardNo?: string | null
  /** 自定义条目名称（效果/技能条目） */
  customName?: string | null
  /** 自定义条目备注 */
  customNote?: string | null
  /** 玩家归属 0..3，null = 未标记 */
  owner?: number | null
  /** 自定义条目「结算后去向」区域 key */
  targetZone?: string | null
}

export interface CustomZone {
  id: string
  name: string
  /** true = 每玩家一组，false = 共享 */
  perPlayer: boolean
  items: ChainItem[]
}

export interface PlayerZone {
  hand: ChainItem[]
  base: ChainItem[]
  discard: ChainItem[]
  exile: ChainItem[]
}

export interface SimState {
  playerCount: number
  battlefieldCount: number
  shared: {
    chain: ChainItem[]
    resolving: ChainItem[]
    pending: ChainItem[]
  }
  players: PlayerZone[]
  battlefields: ChainItem[][]
  customZones: CustomZone[]
  customPool: ChainItem[]
  /** 可选牌库（默认 null 关闭） */
  extra: { deck: ChainItem[] } | null
  /** 显示偏好：'auto' 按区域类型默认，或全局统一（text/image/both） */
  displayMode: DisplayPreference
}

/** 'auto' 时各区域类型的默认显示方式：结算链/战场/基地看卡图，其余看文本（结算中图文兼顾） */
const DEFAULT_ZONE_MODES: Record<string, DisplayMode> = {
  chain: 'image',
  resolving: 'both',
  pending: 'text',
  battlefield: 'image',
  hand: 'text',
  base: 'image',
  discard: 'text',
  exile: 'text',
  deck: 'text',
}

/** 解析区域显示方式：pref 非 'auto' 全局统一，否则按区域类型默认 */
export function resolveZoneMode(pref: DisplayPreference, key: string): DisplayMode {
  if (pref !== 'auto') return pref
  if (key.startsWith('bf')) return DEFAULT_ZONE_MODES.battlefield
  const pMatch = /^p(\d+)-(hand|base|discard|exile|deck)$/.exec(key)
  if (pMatch) return DEFAULT_ZONE_MODES[pMatch[2]] ?? 'text'
  return DEFAULT_ZONE_MODES[key] ?? 'text'
}

export function newChainItem(partial?: Partial<ChainItem>): ChainItem {
  return {
    id: Snowflake.generate().toString(),
    cardNo: null,
    customName: null,
    customNote: null,
    owner: null,
    targetZone: null,
    ...partial,
  }
}

// ---------------- 看板拖拽载荷 ----------------

/**
 * 看板式拖拽载荷：卡片 + 来源列 id。
 * 侧栏卡池 / 搜索结果直接拖入时载荷为裸 ChainItem，跨组件解析时用 unwrapDragItem 归一。
 */
export type ChainDragPayload = { card: ChainItem; columnId: string } | ChainItem

export function isCardPayload(p: unknown): p is { card: ChainItem; columnId: string } {
  return typeof p === 'object' && p !== null && 'card' in p && 'columnId' in p
}

export function unwrapDragItem(p: ChainDragPayload): ChainItem {
  return isCardPayload(p) ? p.card : p
}

export function createSimState(playerCount = 2, battlefieldCount = 2): SimState {
  const players: PlayerZone[] = []
  for (let i = 0; i < playerCount; i++) {
    players.push({ hand: [], base: [], discard: [], exile: [] })
  }
  const battlefields: ChainItem[][] = []
  for (let i = 0; i < battlefieldCount; i++) battlefields.push([])
  return {
    playerCount,
    battlefieldCount,
    shared: { chain: [], resolving: [], pending: [] },
    players,
    battlefields,
    customZones: [],
    customPool: [],
    extra: null,
    displayMode: 'auto',
  }
}

// ---------------- 区域 key 寻址 ----------------

export function playerZoneKey(player: number, zone: PlayerZoneId): string {
  return `p${player}-${zone}`
}

export function battlefieldKey(index: number): string {
  return `bf${index}`
}

/** 每玩家自定义区域地址：`{customId}#{player}`；共享自定义区域直接 `{customId}` */
export function customZoneKey(customId: string, player?: number): string {
  return player === undefined ? customId : `${customId}#${player}`
}

function splitCustomKey(key: string): { id: string; player: number | undefined } {
  const hashIndex = key.lastIndexOf('#')
  if (hashIndex > 0) {
    const player = Number(key.slice(hashIndex + 1))
    if (Number.isInteger(player) && player >= 0) {
      return { id: key.slice(0, hashIndex), player }
    }
  }
  return { id: key, player: undefined }
}

/** 解析区域 key 是否为自定义区域地址（含 #player 后缀） */
export function customZoneMeta(key: string): { id: string; player: number | undefined } {
  return splitCustomKey(key)
}

/** 全部有效区域 key（含自定义区域），按展示顺序 */
export function allZoneKeys(s: SimState): string[] {
  const keys: string[] = ['chain', 'resolving', 'pending']
  for (let i = 0; i < s.battlefieldCount; i++) keys.push(battlefieldKey(i))
  for (const z of s.customZones) {
    if (z.perPlayer) {
      for (let p = 0; p < s.playerCount; p++) keys.push(customZoneKey(z.id, p))
    } else {
      keys.push(customZoneKey(z.id))
    }
  }
  for (let p = 0; p < s.playerCount; p++) {
    keys.push(playerZoneKey(p, 'hand'), playerZoneKey(p, 'base'), playerZoneKey(p, 'discard'))
    keys.push(playerZoneKey(p, 'exile'))
    if (s.extra) keys.push(playerZoneKey(p, 'deck'))
  }
  return keys
}

/** 读取某区域 items（每玩家自定义区域按 owner 过滤） */
export function getZoneItems(s: SimState, key: string): ChainItem[] | null {
  if (key === POOL_KEY) return s.customPool
  if (key === 'chain') return s.shared.chain
  if (key === 'resolving') return s.shared.resolving
  if (key === 'pending') return s.shared.pending
  if (key.startsWith('bf')) {
    const i = Number(key.slice(2))
    return s.battlefields[i] ?? null
  }
  const pMatch = /^p(\d+)-(hand|base|discard|exile|deck)$/.exec(key)
  if (pMatch) {
    const p = Number(pMatch[1])
    const zoneName = pMatch[2] as PlayerZoneId
    if (zoneName === 'deck') {
      if (!s.extra) return null
      return s.extra.deck.filter((i) => (i.owner ?? 0) === p)
    }
    const zone = s.players[p]?.[zoneName]
    return zone ?? null
  }
  const { id, player } = splitCustomKey(key)
  const zone = s.customZones.find((z) => z.id === id)
  if (!zone) return null
  if (zone.perPlayer) {
    return player === undefined ? zone.items : zone.items.filter((i) => i.owner === player)
  }
  return zone.items
}

/** 写入某区域 items（每玩家自定义区域：保留其他玩家项，写入项强制 owner 归该玩家） */
export function setZoneItems(s: SimState, key: string, items: ChainItem[]): void {
  if (key === POOL_KEY) {
    s.customPool = items
    return
  }
  if (key === 'chain') {
    s.shared.chain = items
    return
  }
  if (key === 'resolving') {
    s.shared.resolving = items
    return
  }
  if (key === 'pending') {
    s.shared.pending = items
    return
  }
  if (key.startsWith('bf')) {
    const i = Number(key.slice(2))
    if (s.battlefields[i]) s.battlefields[i] = items
    return
  }
  const pMatch = /^p(\d+)-(hand|base|discard|exile|deck)$/.exec(key)
  if (pMatch) {
    const p = Number(pMatch[1])
    const zoneName = pMatch[2] as PlayerZoneId
    const zone = s.players[p]
    if (!zone) return
    if (zoneName === 'deck') {
      if (!s.extra) return
      const others = s.extra.deck.filter((i) => (i.owner ?? 0) !== p)
      s.extra.deck = [...others, ...items.map((i) => ({ ...i, owner: p }))]
      return
    }
    zone[zoneName] = items
    return
  }
  const { id, player } = splitCustomKey(key)
  const zone = s.customZones.find((z) => z.id === id)
  if (!zone) return
  if (zone.perPlayer) {
    const p = player ?? 0
    const others = zone.items.filter((i) => i.owner !== p)
    zone.items = [...others, ...items.map((i) => ({ ...i, owner: p }))]
  } else {
    zone.items = items
  }
}

/** 区域标题（i18n key） */
export function zoneTitleKey(key: string): string {
  if (key === 'chain') return 'simulator.zone.chain'
  if (key === 'resolving') return 'simulator.zone.resolving'
  if (key === 'pending') return 'simulator.zone.pending'
  if (key.startsWith('bf')) return 'simulator.zone.battlefield'
  const pMatch = /^p(\d+)-(hand|base|discard|exile|deck)$/.exec(key)
  if (pMatch) return `simulator.zone.${pMatch[2]}`
  return '' // 自定义区域用 zone.name
}

// ---------------- 克隆 / 校验 / 归一化 ----------------

/** 按 id 去重（防止拖拽残留阴影副本 / 旧存档重复项导致 keyed each 崩溃） */
export function dedupeItems<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const i of items) {
    if (seen.has(i.id)) continue
    seen.add(i.id)
    out.push(i)
  }
  return out
}

export function cloneSimState(s: SimState): SimState {
  return JSON.parse(JSON.stringify(s)) as SimState
}

function isChainItem(v: unknown): v is ChainItem {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    (o.cardNo === undefined || o.cardNo === null || typeof o.cardNo === 'string') &&
    (o.customName === undefined || o.customName === null || typeof o.customName === 'string') &&
    (o.customNote === undefined || o.customNote === null || typeof o.customNote === 'string') &&
    (o.owner === undefined || o.owner === null || typeof o.owner === 'number') &&
    (o.targetZone === undefined || o.targetZone === null || typeof o.targetZone === 'string')
  )
}

function isDisplayMode(v: unknown): v is DisplayMode {
  return v === 'text' || v === 'image' || v === 'both'
}

function isPlayerZone(v: unknown): v is PlayerZone {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return ['hand', 'base', 'discard', 'exile'].every(
    (k) => Array.isArray(o[k]) && o[k].every(isChainItem)
  )
}

function isCustomZone(v: unknown): v is CustomZone {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.perPlayer === 'boolean' &&
    Array.isArray(o.items) &&
    o.items.every(isChainItem)
  )
}

function clampPlayerCount(n: unknown): number {
  return typeof n === 'number' && n >= 2 && n <= 4 ? n : 2
}

function clampBattlefieldCount(n: unknown): number {
  return typeof n === 'number' && n >= 1 && n <= 3 ? n : 2
}

/**
 * 归一化：按 playerCount / battlefieldCount 重建区域结构。
 * - 校验失败返回 null（拒绝导入 / 持久化旧数据丢弃重建）
 * - 校验通过但结构残缺时尽力修复（多余 key 丢弃、缺省补空）
 */
export function normalizeSimState(v: unknown): SimState | null {
  if (typeof v !== 'object' || v === null) return null
  const raw = v as Record<string, unknown>

  const playerCount = clampPlayerCount(raw.playerCount)
  const battlefieldCount = clampBattlefieldCount(raw.battlefieldCount)

  const shared = raw.shared as Record<string, unknown> | undefined
  const sharedOk =
    !!shared &&
    ['chain', 'resolving', 'pending'].every(
      (k) => Array.isArray(shared[k]) && shared[k].every(isChainItem)
    )

  const rawPlayers = Array.isArray(raw.players) ? (raw.players as unknown[]) : []
  const rawBattlefields = Array.isArray(raw.battlefields) ? (raw.battlefields as unknown[]) : []
  const rawZones = Array.isArray(raw.customZones) ? (raw.customZones as unknown[]) : []
  const rawPool = Array.isArray(raw.customPool) ? (raw.customPool as unknown[]) : []

  const players: PlayerZone[] = []
  for (let p = 0; p < playerCount; p++) {
    const src = rawPlayers[p]
    players.push(
      isPlayerZone(src)
        ? {
            hand: dedupeItems(src.hand),
            base: dedupeItems(src.base),
            discard: dedupeItems(src.discard),
            exile: dedupeItems(src.exile),
          }
        : { hand: [], base: [], discard: [], exile: [] }
    )
  }

  const battlefields: ChainItem[][] = []
  for (let b = 0; b < battlefieldCount; b++) {
    const src = rawBattlefields[b]
    battlefields.push(
      Array.isArray(src) && src.every(isChainItem) ? dedupeItems(src as ChainItem[]) : []
    )
  }

  const customZones: CustomZone[] = rawZones
    .filter(isCustomZone)
    .map((z) => ({ ...z, items: dedupeItems(z.items) }))

  const customPool = dedupeItems(rawPool.filter(isChainItem))

  let extra: { deck: ChainItem[] } | null = null
  const rawExtra = raw.extra as { deck?: unknown } | null | undefined
  if (rawExtra && Array.isArray(rawExtra.deck) && rawExtra.deck.every(isChainItem)) {
    extra = { deck: dedupeItems(rawExtra.deck as ChainItem[]) }
  }

  const state: SimState = {
    playerCount,
    battlefieldCount,
    shared: sharedOk
      ? {
          chain: dedupeItems((shared.chain as unknown[]) as ChainItem[]),
          resolving: dedupeItems((shared.resolving as unknown[]) as ChainItem[]),
          pending: dedupeItems((shared.pending as unknown[]) as ChainItem[]),
        }
      : { chain: [], resolving: [], pending: [] },
    players,
    battlefields,
    customZones,
    customPool,
    extra,
    displayMode: isDisplayMode(raw.displayMode) ? raw.displayMode : 'auto',
  }

  // targetZone：兼容旧存档保留字段校验（UI 已不再提供设置，落位改由玩家拖拽决定）
  const validKeys = new Set(allZoneKeys(state))
  for (const zone of customZones) {
    for (const item of zone.items) {
      if (item.targetZone && !validKeys.has(item.targetZone)) item.targetZone = null
    }
  }
  for (const item of customPool) {
    if (item.targetZone && !validKeys.has(item.targetZone)) item.targetZone = null
  }
  for (const p of players) {
    for (const zone of [p.hand, p.base, p.discard, p.exile]) {
      for (const item of zone) {
        if (item.targetZone && !validKeys.has(item.targetZone)) item.targetZone = null
      }
    }
  }
  for (const bf of battlefields) {
    for (const item of bf) {
      if (item.targetZone && !validKeys.has(item.targetZone)) item.targetZone = null
    }
  }

  return state
}

// ---------------- 快照历史 ----------------

export interface ChainHistory {
  past: SimState[]
  present: SimState
  future: SimState[]
}

export function createChainHistory(state: SimState): ChainHistory {
  return { past: [], present: cloneSimState(state), future: [] }
}

/** 手动记录快照点：把当前状态压入 past（上限 MAX_HISTORY），清空 future */
export function snapshotForChange(history: ChainHistory): void {
  history.past.push(cloneSimState(history.present))
  if (history.past.length > MAX_HISTORY) history.past.shift()
  history.future = []
}

export function undoHistory(history: ChainHistory): boolean {
  const prev = history.past.pop()
  if (!prev) return false
  history.future.push(cloneSimState(history.present))
  history.present = prev
  return true
}

export function redoHistory(history: ChainHistory): boolean {
  const next = history.future.pop()
  if (!next) return false
  history.past.push(cloneSimState(history.present))
  history.present = next
  return true
}

// ---------------- 导入导出 ----------------

export function serializeSimState(s: SimState): string {
  const payload = {
    type: CHAIN_SIM_EXPORT_TYPE,
    version: CHAIN_SIM_VERSION,
    savedAt: new Date().toISOString(),
    ...cloneSimState(s),
  }
  return JSON.stringify(payload, null, 2)
}

/** 解析导入文本：版本/类型校验 + 归一化，失败返回 null */
export function parseSimImport(text: string): SimState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (o.type !== CHAIN_SIM_EXPORT_TYPE || o.version !== CHAIN_SIM_VERSION) return null
  return normalizeSimState(o)
}

// ---------------- 持久化 store ----------------

export const chainSimulatorState = persistentWritable<SimState>(
  'chainSimulator',
  createSimState(2, 2)
)
