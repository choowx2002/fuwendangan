import type { CardBase, CardPrint } from '$lib/db'

export type cardAndPrint = CardBase & { card_prints: CardPrint[] } & { selectedPrints?: string }
