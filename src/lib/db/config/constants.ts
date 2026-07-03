/**
 * 数据库配置常量
 */

export const DB_NAME = 'sqlite:tcg_cards.db'

export const TABLES = {
  CARDS_BASE: 'cards_base',
  CARD_PRINTS: 'card_prints',
  FILTER_OPTIONS: 'filter_options',
  VERSION: 'version',
} as const

export const DEFAULT_PAGE_SIZE = 30
export const DEFAULT_PAGE = 1
