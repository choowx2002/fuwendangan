import { writable } from 'svelte/store'

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
