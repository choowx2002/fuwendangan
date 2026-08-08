// src/lib/stores/network.svelte.ts
import { nonLocalhostNetworks } from 'tauri-plugin-network-api'
import { isTauri } from '../db/env'
import { showToast } from './ui-store.svelte'

export interface NetworkStatus {
  online: boolean
  metered: boolean
}

export const networkState = $state({
  online: true,
  checked: false,
  metered: false,
})

const PROBE_CACHE_MS = 10000

let lastProbeAt = 0
let lastProbeOnline: boolean | null = null
let initiated = false

/**
 * 原生网络探测：
 * - Tauri：通过 tauri-plugin-network 获取非回环 IPv4 网络，有即认为设备已连接网络
 * - Web：退回 navigator.onLine
 */
async function probeOnline(): Promise<boolean> {
  if (isTauri) {
    try {
      const networks = await nonLocalhostNetworks()
      return networks.length > 0
    } catch (error) {
      console.warn('[Network] 原生网络探测失败，退回 navigator.onLine:', error)
      return typeof navigator !== 'undefined' && navigator.onLine !== false
    }
  }
  return typeof navigator !== 'undefined' && navigator.onLine !== false
}

async function cachedProbe(): Promise<boolean> {
  const now = Date.now()
  if (lastProbeAt > 0 && now - lastProbeAt < PROBE_CACHE_MS && lastProbeOnline !== null) {
    return lastProbeOnline
  }
  const ok = await probeOnline()
  lastProbeAt = now
  lastProbeOnline = ok
  return ok
}

/**
 * 最佳努力判断是否按流量计费（移动数据 / saveData）。
 * 桌面端与无法判断的场景一律返回 false。
 */
export function isMetered(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (navigator as any).connection
  if (!conn) return false
  if (conn.saveData === true) return true
  const type: string | undefined = conn.type
  if (type === 'cellular') return true
  const effectiveType: string | undefined = conn.effectiveType
  if (effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g') return true
  return false
}

/**
 * 是否真正在线。navigator.onLine 为 false 时直接返回 false（不探测），
 * 否则用缓存探测确认（避免频繁调用原生层）。
 */
export async function whenOnline(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return cachedProbe()
}

function applyState(online: boolean) {
  const prev = networkState.online
  networkState.online = online
  networkState.metered = isMetered()
  networkState.checked = true
  if (online !== prev) {
    if (online) {
      showToast('网络已恢复', 'success')
    } else {
      showToast('网络已离线，当前使用本地数据', 'info')
    }
  }
}

/**
 * 自动同步前的网络校验：
 * - offline → { ok: false, reason: 'offline' }
 * - metered → { ok: false, reason: 'metered' }
 * - 正常    → { ok: true }
 */
export async function shouldAutoSync(): Promise<{ ok: boolean; reason?: 'offline' | 'metered' }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    applyState(false)
    return { ok: false, reason: 'offline' }
  }
  const online = await cachedProbe()
  applyState(online)
  if (!online) return { ok: false, reason: 'offline' }
  if (isMetered()) return { ok: false, reason: 'metered' }
  return { ok: true }
}

export async function getNetworkStatus(): Promise<NetworkStatus> {
  const online = await whenOnline()
  applyState(online)
  return { online, metered: isMetered() }
}

function init() {
  if (initiated || typeof window === 'undefined') return
  initiated = true

  window.addEventListener('online', () => {
    void getNetworkStatus()
  })
  window.addEventListener('offline', () => {
    applyState(false)
  })

  void shouldAutoSync()
}

init()
