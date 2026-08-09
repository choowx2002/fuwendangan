import { loadDeckForEdit } from '$lib/decks/deck-loader'
import type { LoadedDeckForEdit } from '$lib/decks/deck-loader'
import type { ZoneKey } from '$lib/decks/zone'
import type { CardWithPrint } from '$lib/db'
import { sendToTTSTesting } from './tts-communication-service'

const ZONE_ORDER: ZoneKey[] = [
  'legend',
  'champion',
  'mainDeck',
  'battlefields',
  'runes',
  'sideboard',
]

const ZONE_ARRAY_MAP: Record<ZoneKey, keyof Omit<LoadedDeckForEdit, 'deck'>> = {
  legend: 'legendCards',
  champion: 'championCards',
  mainDeck: 'mainDeckCards',
  battlefields: 'battlefieldCards',
  runes: 'runeCards',
  sideboard: 'sideboardCards',
}

export async function spawnDeckToTTS(deckId: string): Promise<number> {
  const loaded = await loadDeckForEdit(deckId)
  if (!loaded) throw new Error('卡组不存在')

  const list: CardWithPrint[] = []

  for (const zone of ZONE_ORDER) {
    const cards = loaded[ZONE_ARRAY_MAP[zone]]
    if (!Array.isArray(cards)) continue
    for (const card of cards) {
      const print =
        card.card_prints.find((p) => p.id === card.selectedPrints) ?? card.card_prints[0]
      if (!print) continue
      list.push({ ...card, card_prints: print, quantity: 1 })
    }
  }

  if (list.length === 0) throw new Error('卡组为空，没有可生成的卡牌')

  await sendToTTSTesting(list)
  return list.length
}
