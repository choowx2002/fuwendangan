/**
 * 卡组加载服务：将已保存的卡组（最新版本）转换为 Builder 需要的分区状态
 */

import { getCardByPrintId, getDeckById, getLatestDeckCards, getPrintsByCardId } from '$lib/db'
import type { Deck } from '$lib/db'
import type { ZoneKey } from './zone'
import type { cardAndPrint } from './types'

export interface LoadedDeckForEdit {
  deck: Deck
  legendCards: cardAndPrint[]
  championCards: cardAndPrint[]
  mainDeckCards: cardAndPrint[]
  battlefieldCards: cardAndPrint[]
  runeCards: cardAndPrint[]
  sideboardCards: cardAndPrint[]
}

const ZONE_ARRAY_MAP: Record<ZoneKey, keyof Omit<LoadedDeckForEdit, 'deck'>> = {
  legend: 'legendCards',
  champion: 'championCards',
  mainDeck: 'mainDeckCards',
  battlefields: 'battlefieldCards',
  runes: 'runeCards',
  sideboard: 'sideboardCards',
}

/**
 * 加载卡组及其最新版本卡牌，返回 Builder 可直接绑定的分区状态
 * 返回 null 表示卡组不存在
 */
export async function loadDeckForEdit(deckId: string): Promise<LoadedDeckForEdit | null> {
  const deck = await getDeckById(deckId)
  if (!deck) return null

  const rows = await getLatestDeckCards(deckId)

  const result: LoadedDeckForEdit = {
    deck,
    legendCards: [],
    championCards: [],
    mainDeckCards: [],
    battlefieldCards: [],
    runeCards: [],
    sideboardCards: [],
  }

  const cardCache = new Map<string, cardAndPrint | null>()

  for (const row of rows) {
    const printId = row.card_id
    if (!printId) continue

    let card = cardCache.get(printId)
    if (card === undefined) {
      const base = await getCardByPrintId(printId)
      if (!base) {
        cardCache.set(printId, null)
        continue
      }
      const prints = await getPrintsByCardId(base.id)
      card = { ...base, card_prints: prints, selectedPrints: printId }
      cardCache.set(printId, card)
    }

    if (!card) continue

    const zoneKey = ZONE_ARRAY_MAP[row.zone as ZoneKey]
    if (!zoneKey) continue

    for (let i = 0; i < row.quantity; i++) {
      result[zoneKey].push(card)
    }
  }

  return result
}
