/**
 * 复盘卡组重叠率（纯函数）
 *
 * 供卡组绑定选择（DeckBindPanel）、对局资料弹窗（ReplayInfoModal）与复盘列表卡片
 * （replay/+page.svelte 的匹配徽标）共用：比较「己方主牌」与本地卡组卡牌的主牌重叠率。
 */
import { normalizeSignedSuffix } from '$lib/decks/deck-import'
import type { DeckCardDetail } from '$lib/db'

/** 主牌与卡组卡牌的主牌重叠率（sideboard 不计入） */
export function deckOverlapRatio(
  mainDeck: { cardCode: string }[],
  cards: DeckCardDetail[]
): number {
  const a = new Set<string>()
  for (const en of mainDeck ?? []) a.add(normalizeSignedSuffix(en.cardCode))
  if (a.size === 0) return 0
  const b = new Set<string>()
  for (const c of cards) {
    if (c.zone === 'sideboard') continue
    if (c.print_code) b.add(normalizeSignedSuffix(c.print_code))
  }
  let hit = 0
  for (const code of a) if (b.has(code)) hit++
  return hit / a.size
}
