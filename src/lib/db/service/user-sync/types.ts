/**
 * 玩家数据同步 Bundle 类型定义。
 * 结构对齐 docs/player-data-sync.md §6 Sync Bundle（Phase 1 收藏/卡组 + Phase 2 全实体）。
 */

export const SYNC_SCHEMA = 'rune-archive-player-sync'
export const SYNC_VERSION = 2

export type SyncEntityType =
  | 'deck'
  | 'collection'
  | 'wishlist'
  | 'loan'
  | 'contact'
  | 'purchase_list'
  | 'match'
  | 'locker'
  | 'custom_print'

/** 卡组实体：聚合头 + 全部版本 + 版本卡牌（单实体原子合并） */
export interface SyncDeckCard {
  id: string
  card_id: string
  print_code: string | null
  quantity: number
  zone: string
  created_at: string | null
}

export interface SyncDeckVersion {
  id: string
  version_number: number
  note: string | null
  created_at: string
  cards: SyncDeckCard[]
}

export interface SyncDeck {
  id: string
  name: string
  description: string | null
  format: string | null
  cover_image: string | null
  tags: string[]
  is_favorite: boolean | number
  created_at: string | null
  updated_at: string
  versions: SyncDeckVersion[]
}

/** 收藏实体：以 (card_no, card_no_extend) 变体为聚合，语言行行级 LWW */
export interface SyncCollectionLang {
  language_code: string
  normal_qty: number
  foil_qty: number
  updated_at: string
}

export interface SyncCollection {
  card_no: string
  card_no_extend: string
  updated_at: string
  langs: SyncCollectionLang[]
}

/** 心愿单（行级） */
export interface SyncWishlist {
  id: string
  card_no: string
  card_no_extend: string
  language_code: string
  finish: string
  qty_wanted: number
  priority: number
  status: string
  note: string | null
  created_at: string | null
  updated_at: string
}

/** 借还（行级） */
export interface SyncLoan {
  id: string
  direction: string
  contact_id: string | null
  card_no: string
  card_no_extend: string
  language_code: string
  finish: string
  qty: number
  loaned_at: string
  due_at: string | null
  returned_at: string | null
  status: string
  note: string | null
  purchase_item_id: string | null
  created_at: string | null
  updated_at: string
}

/** 联系人（行级） */
export interface SyncContact {
  id: string
  name: string
  note: string | null
  wechat: string | null
  qq: string | null
  phone: string | null
  email: string | null
  created_at: string | null
  updated_at: string
}

/** 购买清单（实体聚合） */
export interface SyncPurchaseListItem {
  id: string
  card_no: string
  card_no_extend: string
  collection_id: string | null
  language_pref: string
  finish_pref: string
  qty_required: number
  qty_owned: number
  qty_to_buy: number
  qty_ordered: number
  qty_borrowed: number
  qty_bought: number
  status: string
  created_at: string | null
  updated_at: string
}

export interface SyncPurchaseList {
  id: string
  name: string
  deck_id: string | null
  deck_version_id: string | null
  status: string
  created_at: string | null
  updated_at: string
  items: SyncPurchaseListItem[]
}

/** 对局（实体聚合） */
export interface SyncMatchGame {
  id: string
  game_number: number
  my_score: number | null
  opp_score: number | null
  win_type: string
  is_win: boolean | number
  is_first: boolean | number | null
  win_reason: string | null
  log: string | null
  created_at: string | null
}

export interface SyncMatch {
  id: string
  deck_id: string
  player_name: string | null
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
  updated_at: string
  games: SyncMatchGame[]
}

/** 卡柜（实体聚合） */
export interface SyncLockerCard {
  id: string
  card_no: string
  card_no_extend: string | null
  language: string | null
  quantity: number
  note: string | null
  created_at: string | null
  updated_at: string
}

export interface SyncLockerSection {
  id: string
  name: string | null
  description: string | null
  color: string | null
  icon: string | null
  tags: string[] | null
  sort_order: number
  created_at: string | null
  updated_at: string
  cards: SyncLockerCard[]
}

export interface SyncLocker {
  id: string
  name: string
  description: string | null
  is_favorite: boolean | number
  icon: string | null
  tags: string[] | null
  created_at: string | null
  updated_at: string
  sections: SyncLockerSection[]
}

/** 自定义打印：print + 引用的 CUSTOM 基础卡 成对打包 */
export interface SyncCustomPrint {
  print: {
    id: string
    card_id: string
    card_no: string | null
    card_no_extend: string
    rarity_name: string | null
    extend_rarity_name: string | null
    back_image: string | null
    language: string
    img_cdn: string | null
    tts_cdn: string | null
    artist: string | null
    print_order: number | null
    is_default: number | null
    is_promo: number | null
    is_custom: number | null
    series: string | null
    flavor_text_cn: string | null
    flavor_text_en: string | null
    created_at: string | null
    updated_at: string
  }
  baseCard: {
    id: string
    card_no: string
    created_at: string | null
    updated_at: string
    [key: string]: unknown
  }
}

/** 设置白名单（按键 LWW） */
export interface SyncSetting {
  key: string
  value: unknown
  updated_at: string
}

/** 墓碑：删除跨设备传播 */
export interface SyncTombstone {
  id: string
  entity_type: SyncEntityType
  entity_key: string
  updated_at: string
}

export interface SyncBundleEntities {
  decks: SyncDeck[]
  collection: SyncCollection[]
  wishlist: SyncWishlist[]
  loans: SyncLoan[]
  contacts: SyncContact[]
  purchaseLists: SyncPurchaseList[]
  matches: SyncMatch[]
  lockers: SyncLocker[]
  customPrints: SyncCustomPrint[]
  settings: SyncSetting[]
}

/** Bundle 数据体（不含头） */
export interface SyncBundleBody {
  entities: SyncBundleEntities
  tombstones: SyncTombstone[]
}

/** Bundle 头：schema 版本 + 设备信息 + 生成时间 + 校验和 */
export interface SyncBundleHeader {
  schema: string
  version: number
  device: { id: string; name: string }
  generatedAt: string
  checksum: string
}

export interface SyncBundle extends SyncBundleHeader, SyncBundleBody {}
