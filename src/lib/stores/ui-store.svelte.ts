// src/lib/stores/ui-store.svelte.ts
import type { Component } from 'svelte'

export type LoadStatus = 'loading' | 'syncing' | 'success' | 'error' | 'hidden' | 'downloading'

export const uiState = $state({
  status: 'hidden' as LoadStatus,
  text: '' as string | undefined,
  subText: '' as string | undefined,
  progress: 0 as number | undefined,
})

export function setLoadStatus(status: LoadStatus, text?: string, subText?: string) {
  uiState.status = status
  uiState.text = text ?? undefined
  uiState.subText = subText ?? undefined
}

export const sidebarState = $state({
  isMinimized: false,
})

export function setProgressStatus(
  status: LoadStatus,
  text?: string,
  subText?: string,
  progress?: number
) {
  uiState.status = status
  uiState.text = text ?? undefined
  uiState.subText = subText ?? undefined
  uiState.progress = progress ?? undefined
}

export function hideLoading() {
  uiState.status = 'hidden'
}

// --- 卡图下载进度（全局悬浮进度条） ---
export type DownloadStatus = 'downloading' | 'success' | 'partial' | 'cancelled' | 'error'

export const downloadState = $state({
  active: false,
  status: 'downloading' as DownloadStatus,
  total: 0,
  completed: 0,
  failed: 0,
  bytesDownloaded: 0,
  speedBps: 0,
  etaSeconds: 0,
  startTime: 0,
  endTime: 0,
  expanded: true,
})

export function beginDownload(total: number) {
  downloadState.active = true
  downloadState.status = 'downloading'
  downloadState.total = total
  downloadState.completed = 0
  downloadState.failed = 0
  downloadState.bytesDownloaded = 0
  downloadState.speedBps = 0
  downloadState.etaSeconds = 0
  downloadState.startTime = Date.now()
  downloadState.endTime = 0
  downloadState.expanded = true
}

export function updateDownloadProgress(p: {
  completed: number
  failed: number
  bytesDownloaded: number
  speedBps: number
  etaSeconds: number
}) {
  downloadState.completed = p.completed
  downloadState.failed = p.failed
  downloadState.bytesDownloaded = p.bytesDownloaded
  downloadState.speedBps = p.speedBps
  downloadState.etaSeconds = p.etaSeconds
}

export function finishDownload(status: Exclude<DownloadStatus, 'downloading'>) {
  downloadState.status = status
  downloadState.endTime = Date.now()
}

export function dismissDownload() {
  downloadState.active = false
  downloadState.status = 'downloading'
  downloadState.expanded = true
}

// --- 全局 Toast 提示 ---
export const toastState = $state({
  show: false,
  msg: '',
  type: 'info' as 'success' | 'error' | 'info',
})

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  toastState.msg = msg
  toastState.type = type
  toastState.show = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastState.show = false
  }, 2200)
}

export function dismissToast() {
  toastState.show = false
  if (toastTimer) clearTimeout(toastTimer)
}

export type TopbarActionVariant = 'primary' | 'ghost' | 'danger' | 'text'

export type TopbarAction = {
  key: string
  label?: string
  icon?: Component
  variant?: TopbarActionVariant
  disabled?: boolean
  active?: boolean
  title?: string
  priority?: number
  onClick: () => void
}

export type TopbarBadge = {
  key: string
  text: string
}

export const topbarState = $state({
  title: '',
  description: '',
  badges: [] as TopbarBadge[],
  actions: [] as TopbarAction[],
  onBack: null as (() => void) | null,
})

export function setTopbar(config: {
  title?: string
  description?: string
  badges?: TopbarBadge[]
  actions?: TopbarAction[]
  onBack?: (() => void) | null
}) {
  topbarState.title = config.title ?? ''
  topbarState.description = config.description ?? ''
  topbarState.badges = config.badges ?? []
  topbarState.actions = config.actions ?? []
  topbarState.onBack = config.onBack ?? null
}
