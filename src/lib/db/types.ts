// 基础卡牌模型 (与 Supabase 保持一致)
export interface CardBase {
  id: string
  card_no: string
  card_name_cn: string | null
  card_name_en: string | null
  sub_title_cn: string | null
  sub_title_en: string | null
  card_category: string[] | null
  card_color_list: string[] | null
  region: string[] | null
  tag: string[] | null
  keyword: string[] | null
  advanced_tag: string[] | null
  champion_tag: string | null
  effect_cn: string | null
  effect_en: string | null
  energy: number | null
  return_energy: number | null
  power: number | null
  rarity_name: string | null
  series_name: string | null
  flavor_text_cn: string | null
  flavor_text_en: string | null
  is_banned: boolean | null
  created_at: string | null
  updated_at: string | null
}

// 卡图/版本模型
export interface CardPrint {
  id: string
  card_id: string | null
  card_no_extend: string
  rarity_name: string | null
  extend_rarity_name: string | null
  back_image: string | null
  language: string
  img_cdn: string | null
  tts_cdn: string | null
  artist: string | null
  print_order: number | null
  is_default: boolean | null
  is_promo: boolean | null
  is_custom: boolean | null
  created_at: string | null
  updated_at: string | null
}

export type CardWithPrint = CardBase & {
  card_prints: CardPrint
  quantity: number
}

// 搜索结果的卡牌，额外携带收藏聚合数量
export type CardWithOwned = CardBase & {
  card_prints?: CardPrint[]
  ownedNormal: number
  ownedFoil: number
  ownedTotal: number
  // 非 promo 变体总数与已拥有变体数（进度用）
  ownedVariants: number
  totalVariants: number
}

// 版本控制模型
export interface AppVersion {
  id: number
  name: string | null
  updated_at: string // ISO 8601 时间字符串
}

export interface IconDB {
  id: number
  name_zh: string
  name_en: string
  url: string
  url_en: string
  isWhite: string
  storage_type: string
  created_at: string // ISO 8601 时间字符串
  updated_at: string // ISO 8601 时间字符串
}

// SQLite 存储模型 (将 PG 的数组转为 JSON 字符串，布尔值转为 0/1)
export interface SqliteCardBase extends Omit<
  CardBase,
  'card_category' | 'card_color_list' | 'region' | 'tag' | 'keyword' | 'advanced_tag' | 'is_banned'
> {
  card_category: string | null
  card_color_list: string | null
  region: string | null
  tag: string | null
  keyword: string | null
  advanced_tag: string | null
  is_banned: number
}

export interface SqliteCardPrint extends Omit<CardPrint, 'is_default' | 'is_promo' | 'is_custom'> {
  is_default: number | null
  is_promo: number | null
  is_custom: number | null
}

export interface CardSearchResult {
  data: CardWithOwned[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== 收藏模型 ====================

export interface CollectionEntry {
  id: string
  card_id: string
  card_no_extend: string
  created_at: string | null
  updated_at: string | null
}

export interface CollectionLang {
  id: string
  collection_id: string
  language: string
  normal_qty: number
  foil_qty: number
}

export interface Series {
  code: string
  name_cn: string | null
  name_en: string | null
  release_order: number
  is_standard: boolean
  is_active: boolean
  base_count: number
  alt_count: number
  overnum_count: number
  rune_count: number
  token_count: number
  created_at: string | null
  updated_at: string | null
}

export type OwnershipType = 'all' | 'owned' | 'missing' | 'foil'
export type CollectionSortKey = 'card_no' | 'rarity' | 'owned' | 'progress'

export interface CollectionSort {
  key: CollectionSortKey
  isAsc: boolean
}

// 系列收藏统计（单系列）
export interface SeriesStats {
  code: string
  nameCn: string | null
  owned: { base: number; alt: number; overnum: number; rune: number; token: number }
  counts: { base: number; alt: number; overnum: number; rune: number; token: number }
  totalOwned: number
  totalCount: number
}

export interface CollectionStats {
  series: SeriesStats[]
  promoOwned: number
  foilOwned: number
  overallOwned: number
  overallCount: number
}

// 自定义 Promo 打印创建输入
export interface CustomPrintInput {
  cardId: string
  cardNoExtend: string
  extendRarityName: string
  language: string
  artist?: string | null
  imgToken?: string | null
  normalQty: number
  foilQty: number
}

// 卡组持有检查结果
export interface OwnershipCheckRow {
  cardId: string
  cardName: string
  cardNo: string
  needed: number
  owned: number
}

// 卡组模型
export interface Deck {
  id: string
  name: string
  description: string | null
  format: string | null
  cover_image: string | null
  tags: string[]
  is_favorite: boolean
  created_at: string | null
  updated_at: string | null
}

// 卡组中的卡牌
export interface DeckCard {
  id: string
  deck_id: string
  card_id: string
  print_code?: string | null
  quantity: number
  zone: string
  created_at: string | null
  // 关联的卡牌数据（可选）
  card?: CardBase
}

// SQLite 存储模型
export interface SqliteDeck extends Omit<Deck, 'is_favorite' | 'tags'> {
  is_favorite: number
  tags: string | null
}

export type FilterStatus = 'unselected' | 'include' | 'must' | 'exclude'

// 数值字段过滤模型 (适用于 power, energy, return_energy)
export interface NumberRange {
  min: number // 大于等于 (>=)
  max: number // 小于等于 (<=)
}

// 数组过滤参数结构
export interface ArrayFilterParam {
  include?: string[] // OR 逻辑
  must?: string[] // AND 逻辑
  exclude?: string[] // NOT 逻辑
}

export interface FilterOptions {
  id: number // 固定为 1
  regions: string[]
  tags: string[]
  keywords: string[]
  advanced_tags: string[]
  colors: string[]
  categories: string[]
  series: string[]
  rarities: string[]
  champions: string[]
  energy_range: { min: number; max: number }
  power_range: { min: number; max: number }
  return_energy_range: { min: number; max: number }
  updated_at: string
}

export interface CardSearchParams {
  page?: number
  pageSize?: number
  searchText?: string
  is_banned?: boolean
  sortByList?: SortKeyItem[]

  // 收藏相关（收藏页使用）
  ownership?: OwnershipType
  collectionSort?: CollectionSort
  includeOwned?: boolean

  // 数组类字段 (使用嵌套对象)
  region?: ArrayFilterParam
  tag?: ArrayFilterParam
  keyword?: ArrayFilterParam
  advanced_tag?: ArrayFilterParam
  card_color_list?: ArrayFilterParam

  // 文本类精确过滤
  card_category?: ArrayFilterParam
  series_name?: ArrayFilterParam
  rarity_name?: ArrayFilterParam
  champion_tag?: string

  // 数值范围过滤
  power?: number | NumberRange
  energy?: number | NumberRange
  return_energy?: number | NumberRange
}

export type FilterMode = 'include' | 'require' | 'exclude'

export type FilterType =
  | 'tag'
  | 'keyword'
  | 'card_color_list'
  | 'region'
  | 'advanced_tag'
  | 'card_category'
  | 'series_name'
  | 'series'
  | 'rarity'
  | 'rarity_name'
  | 'champion_tag'

export interface ActiveFilter {
  value: string
  mode: FilterMode
  type: FilterType
}

export type ArrayFieldKey = 'region' | 'tag' | 'keyword' | 'advanced_tag' | 'card_color_list'

export interface SortKeyItem {
  id: number
  name: string
  isAsc: boolean
  order: number
}

export type TableStateRow = {
  name: string
  bytes: number
}

export interface Rule {
  id: string
  rule_number: string
  parent_number: string | null
  level: number
  is_heading: boolean | null
  text_en: string | null
  text_zh: string | null
  sort_order: number
  rules_book: string
  updated_at: string
}

export interface RuleInsert {
  id?: string
  rule_number: string
  parent_number?: string | null
  level: number
  is_heading?: boolean | null
  text_en?: string | null
  text_zh?: string | null
  sort_order: number
  rules_book?: string
  updated_at: string
}

export interface RuleUpdate {
  id?: string
  rule_number?: string
  parent_number?: string | null
  level?: number
  is_heading?: boolean | null
  text_en?: string | null
  text_zh?: string | null
  sort_order?: number
  rules_book?: string
  updated_at: string
}

export interface RuleBooks {
  name: string
  updated_at: string
}

export interface TreeNode extends Rule {
  children: TreeNode[]
}

// ==================== 对局记录 ====================

export type MatchWinType = 'normal' | 'concede' | 'special'

// 一场对局（可能包含多场小局，如 BO3）
export interface MatchRecord {
  id: string
  deck_id: string
  group_name: string | null
  opponent_name: string | null
  opponent_deck: string | null
  opp_legend_id: string | null
  opp_legend_print_id: string | null
  opp_legend_name: string | null
  opp_legend_image: string | null
  deck_version_id: string | null
  deck_version_number: number | null
  best_of: number | null
  note: string | null
  played_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface SqliteMatchRecord extends MatchRecord {}

// 一小局
export interface MatchGame {
  id: string
  match_id: string
  game_number: number
  my_score: number | null
  opp_score: number | null
  win_type: MatchWinType
  is_win: boolean
  is_first: boolean | null
  win_reason: string | null
  log: string | null
  created_at: string | null
}

export interface SqliteMatchGame extends Omit<MatchGame, 'is_win' | 'is_first'> {
  is_win: number
  is_first: number | null
}

// 对局统计摘要
export interface MatchSummary {
  deck_id: string
  matches: number
  games: number
  wins: number
  losses: number
  draws: number
  first_games: number
  first_wins: number
  second_games: number
  second_wins: number
}

// 单场对局（含小局）聚合
export interface MatchWithGames extends MatchRecord {
  games: MatchGame[]
}

// 创建对局输入
export interface MatchInput {
  deck_id: string
  group_name?: string | null
  opponent_name?: string | null
  opponent_deck?: string | null
  opp_legend_id?: string | null
  opp_legend_print_id?: string | null
  opp_legend_name?: string | null
  opp_legend_image?: string | null
  deck_version_id?: string | null
  deck_version_number?: number | null
  best_of?: number | null
  note?: string | null
  played_at?: string | null
}

// 创建小局输入
export interface MatchGameInput {
  game_number: number
  my_score: number | null
  opp_score: number | null
  win_type: MatchWinType
  is_win: boolean
  is_first: boolean | null
  win_reason?: string | null
  log?: string | null
}
