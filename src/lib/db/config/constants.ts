/**
 * 数据库配置常量
 */

export const DB_NAME = 'sqlite:tcg_cards.db'

export const TABLES = {
  CARDS_BASE: 'cards_base',
  CARD_PRINTS: 'card_prints',
  FILTER_OPTIONS: 'filter_options',
  VERSION: 'version',
  ICONS: 'icons',
  DECKS: 'decks',
  DECK_VERSIONS: 'deck_versions',
  DECK_CARDS: 'deck_cards',
  RULES: 'rules',
  MATCH_RECORDS: 'match_records',
  MATCH_GAMES: 'match_games',
  COLLECTION: 'collection',
  COLLECTION_LANGS: 'collection_langs',
  CUSTOM_LANGUAGES: 'custom_languages',
  SERIES: 'series',
  COLLECTION_HISTORY: 'collection_history',
  COLLECTION_HISTORY_ITEMS: 'collection_history_items',
  COLLECTION_STATS_SNAPSHOTS: 'collection_stats_snapshots',
  LOCKERS: 'lockers',
  LOCKER_SECTIONS: 'locker_sections',
  LOCKER_CARDS: 'locker_cards',
} as const

export const TABLE_LIST = Object.values(TABLES) as readonly string[]

export const DEFAULT_PAGE_SIZE = 36
export const DEFAULT_PAGE = 1
