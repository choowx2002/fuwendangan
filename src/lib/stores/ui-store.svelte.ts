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

export type TopbarActionVariant = 'primary' | 'ghost' | 'danger' | 'text'

export type TopbarAction = {
  key: string
  label?: string
  icon?: Component
  variant?: TopbarActionVariant
  disabled?: boolean
  active?: boolean
  title?: string
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
