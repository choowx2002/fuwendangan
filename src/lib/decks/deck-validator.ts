// src/lib/decks/deck-validator.ts
import {
  DEFAULT_FORMAT,
  getZoneConfig,
  resolveFormat,
  ZONE_CONFIG,
  type FormatKey,
  type ZoneKey,
} from './zone'
import type { cardAndPrint } from './types'

export interface DeckIssue {
  severity: 'error' | 'warning'
  type: 'banned' | 'capacity' | 'name_limit'
  messageKey: string
  params: Record<string, string | number>
  cardNames?: (string | null)[]
}

/** 同名卡牌默认上限（deck_limit 为空时使用） */
export const DEFAULT_CARD_LIMIT = 3

/** 单卡同名上限统计的作用域：英雄 + 主牌 + 备牌 */
const LIMIT_ZONES: ZoneKey[] = ['champion', 'mainDeck', 'sideboard']

/**
 * 单卡同名数量上限：
 * deck_limit 为空 → 默认 3；0 / 负数 → 不限（返回 null）；正数 → 最多该张数。
 */
export function getCardLimit(card: cardAndPrint): number | null {
  const limit = card.deck_limit
  if (limit === null || limit === undefined) return DEFAULT_CARD_LIMIT
  if (limit <= 0) return null
  return limit
}

export function validateDeck(
  deck: {
    legendCards: cardAndPrint[]
    championCards: cardAndPrint[]
    mainDeckCards: cardAndPrint[]
    battlefieldCards: cardAndPrint[]
    runeCards: cardAndPrint[]
    sideboardCards: cardAndPrint[]
  },
  format: FormatKey = DEFAULT_FORMAT
): DeckIssue[] {
  const fmt = resolveFormat(format)
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

  // 1. 区域容量检查（按格式）
  for (const zoneKey of Object.keys(ZONE_CONFIG) as ZoneKey[]) {
    const config = getZoneConfig(fmt, zoneKey)
    const cards = zoneCards[zoneKey]
    if (cards.length > config.maxCount) {
      issues.push({
        severity: 'error',
        type: 'capacity',
        messageKey: 'builder.issueCapacityOver',
        params: { zone: config.labelKey, count: cards.length, max: config.maxCount },
      })
    }

    if (zoneKey !== 'sideboard' && cards.length < config.maxCount) {
      issues.push({
        severity: 'warning',
        type: 'capacity',
        messageKey: 'builder.issueCapacityUnder',
        params: { zone: config.labelKey, count: cards.length, max: config.maxCount },
      })
    }
  }

  // 2. 同名卡牌数量限制（英雄 + 主牌 + 备牌，按卡牌 deck_limit）
  const nameCountMap = new Map<string, { count: number; name: string; limit: number | null }>()
  const coreZones = [...championCards, ...mainDeckCards, ...sideboardCards]

  for (const card of coreZones) {
    const identifier = `${card.card_name_cn || ''}|${card.sub_title_cn || ''}`
    const displayName = `${card.card_name_cn}${card.sub_title_cn ? ' - ' + card.sub_title_cn : ''}`

    const existing = nameCountMap.get(identifier)
    if (existing) {
      existing.count += 1
    } else {
      nameCountMap.set(identifier, { count: 1, name: displayName, limit: getCardLimit(card) })
    }
  }

  for (const data of nameCountMap.values()) {
    if (data.limit === null) continue
    if (data.count > data.limit) {
      issues.push({
        severity: 'error',
        type: 'name_limit',
        messageKey: 'builder.issueNameLimit',
        params: { name: data.name, count: data.count, limit: data.limit },
        cardNames: [data.name],
      })
    }
  }

  // 3. 禁卡检查
  const bannedCards = allCards.filter((c) => c.is_banned)
  if (bannedCards.length > 0) {
    issues.push({
      severity: 'error',
      type: 'banned',
      messageKey: 'builder.issueBanned',
      params: { names: bannedCards.map((c) => c.card_name_cn).join('、') },
      cardNames: bannedCards.map((c) => c.card_name_cn),
    })
  }

  return issues
}

export function checkZoneCapacity(
  zone: ZoneKey,
  currentCount: number,
  format: FormatKey = DEFAULT_FORMAT
) {
  const config = getZoneConfig(resolveFormat(format), zone)
  if (currentCount >= config.maxCount) {
    return {
      messageKey: 'builder.issueZoneFull',
      params: { zone: config.labelKey, max: config.maxCount },
    }
  }
  return null
}
