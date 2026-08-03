import type { DeckCardDetail } from '$lib/db'
import { ZONE_CONFIG, type ZoneKey } from './zone'

const EXPORT_ZONE_ORDER: ZoneKey[] = [
  'legend',
  'champion',
  'mainDeck',
  'battlefields',
  'runes',
  'sideboard',
]

export function sortForExport(list: DeckCardDetail[]): DeckCardDetail[] {
  return [...list].sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity
    const ac = a.print_code ?? ''
    const bc = b.print_code ?? ''
    return ac < bc ? -1 : ac > bc ? 1 : 0
  })
}

export function formatDeckExport(zoneCards: Record<ZoneKey, DeckCardDetail[]>): string {
  const blocks: string[] = []

  for (const zone of EXPORT_ZONE_ORDER) {
    const list = zoneCards[zone]
    if (list.length === 0) continue

    const lines = [`${ZONE_CONFIG[zone].name}:`]
    for (const c of sortForExport(list)) {
      const name = c.sub_title_en ? `${c.card_name_en} - ${c.sub_title_en}` : c.card_name_en
      lines.push(`${c.quantity} ${name} [${c.print_code}]`)
    }
    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}
