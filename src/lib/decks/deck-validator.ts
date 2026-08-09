// src/lib/decks/deck-validator.ts
import { ZONE_CONFIG, type ZoneKey } from './zone'
import type { cardAndPrint } from './types'

export interface DeckIssue {
  severity: 'error' | 'warning'
  type: 'banned' | 'capacity' | 'name_limit' | 'weiwo_limit'
  messageKey: string
  params: Record<string, string | number>
  cardNames?: (string | null)[]
}

export function validateDeck(deck: {
  legendCards: cardAndPrint[]
  championCards: cardAndPrint[]
  mainDeckCards: cardAndPrint[]
  battlefieldCards: cardAndPrint[]
  runeCards: cardAndPrint[]
  sideboardCards: cardAndPrint[]
}): DeckIssue[] {
  const issues: DeckIssue[] = []
  const { legendCards, championCards, mainDeckCards, battlefieldCards, runeCards, sideboardCards } =
    deck

  const zoneCards = {
    legend: legendCards,
    champion: championCards,
    mainDeck: mainDeckCards,
    battlefields: battlefieldCards,
    runes: runeCards,
    sideboard: sideboardCards,
  }

  const allCards = [
    ...legendCards,
    ...championCards,
    ...mainDeckCards,
    ...battlefieldCards,
    ...runeCards,
    ...sideboardCards,
  ]

  // 1. 区域容量检查 & 禁卡检查
  for (const [zoneKey, zone] of Object.entries(ZONE_CONFIG)) {
    const cards = zoneCards[zoneKey as ZoneKey]
    if (cards.length > zone.maxCount) {
      issues.push({
        severity: 'error',
        type: 'capacity',
        messageKey: 'builder.issueCapacityOver',
        params: { zone: zone.labelKey, count: cards.length, max: zone.maxCount },
      })
    }

    if (zone.name !== 'Sideboard' && cards.length < zone.maxCount) {
      issues.push({
        severity: 'warning',
        type: 'capacity',
        messageKey: 'builder.issueCapacityUnder',
        params: { zone: zone.labelKey, count: cards.length, max: zone.maxCount },
      })
    }

    const bannedCards = cards.filter((c) => c.is_banned)
    if (bannedCards.length > 0) {
      issues.push({
        severity: 'error',
        type: 'banned',
        messageKey: 'builder.issueBanned',
        params: { names: bannedCards.map((c) => c.card_name_cn).join('、') },
        cardNames: bannedCards.map((c) => c.card_name_cn),
      })
    }
  }

  // 2. 同名卡牌限制 (Champion + MainDeck + Sideboard <= 3)
  const coreZones = [...championCards, ...mainDeckCards, ...sideboardCards]
  const nameCountMap = new Map<string, { count: number; name: string }>()

  for (const card of coreZones) {
    const rawName = (card.card_name_cn ?? '') + (card.sub_title_cn ?? '')
    if (rawName === '小蜘蛛') continue

    const identifier = `${card.card_name_cn || ''}|${card.sub_title_cn || ''}`
    const displayName = `${card.card_name_cn}${card.sub_title_cn ? ' - ' + card.sub_title_cn : ''}`

    const existing = nameCountMap.get(identifier)
    if (existing) {
      existing.count += 1
    } else {
      nameCountMap.set(identifier, { count: 1, name: displayName })
    }
  }

  for (const data of nameCountMap.values()) {
    if (data.count > 3) {
      issues.push({
        severity: 'error',
        type: 'name_limit',
        messageKey: 'builder.issueNameLimit',
        params: { name: data.name, count: data.count },
        cardNames: [data.name],
      })
    }
  }

  // 3. "唯我" 限制 (每种同名唯我卡牌全局 <= 1)
  // 同时检查 keyword 和 effect_cn，防止 CSV 数据录入不一致
  const weiWoCardsInDeck = allCards.filter(
    (c) => c.keyword?.includes('唯我') || c.effect_cn?.includes('唯我')
  )

  // 按卡牌名称分组，统计每种唯我卡在卡组中的数量
  const weiWoCountMap = new Map<string, number>()
  for (const card of weiWoCardsInDeck) {
    const name = card.card_name_cn
    weiWoCountMap.set(name!, (weiWoCountMap.get(name!) || 0) + 1)
  }

  // 检查是否有某一种唯我卡的数量超过了 1
  for (const [name, count] of weiWoCountMap.entries()) {
    if (count > 1) {
      issues.push({
        severity: 'error',
        type: 'weiwo_limit',
        messageKey: 'builder.issueWeiwoLimit',
        params: { name, count },
        cardNames: [name],
      })
    }
  }

  return issues
}

export function checkZoneCapacity(zone: ZoneKey, currentCount: number) {
  const config = ZONE_CONFIG[zone]
  if (currentCount >= config.maxCount) {
    return {
      messageKey: 'builder.issueZoneFull',
      params: { zone: config.labelKey, max: config.maxCount },
    }
  }
  return null
}
