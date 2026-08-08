/**
 * 卡牌五桶分类工具
 * 以「卡牌（card_id + card_no_extend）」为单位，用于收藏完成度统计与展示。
 * 分类优先级：符文/指示物按卡牌类别判定（覆盖其全部打印），其余按卡图扩展稀有度。
 */

export type VariantBucket = 'base' | 'alt' | 'overnum' | 'rune' | 'token'

export const BUCKET_LABELS: Record<VariantBucket, string> = {
  base: '平卡',
  alt: '异画',
  overnum: '超编',
  rune: '符文',
  token: '指示物',
}

/** 是否为符文卡（卡牌类别任一含「符文」） */
export function isRuneCard(cardCategory: string[] | null | undefined): boolean {
  return cardCategory?.some((c) => c.includes('符文')) ?? false
}

/** 是否为指示物卡（卡牌类别任一含「指示物」） */
export function isTokenCard(cardCategory: string[] | null | undefined): boolean {
  return cardCategory?.some((c) => c.includes('指示物')) ?? false
}

/** 依据卡牌类别 + 卡图扩展稀有度判定卡牌归属桶 */
export function classifyVariant(
  cardCategory: string[] | null | undefined,
  extendRarityName: string | null | undefined
): VariantBucket {
  if (isRuneCard(cardCategory)) return 'rune'
  if (isTokenCard(cardCategory)) return 'token'
  switch (extendRarityName) {
    case '异画':
      return 'alt'
    case '超编':
    case '签名超编':
      return 'overnum'
    default:
      return 'base'
  }
}

/** 按卡牌类别选择卡背兜底图：符文 → white，传奇/战场/战场指示物 → black，其余 → blue */
export function getCardBackFallback(cardCategory: string[] | null | undefined): string {
  if (isRuneCard(cardCategory)) return '/white.jpg'
  if (cardCategory?.some((c) => c === '传奇' || c.includes('战场'))) return '/black.jpg'
  return '/blue.jpg'
}
