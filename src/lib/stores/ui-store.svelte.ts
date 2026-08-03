// src/lib/stores/ui-store.svelte.ts

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
