import type { DeckCardInput } from '$lib/db'
import type { cardAndPrint } from './types'

export function flattenDeckCards(zones: {
  legendCards: cardAndPrint[]
  championCards: cardAndPrint[]
  mainDeckCards: cardAndPrint[]
  battlefieldCards: cardAndPrint[]
  runeCards: cardAndPrint[]
  sideboardCards: cardAndPrint[]
}): (cardAndPrint & { zone: string })[] {
  return [
    ...zones.legendCards.map((card) => ({ ...card, zone: 'legend' })),
    ...zones.championCards.map((card) => ({ ...card, zone: 'champion' })),
    ...zones.mainDeckCards.map((card) => ({ ...card, zone: 'mainDeck' })),
    ...zones.battlefieldCards.map((card) => ({ ...card, zone: 'battlefields' })),
    ...zones.runeCards.map((card) => ({ ...card, zone: 'runes' })),
    ...zones.sideboardCards.map((card) => ({ ...card, zone: 'sideboard' })),
  ]
}

export function convertDeckCardInput(cards: (cardAndPrint & { zone: string })[]): DeckCardInput[] {
  const deckCardInputs: DeckCardInput[] = []
  for (const card of cards) {
    const c: DeckCardInput = {
      cardPrintId: card.selectedPrints ?? card.card_prints[0].id,
      quantity: 1,
      zone: card.zone!,
    }
    deckCardInputs.push(c)
  }

  return deckCardInputs
}

export function compressDeckCards(cards: DeckCardInput[]): DeckCardInput[] {
  const compressed: DeckCardInput[] = []
  for (const card of cards) {
    const existing = compressed.find(
      (c) => c.cardPrintId === card.cardPrintId && c.zone === card.zone
    )
    if (existing) {
      existing.quantity += card.quantity
    } else {
      compressed.push(card)
    }
  }
  return compressed
}
