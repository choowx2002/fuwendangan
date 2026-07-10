// src/lib/stores/ui-store.svelte.ts

import { writable } from 'svelte/store'

// 1. 定义状态类型
export type LoadStatus = 'loading' | 'syncing' | 'success' | 'error' | 'hidden' | 'downloading'

// 2. 使用模块级 $state 创建全局响应式对象
export const uiState = $state({
  status: 'loading' as LoadStatus,
  text: '' as string | undefined,
  subText: '' as string | undefined,
  progress: 0 as number | undefined,
})

// 3. 提供便捷的更新方法（可选，但推荐，保持逻辑清晰）
export function setLoadStatus(status: LoadStatus, text?: string, subText?: string) {
  uiState.status = status
  uiState.text = text ?? undefined
  uiState.subText = subText ?? undefined
}

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

export interface TTSState {
  checking: boolean

  connected: boolean
  sendPort: boolean
  receivePort: boolean

  listenerStarted: boolean

  lastMessage: unknown | null

  details: unknown | null
}

const defaultTTSState: TTSState = {
  checking: false,

  connected: false,
  sendPort: false,
  receivePort: false,

  listenerStarted: false,

  lastMessage: null,

  details: null,
}

export const ttsState = writable<TTSState>(defaultTTSState)

export interface TTSColorOption {
  name: string
  value: string
}

export const colorOptions: TTSColorOption[] = [
  {
    name: '无色',
    value: 'Black',
  },
  {
    name: '蓝色',
    value: 'Blue',
  },
  {
    name: '红色',
    value: 'Red',
  },
  {
    name: '紫色',
    value: 'Purple',
  },
  {
    name: '绿色',
    value: 'Green',
  },
]

export type colorValue = 'Black' | 'Blue' | 'Red' | 'Purple' | 'Green'

export const selectedTTSColor = writable<string>(colorOptions[0].value)
