/**
 * 卡牌筛选跨窗口实时同步桥。
 *
 * 筛选面板（FilterPanel）可独立弹出为新窗口，主窗口卡牌列表与筛选窗口需
 * 双向实时同步筛选状态（activeFilters / 数值范围 / 搜索词 / 排序）。
 *
 * 设计：
 * - `filterSyncStore`：单一事实源（writable），主窗口与筛选窗口各自持有一份，
 *   但所有读写都通过本模块，保证两窗口最终一致。
 * - 广播用 Tauri 全局事件 emit/listen；非 Tauri 环境退化为 BroadcastChannel。
 * - 每条消息带「发送方窗口 label」，接收方忽略自己发出的消息；
 *   另用模块级 `applyingRemote` 抑制标志，避免「收到远端→写回本地→再广播」的回环。
 */
import { writable, get } from 'svelte/store'
import { isTauri } from '$lib/db/env'
import type { ActiveFilter, NumberRange, SortKeyItem } from '$lib/db/types'

const EVENT = 'rune-filter-state'
const CHANNEL = 'rune-filter-state-broadcast'

export interface FilterSyncState {
  activeFilters: ActiveFilter[]
  energy: NumberRange
  power: NumberRange
  return_energy: NumberRange
  currentSearchText: string
  sortList: SortKeyItem[]
  /** 命中卡牌总数（主窗口搜索结果，供筛选窗口展示） */
  totalCards: number
}

const DEFAULT_STATE: FilterSyncState = {
  activeFilters: [],
  energy: { min: 0, max: 12 },
  power: { min: 0, max: 12 },
  return_energy: { min: 0, max: 4 },
  currentSearchText: '',
  sortList: [{ id: 1, name: 'card_no', isAsc: true, order: 1 }],
  totalCards: 0,
}

/** 单一事实源（writable store） */
export const filterSyncStore = writable<FilterSyncState>({ ...DEFAULT_STATE })

/** 本窗口 label；用于识别并忽略自己广播的消息 */
let selfLabel: string | null = null

/** 是否正处于「应用远端状态」流程中（抑制回环广播） */
let applyingRemote = false

async function getSelfLabel(): Promise<string> {
  if (selfLabel) return selfLabel
  if (!isTauri) {
    selfLabel = 'web'
    return selfLabel
  }
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    selfLabel = getCurrentWebviewWindow().label
  } catch {
    selfLabel = 'web'
  }
  return selfLabel
}

interface WireMsg {
  source: string
  state: FilterSyncState
}

function serialize(msg: WireMsg): string {
  return JSON.stringify(msg)
}

function parse(payload: string): WireMsg {
  return JSON.parse(payload) as WireMsg
}

/** 是否正处于应用远端状态流程中（用于 UI 层跳过本地再广播） */
export function isApplyingRemote(): boolean {
  return applyingRemote
}

/**
 * 广播筛选状态到其它窗口（Tauri 事件；失败或非 Tauri 用 BroadcastChannel）。
 */
async function broadcastState(state: FilterSyncState): Promise<void> {
  const source = await getSelfLabel()
  const msg: WireMsg = { source, state }
  if (isTauri) {
    try {
      const { emit } = await import('@tauri-apps/api/event')
      await emit(EVENT, msg)
      return
    } catch {
      // 事件失败则退化为 BroadcastChannel
    }
  }
  const bc = new BroadcastChannel(CHANNEL)
  bc.postMessage(serialize(msg))
  bc.close()
}

export type FilterSyncHandler = (state: FilterSyncState, source: string) => void

/**
 * 订阅其它窗口广播的筛选状态。自动忽略本窗口自己发出的消息。
 * @returns 取消订阅函数
 */
async function subscribeState(handler: FilterSyncHandler): Promise<() => void> {
  const self = await getSelfLabel()
  let unlisten: (() => void) | null = null

  if (isTauri) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const un = await listen<WireMsg>(EVENT, (e) => {
        if (e.payload?.source === self) return
        handler(e.payload.state, e.payload.source)
      })
      unlisten = un
      return () => unlisten?.()
    } catch {
      // 监听失败则退化为 BroadcastChannel
    }
  }

  const bc = new BroadcastChannel(CHANNEL)
  bc.onmessage = (e) => {
    const msg = parse(String(e.data))
    if (msg.source === self) return
    handler(msg.state, msg.source)
  }
  return () => bc.close()
}

/**
 * 初始化跨窗口同步监听。仅需调用一次（内部幂等）。
 * 之后每次 store 变化（无论来自本地 UI 还是远端）都会写回 store。
 * @returns 取消订阅函数（组件卸载时调用）
 */
export async function initFilterSync(): Promise<() => void> {
  return subscribeState((state) => {
    applyingRemote = true
    try {
      filterSyncStore.set(state)
    } finally {
      applyingRemote = false
    }
  })
}

/**
 * 由 UI 层调用：用本地最新状态更新 store 并广播给其它窗口。
 * 若正处于应用远端流程，则只写 store 不广播（避免回环）。
 */
export async function setFilterSyncState(state: FilterSyncState): Promise<void> {
  filterSyncStore.set(state)
  if (applyingRemote) return
  await broadcastState(state)
}

/** 便捷：读取当前 store 快照 */
export function currentFilterSyncState(): FilterSyncState {
  return get(filterSyncStore)
}

const CLOSE_EVENT = 'rune-filter-close'

/**
 * 通知已打开的筛选独立窗口关闭（主窗口离开单卡库页时调用）。
 */
export async function notifyFilterClose(): Promise<void> {
  if (!isTauri) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(CLOSE_EVENT, {})
  } catch {
    // 忽略
  }
}

/**
 * 筛选独立窗口订阅「关闭」通知（主窗口离开 /cards 时触发），收到后自行关闭。
 * @returns 取消订阅函数
 */
export async function subscribeFilterClose(onClose: () => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const un = await listen(CLOSE_EVENT, () => onClose())
  return un
}
