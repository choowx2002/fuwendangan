/**
 * 版本卡牌差异计算（纯函数）
 * 卡牌唯一标识使用 card_id（card_prints.id，即 deck_cards.card_id）
 */

export interface DiffCard {
  card_id: string
  card_base_id?: string | null
  print_id?: string | null
  quantity: number
  card_name_cn?: string | null
  card_name_en?: string | null
  sub_title_cn?: string | null
  sub_title_en?: string | null
  print_code?: string | null
  language?: string | null
  img_cdn?: string | null
  zone?: string | null
}

export type DiffKind = 'added' | 'removed' | 'increased' | 'decreased'

export interface VersionDiffItem {
  kind: DiffKind
  name: string
  qty: number
  delta: number
  card_id: string
  card_base_id: string | null
  print_id: string | null
  print_code: string | null
  language: string | null
  img_cdn: string | null
  isLandscape: boolean
}

const KIND_ORDER: DiffKind[] = ['added', 'removed', 'increased', 'decreased']

const LANDSCAPE_ZONES = new Set(['battlefields', 'battlefield', 'landscape'])

function buildQuantityMap(cards: DiffCard[]): Map<string, DiffCard> {
  const map = new Map<string, DiffCard>()
  for (const card of cards) {
    const existing = map.get(card.card_id)
    map.set(card.card_id, {
      ...card,
      quantity: (existing?.quantity ?? 0) + card.quantity,
    })
  }
  return map
}

function cardName(card: DiffCard): string {
  const base = card.card_name_cn || card.card_name_en || card.card_id
  const sub = card.sub_title_cn || card.sub_title_en
  return sub ? `${base} - ${sub}` : base
}

function toItem(kind: DiffKind, card: DiffCard, qty: number, delta: number): VersionDiffItem {
  return {
    kind,
    name: cardName(card),
    qty,
    delta,
    card_id: card.card_id,
    card_base_id: card.card_base_id ?? null,
    print_id: card.print_id ?? null,
    print_code: card.print_code ?? null,
    language: card.language ?? null,
    img_cdn: card.img_cdn ?? null,
    isLandscape: card.zone ? LANDSCAPE_ZONES.has(card.zone) : false,
  }
}

/**
 * 计算两个版本之间的卡牌差异
 * prev = 上一版本卡牌，curr = 当前版本卡牌
 */
export function computeVersionDiff(prev: DiffCard[], curr: DiffCard[]): VersionDiffItem[] {
  const prevMap = buildQuantityMap(prev)
  const currMap = buildQuantityMap(curr)

  const items: VersionDiffItem[] = []

  for (const [cardId, card] of currMap) {
    const prevCard = prevMap.get(cardId)
    const qty = card.quantity
    if (!prevCard) {
      items.push(toItem('added', card, qty, qty))
    } else if (qty > prevCard.quantity) {
      items.push(toItem('increased', card, qty, qty - prevCard.quantity))
    } else if (qty < prevCard.quantity) {
      items.push(toItem('decreased', card, qty, prevCard.quantity - qty))
    }
  }

  for (const [cardId, card] of prevMap) {
    if (!currMap.has(cardId)) {
      items.push(toItem('removed', card, card.quantity, card.quantity))
    }
  }

  return items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

/**
 * 计算版本卡牌总数
 */
export function computeTotalCards(cards: DiffCard[]): number {
  return cards.reduce((sum, card) => sum + card.quantity, 0)
}
