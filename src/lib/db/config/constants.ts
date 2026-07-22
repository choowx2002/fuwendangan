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
  DECK_CARDS: 'deck_cards',
  RULES: 'rules',
} as const

export const TABLE_LIST = Object.values(TABLES) as readonly string[]

export const DEFAULT_PAGE_SIZE = 36
export const DEFAULT_PAGE = 1
