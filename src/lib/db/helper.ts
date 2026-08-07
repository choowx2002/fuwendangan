import { SORT_FIELD_LIST } from './constants'
import type {
  ActiveFilter,
  ArrayFilterParam,
  CardBase,
  CardPrint,
  CardSearchParams,
  IconDB,
  Deck,
  DeckCard,
  SortKeyItem,
  SqliteCardBase,
  SqliteDeck,
  NumberRange,
} from './types'

/**
 * 辅助函数：将 SQLite 行数据反序列化为前端使用的 CardBase 模型
 */
export function mapRowToCard(row: any): CardBase {
  return {
    ...row,
    card_category: row.card_category ? JSON.parse(row.card_category) : null,
    card_color_list: row.card_color_list ? JSON.parse(row.card_color_list) : null,
    region: row.region ? JSON.parse(row.region) : null,
    tag: row.tag ? JSON.parse(row.tag) : null,
    keyword: row.keyword ? JSON.parse(row.keyword) : null,
    advanced_tag: row.advanced_tag ? JSON.parse(row.advanced_tag) : null,
    // 将 0/1 转回 boolean
    is_banned: row.is_banned === 1,
  }
}

export function mapRowToPrint(row: any): CardPrint {
  return {
    ...row,
    // 将 0/1/null 转回 boolean/null
    is_default: row.is_default === null ? null : row.is_default === 1,
    is_promo: row.is_promo === null ? null : row.is_promo === 1,
    is_custom: row.is_custom === null ? null : row.is_custom === 1,
  }
}

export function mapRowToIcon(row: any): IconDB {
  return {
    ...row,
    // 将 0/1/null 转回 boolean/null
    isWhite: row.isWhite === 1,
  }
}

// 适配器：将 PG 数据模型转换为 SQLite 存储模型
export function toSqliteModel(card: CardBase): SqliteCardBase {
  return {
    ...card, // 直接展开，保留所有普通文本和数字字段
    // 仅覆盖需要序列化的数组字段
    card_category: card.card_category ? JSON.stringify(card.card_category) : null,
    card_color_list: card.card_color_list ? JSON.stringify(card.card_color_list) : null,
    region: card.region ? JSON.stringify(card.region) : null,
    tag: card.tag ? JSON.stringify(card.tag) : null,
    keyword: card.keyword ? JSON.stringify(card.keyword) : null,
    advanced_tag: card.advanced_tag ? JSON.stringify(card.advanced_tag) : null,
    // 覆盖布尔值字段
    is_banned: card.is_banned ? 1 : 0,
  }
}

export interface BestPrint {
  url: string
  fallbackUrl: string | null
  id: string | null
  card_no_extend: string | null
  language: string | null
}

/**
 * 图片缓存文件名前缀（CachedImage / CardSimpleImage 的 name 用）：
 * 格式为 {card_no_extend}-{language}（如 SC01-001-SC），
 * 不依赖雪花 id，同步重建 id 后缓存不失效；缺字段时回退 print id / 'default'。
 */
export function printCacheName(
  p: { card_no_extend?: string | null; language?: string | null; id?: string | null } | null | undefined
): string {
  if (p?.card_no_extend && p?.language) {
    return `${p.card_no_extend}-${p.language.toUpperCase()}`
  }
  return p?.id || 'default'
}

/**
 * 获取卡牌的最佳展示卡图
 * 逻辑：1. is_default -> 2. 中文且 print_order 最小 -> 3. 第一张
 */
export function getBestPrint(card: CardBase & { card_prints?: CardPrint[] }): BestPrint | null {
  if (!card.card_prints || card.card_prints.length === 0) return null

  const prints = card.card_prints

  // 1. 优先找 is_default
  let best = prints.find((p) => p.is_default)

  // 2. 如果没有，找中文里 print_order 最小的
  if (!best) {
    const zhPrints = prints.filter((p) => p.language === '中文' || p.language === 'zh')
    if (zhPrints.length > 0) {
      zhPrints.sort((a, b) => (a.print_order || 0) - (b.print_order || 0))
      best = zhPrints[0]
    }
  }

  // 3. 兜底：第一张
  if (!best) best = prints[0]

  return {
    url: best.img_cdn || '',
    fallbackUrl: best.tts_cdn || null,
    id: best.id || null,
    card_no_extend: best.card_no_extend || null,
    language: best.language || null,
  }
}

const typeToFieldMap: Record<string, keyof CardSearchParams> = {
  // UI 常用别名
  tag: 'tag',
  keyword: 'keyword',
  color: 'card_color_list',
  region: 'region',
  advanced_tag: 'advanced_tag',
  category: 'card_category',
  series: 'series_name',
  rarity: 'rarity_name',
  champion: 'champion_tag',

  // 真实 DB 字段名 (防止 UI 层直接传字段名导致映射失败)
  card_color_list: 'card_color_list',
  card_category: 'card_category',
  series_name: 'series_name',
  rarity_name: 'rarity_name',
  champion_tag: 'champion_tag',
}

export function buildSearchParams(
  activeFilters: ActiveFilter[] | any, // 放宽类型以接收 Svelte Proxy
  searchText: string,
  page: number = 1,
  pageSize: number = 60,
  sortByList?: SortKeyItem[],
  energy?: NumberRange | number,
  return_energy?: NumberRange | number,
  power?: NumberRange | number
): CardSearchParams {
  const params: CardSearchParams = {
    page,
    pageSize,
    searchText,
    is_banned: false,
    sortByList,
  }

  const rawFilters = activeFilters
  // 2. 防御性兼容：如果 Svelte 把它变成了 {0: {...}} 这样的对象，用 Object.values 转回数组
  const filtersArray = Array.isArray(rawFilters) ? rawFilters : Object.values(rawFilters || {})

  if (energy) params.energy = energy

  if (return_energy) params.return_energy = return_energy

  if (return_energy) params.power = power

  for (const filter of filtersArray) {
    if (!filter || !filter.type) continue

    const dbField = typeToFieldMap[filter.type]
    if (!dbField) {
      console.warn(`[buildSearchParams] 未知的 filter type: ${filter.type}`)
      continue
    }

    const arrayFields = [
      'tag',
      'keyword',
      'card_color_list',
      'region',
      'advanced_tag',
      'rarity_name',
      'series_name',
      'card_category',
    ]
    if (arrayFields.includes(dbField as string)) {
      if (!params[dbField as keyof CardSearchParams]) {
        ;(params as any)[dbField] = {} as ArrayFilterParam
      }
      const paramObj = (params as any)[dbField] as ArrayFilterParam

      // UI 的 'require' 对应底层 SQL 的 'must'
      const modeKey = filter.mode === 'require' ? 'must' : filter.mode

      if (!paramObj[modeKey as keyof ArrayFilterParam]) {
        ;(paramObj as any)[modeKey] = []
      }
      ;(paramObj as any)[modeKey].push(filter.value)
    }
    // 处理文本类字段 (精确匹配，如 category, rarity)
    else {
      ;(params as any)[dbField] = filter.value
    }
  }

  // console.log('[buildSearchParams] 最终生成的 params:', params)
  return params
}

export function buildOrderBy(sortByList?: SortKeyItem[]) {
  const baseOrder = ['cards_base.card_no ASC']

  if (!sortByList?.length) {
    return `ORDER BY ${baseOrder.join(', ')}`
  }

  const dynamic = sortByList
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const column = SORT_FIELD_LIST.findIndex((field) => field === item.name)
      if (column === -1) return null

      return `cards_base.${item.name} ${item.isAsc ? 'ASC' : 'DESC'}`
    })
    .filter(Boolean)

  return `ORDER BY ${[...dynamic].join(', ')}`
}

/**
 * 辅助函数：将 Deck 标签数组序列化为 SQLite 存储的 JSON 字符串
 */
export function serializeTags(tags?: string[] | null): string | null {
  if (!tags || tags.length === 0) return null
  return JSON.stringify(tags)
}

/**
 * 辅助函数：将 SQLite 存储的 JSON 字符串解析为标签数组
 */
export function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string')
    }
    return []
  } catch {
    return []
  }
}

/**
 * 辅助函数：将 SQLite Deck 行数据反序列化为前端使用的 Deck 模型
 */
export function mapRowToDeck(row: any): Deck {
  return {
    ...row,
    is_favorite: row.is_favorite === 1,
    tags: parseTags(row.tags),
  }
}

/**
 * 辅助函数：将 SQLite DeckCard 行数据反序列化为 DeckCard 模型
 */
export function mapRowToDeckCard(row: any): DeckCard {
  return {
    ...row,
    is_sideboard: row.is_sideboard === 1,
  }
}

/**
 * 适配器：将 Deck 数据模型转换为 SQLite 存储模型
 */
export function toSqliteDeck(deck: Deck): SqliteDeck {
  return {
    ...deck,
    is_favorite: deck.is_favorite ? 1 : 0,
    tags: serializeTags(deck.tags),
  }
}

/**
 * 适配器：将 DeckCard 数据模型转换为 SQLite 存储模型
 */
export function toSqliteDeckCard(deckCard: DeckCard): DeckCard {
  return {
    ...deckCard,
  }
}

export const formatBytes = (bytes: number, fraction = 2) => {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0

  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }

  return `${size.toFixed(fraction)} ${units[i]}`
}
