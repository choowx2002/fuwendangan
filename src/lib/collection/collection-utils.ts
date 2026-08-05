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
