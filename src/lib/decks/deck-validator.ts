// src/lib/utils/deck-validator.ts
import type { CardBase, CardPrint } from '$lib/db/types'

type cardAndPrint = CardBase & { card_prints: CardPrint[] } & { selectedPrints?: string }

export interface DeckIssue {
  severity: 'error' | 'warning'
  type: 'banned' | 'capacity' | 'name_limit' | 'weiwo_limit'
  message: string
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

  const ZONE_CONFIG = {
    legend: { name: '传奇', maxCount: 1, cards: legendCards },
    champion: { name: '选定英雄', maxCount: 1, cards: championCards },
    mainDeck: { name: '主牌堆', maxCount: 39, cards: mainDeckCards },
    battlefields: { name: '战场', maxCount: 3, cards: battlefieldCards },
    runes: { name: '符文', maxCount: 12, cards: runeCards },
    sideboard: { name: '备牌', maxCount: 8, cards: sideboardCards },
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
    if (zone.cards.length > zone.maxCount) {
      issues.push({
        severity: 'error',
        type: 'capacity',
        message: `${zone.name} 区域卡牌数量 (${zone.cards.length}) 超过了最大限制 (${zone.maxCount})！`,
      })
    }

    const bannedCards = zone.cards.filter((c) => c.is_banned)
    if (bannedCards.length > 0) {
      issues.push({
        severity: 'error',
        type: 'banned',
        message: `以下禁卡不能加入卡组: ${bannedCards.map((c) => c.card_name_cn).join('、')}`,
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
        message: `同名卡牌 <b>"${data.name}"</b> 在 选定英雄 + 主牌堆 + 备牌 中最多只能加入 3 张 (当前: ${data.count} 张)！`,
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
        message: `带有“唯我”特性的卡牌「${name}」在卡组中只能有 1 张 (当前有 ${count} 张)！`,
        cardNames: [name],
      })
    }
  }

  return issues

  return issues
}
