/**
 * 卡组「需要准备的指示物」分析
 *
 * 逻辑：获取卡组最新版本全部卡牌的效果文本（按数量展开），
 * 扫描其中是否提及指示物卡牌的名字（中文名 / 英文名 / 副标题），
 * 命中即认为该指示物可能在实战中出现，按命中次数排序返回。
 *
 * 纯函数部分（matchTokenMentions）可独立测试，DB 读取部分单独封装。
 */

import {
  getTokenCards,
  getLatestDeckCardEffects,
  getPrintsByCardId,
  getBestPrint,
  type CardBase,
  type DeckCardEffect,
} from '$lib/db'

export interface TokenSuggestion {
  card: CardBase
  bestPrint: {
    url: string
    fallbackUrl: string | null
    id: string | null
    card_no_extend: string | null
    language: string | null
  } | null
  mentions: number
}

/** 生成指示物的候选名字（长名优先，避免短名误命中） */
export function tokenCandidateNames(card: CardBase): string[] {
  const names: string[] = []
  const push = (s: string | null | undefined) => {
    const v = s?.trim()
    if (v && v.length > 0) names.push(v)
  }

  push(card.card_name_cn)
  push(card.card_name_en)
  // 副标题通常是「单位指示物」等更具体的叫法，拼成完整名提高匹配准确度
  if (card.sub_title_cn && card.card_name_cn) {
    push(`${card.card_name_cn}-${card.sub_title_cn}`)
  }
  if (card.sub_title_en && card.card_name_en) {
    push(`${card.card_name_en}-${card.sub_title_en}`)
  }
  push(card.sub_title_cn)
  push(card.sub_title_en)

  // 去重（保持顺序），并且按长度降序（长名优先匹配）
  return [...new Set(names)].sort((a, b) => b.length - a.length)
}

/**
 * 在效果文本中匹配指示物名字。
 * 返回 true 表示该效果文本提及了至少一个候选名字。
 */
export function effectMentionsToken(effect: string | null | undefined, names: string[]): boolean {
  if (!effect) return false
  for (const name of names) {
    if (name.length > 0 && effect.includes(name)) return true
  }
  return false
}

/**
 * 纯函数：给定卡组全部卡牌效果与全部指示物卡，计算每个指示物的命中次数。
 */
export function matchTokenMentions(
  effects: DeckCardEffect[],
  tokens: CardBase[]
): Map<string, number> {
  const mentions = new Map<string, number>()
  for (const token of tokens) {
    const names = tokenCandidateNames(token)
    let count = 0
    for (const effect of effects) {
      if (
        effectMentionsToken(effect.effect_cn, names) ||
        effectMentionsToken(effect.effect_en, names)
      ) {
        count++
      }
    }
    if (count > 0) mentions.set(token.id, count)
  }
  return mentions
}

/** 指示物的展示名（中文优先），用于去重 */
export function tokenDisplayName(card: CardBase): string {
  return card.card_name_cn || card.card_name_en || card.id
}

/**
 * 获取卡组的指示物建议列表（按命中次数降序）。
 * 同名指示物（可能多条 cards_base 记录）只保留第一条，避免重复展示。
 */
export async function getDeckTokenSuggestions(deckId: string): Promise<TokenSuggestion[]> {
  const [effects, allTokens] = await Promise.all([
    getLatestDeckCardEffects(deckId),
    getTokenCards(),
  ])

  const seen = new Set<string>()
  const tokens = allTokens.filter((token) => {
    const name = tokenDisplayName(token)
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })

  const mentions = matchTokenMentions(effects, tokens)

  const suggestions: TokenSuggestion[] = []
  for (const token of tokens) {
    const count = mentions.get(token.id)
    if (!count || count <= 0) continue

    const prints = await getPrintsByCardId(token.id)
    const bestPrint = getBestPrint({ ...token, card_prints: prints })
    suggestions.push({ card: token, bestPrint, mentions: count })
  }

  return suggestions.sort((a, b) => b.mentions - a.mentions)
}
