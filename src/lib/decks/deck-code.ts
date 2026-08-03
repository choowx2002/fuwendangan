import { getCodeFromDeck } from '@piltoverarchive/riftbound-deck-codes'
import type { Deck as RiftboundDeck } from '@piltoverarchive/riftbound-deck-codes'
import type { DeckCardDetail } from '$lib/db'
import type { ZoneKey } from './zone'

export function buildDeckCode(zoneCards: Record<ZoneKey, DeckCardDetail[]>): {
  code: string | null
  error: string | null
} {
  const { legend, champion, mainDeck, battlefields, runes, sideboard } = zoneCards
  const main = [...legend, ...mainDeck, ...runes, ...battlefields, ...champion]

  if (main.length + sideboard.length === 0) return { code: null, error: null }

  try {
    const toCodeList = (list: DeckCardDetail[]): RiftboundDeck =>
      list.map((c) => ({ cardCode: c.print_code, count: c.quantity }))

    const championCode = champion[0]?.print_code
    const code = getCodeFromDeck(toCodeList(main), toCodeList(sideboard), championCode)
    return { code, error: null }
  } catch (e) {
    return { code: null, error: e instanceof Error ? e.message : '生成失败' }
  }
}
