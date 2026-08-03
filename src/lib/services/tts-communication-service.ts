import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import { deckToString } from '$lib/cards/utils/deckSerializer.js'
import { ttsState, selectedTTSColor, type TTSState } from '$lib/stores/tts'
import type { CardWithPrint } from '$lib/db'

/**
 * Check TTS TCP connection
 */
export async function detectTTSServer() {
  setTTSChecking(true)

  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('TTS connection timeout'))
      }, 10000)
    })

    const invokePromise = invoke<any>('check_tts_connections')

    const result = await Promise.race([invokePromise, timeoutPromise])

    const sendPort = result.send_port.includes('正常')

    const receivePort = result.receive_port.includes('正常')

    const state = {
      checking: false,

      connected: sendPort && receivePort,

      sendPort,
      receivePort,

      details: result,
    }

    updateTTSConnection(state)

    return state
  } catch (error) {
    const state = {
      checking: false,

      connected: false,

      sendPort: false,

      receivePort: false,

      details: error instanceof Error ? error.message : String(error),
    }

    updateTTSConnection(state)

    return state
  }
}

/**
 * Start TCP listener
 * Port: 39998
 */
export async function startTTSServer(onMessage?: (data: any) => void) {
  await invoke('start_tts_listener')

  updateTTSConnection({
    listenerStarted: true,
  })

  await listen('tts-message', (event) => {
    let data: any = event.payload

    try {
      data = JSON.parse(event.payload as string)
    } catch {
      // keep string
    }

    updateTTSMessage(data)

    onMessage?.(data)
  })
}

/**
 * Send normal spawn command
 * Port: 39999
 */
export async function sendToTTS(deck: string) {
  const list = deck.trim().split(/\s+/).filter(Boolean)

  const processed = list.map((card) => card.toString().replace('*', 'S') + '-1')

  const message = {
    messageID: 2,

    customMessage: {
      action: 'spawn',

      deck: processed.join(' '),
    },
  }

  return invoke('send_to_tts', {
    message: JSON.stringify(message),
  })
}

/**
 * Send testing deck
 */
export async function sendToTTSTesting(deck: CardWithPrint[]) {
  const deckString = deckToString(deck)

  const color = get(selectedTTSColor)

  const message = {
    messageID: 2,

    customMessage: {
      action: 'spawntest',

      deck: deckString,

      color,
    },
  }

  return invoke('send_to_tts', {
    message: JSON.stringify(message),
  })
}

// helper functions

export function setTTSChecking(value: boolean) {
  ttsState.update((state) => ({
    ...state,
    checking: value,
  }))
}

export function updateTTSConnection(data: Partial<TTSState>) {
  ttsState.update((state) => ({
    ...state,
    ...data,
  }))
}

export function updateTTSMessage(message: unknown) {
  ttsState.update((state) => ({
    ...state,
    lastMessage: message,
  }))
}

export function multiSpawn(cards: any[]) {
  if (!cards.length) return
  const list: CardWithPrint[] = []
  for (const c of cards) {
    c.card_prints.forEach((p: any) => {
      list.push({
        ...c,
        id: c.id,
        card_prints: p,
        quantity: 1,
      })
    })
  }

  sendToTTSTesting(list)
}
