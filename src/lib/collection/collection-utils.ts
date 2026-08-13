/**
 * 收藏页通用工具
 */

/** 由卡图印刷编号推导系列码（card_no_extend 前 3 位大写） */
export function deriveSeriesCode(cardNoExtend: string | null | undefined): string {
  return (cardNoExtend ?? '').toUpperCase().slice(0, 3)
}

/** 取卡片的印刷系列码（默认卡图优先，回退第一张卡图） */
export function seriesCodeOfCard(card: { card_prints?: { card_no_extend: string }[] }): string {
  const prints = card.card_prints ?? []
  const def = prints.find((p) => (p as { is_default?: boolean }).is_default)
  return deriveSeriesCode((def ?? prints[0])?.card_no_extend)
}

/** 合并卡名与副标题（任一为空则只取另一项；均空返回空串） */
export function combineCardName(
  cardNameCn: string | null | undefined,
  subCn: string | null | undefined
): string {
  return [cardNameCn, subCn].filter((s): s is string => !!s && s.trim() !== '').join(' ')
}
