import type { cardAndPrint } from './types'

export interface GroupedCard {
  card: cardAndPrint
  count: number
}

export function groupCards(cards: cardAndPrint[]): GroupedCard[] {
  const map = new Map<string, GroupedCard>()

  for (const card of cards) {
    const key = `${card.id}:${card.selectedPrints ?? ''}`
    const existing = map.get(key)

    if (existing) {
      existing.count += 1
    } else {
      map.set(key, {
        card,
        count: 1,
      })
    }
  }

  return Array.from(map.values())
}
