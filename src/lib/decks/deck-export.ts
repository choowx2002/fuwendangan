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

export type ExportLang = 'en' | 'cn'

function pickNames(c: DeckCardDetail, lang: ExportLang): { name: string; subtitle: string | null } {
  return lang === 'cn'
    ? { name: c.card_name_cn ?? '', subtitle: c.sub_title_cn }
    : { name: c.card_name_en ?? '', subtitle: c.sub_title_en }
}

/** 卡名渲染：传奇去掉 "- 后缀" / 忽略副标题并前置英雄名（如 "Master Yi, Wuju Bladesman" / "易, 无极剑圣"），其余名称 + 可选副标题 */
function renderCardName(
  c: DeckCardDetail,
  zone: ZoneKey,
  championName: string | undefined,
  lang: ExportLang
): string {
  const { name, subtitle } = pickNames(c, lang)
  if (zone === 'legend') {
    const base = name.replace(/\s*-\s*.*$/, '').trim()
    return championName ? `${championName}, ${base}` : base
  }
  return subtitle ? `${name}, ${subtitle}` : name
}

export function formatDeckExport(
  zoneCards: Record<ZoneKey, DeckCardDetail[]>,
  lang: ExportLang = 'en'
): string {
  const blocks: string[] = []
  const championName = pickNames(zoneCards.champion[0], lang).name || undefined

  for (const zone of EXPORT_ZONE_ORDER) {
    const list = zoneCards[zone]
    if (list.length === 0) continue

    const lines = [`${ZONE_CONFIG[zone].name}:`]
    for (const c of sortForExport(list)) {
      const name = renderCardName(c, zone, championName, lang)
      lines.push(`${c.quantity} ${name} [${c.print_code}]`)
    }
    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}

const OFFICIAL_SECTION_LABELS: Record<ZoneKey, string> = {
  legend: 'Legend',
  champion: 'Champion',
  mainDeck: 'Main Deck',
  battlefields: 'Battlefields',
  runes: 'Rune Pool',
  sideboard: 'Sideboard',
}

/** 生成「国际官方文本」格式（与 parseGlobalOfficialText 可互相往返，固定英文） */
export function formatOfficialDeckExport(zoneCards: Record<ZoneKey, DeckCardDetail[]>): string {
  const blocks: string[] = []
  const championName = pickNames(zoneCards.champion[0], 'en').name || undefined

  for (const zone of EXPORT_ZONE_ORDER) {
    const list = zoneCards[zone]
    if (list.length === 0) continue

    const parts = sortForExport(list).map(
      (c) => `${c.quantity} ${renderCardName(c, zone, championName, 'en')}`
    )
    blocks.push(`${OFFICIAL_SECTION_LABELS[zone]}: \n${parts.join('\n')}`)
  }

  return blocks.join('\n')
}
