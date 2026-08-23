/**
 * 收藏页通用工具
 */

/** 取卡片的印刷系列码（默认卡图优先，回退第一张卡图；series 在打印级） */
export function seriesCodeOfCard(card: { card_prints?: { series?: string | null }[] }): string {
  const prints = card.card_prints ?? []
  const def = prints.find((p) => (p as { is_default?: boolean }).is_default)
  return (def ?? prints[0])?.series ?? ''
}

/** 合并卡名与副标题（任一为空则只取另一项；均空返回空串） */
export function combineCardName(
  cardNameCn: string | null | undefined,
  subCn: string | null | undefined
): string {
  return [cardNameCn, subCn].filter((s): s is string => !!s && s.trim() !== '').join(' ')
}
