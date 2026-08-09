// src/lib/stores/network.svelte.ts
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isTauri } from '../db/env'
import { showToast } from './ui-store.svelte'
import { get } from 'svelte/store'
import { t } from '$lib/i18n'

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
const PROBE_TIMEOUT_MS = 4000
const PROBE_URL = import.meta.env.VITE_SUPABASE_URL

let lastProbeAt = 0
let lastProbeOnline: boolean | null = null
let initiated = false

/**
 * HTTP 可达性探测：
 * 向 Supabase 发起带超时的轻量请求，收到任意响应（含 4xx/5xx）即认为可联网。
 * 跨端统一（桌面 / Android / iOS / Web），比枚举网卡更能反映真实连通性。
 */
async function probeHttp(): Promise<boolean> {
  if (!PROBE_URL) {
    return typeof navigator !== 'undefined' && navigator.onLine !== false
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const fetchImpl = isTauri ? tauriFetch : globalThis.fetch
    await fetchImpl(PROBE_URL, { method: 'GET', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 原生网络探测：
 * - 优先用真实 HTTP 探测（tauri-plugin-http / 浏览器 fetch）
 * - navigator.onLine 为 false 时直接短路，避免无谓请求
 */
async function probeOnline(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return probeHttp()
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
      showToast(get(t)('common.networkRestored'), 'success')
    } else {
      showToast(get(t)('common.networkOfflineLocal'), 'info')
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
