/**
 * 数据库模块统一导出
 */

// ==================== 类型定义 ====================
export type {
  CardBase,
  CardPrint,
  AppVersion,
  SqliteCardBase,
  SqliteCardPrint,
  CardSearchResult,
  FilterOptions,
  CardSearchParams,
  FilterStatus,
  NumberRange,
  ArrayFilterParam,
  ActiveFilter,
  FilterMode,
  FilterType,
  ArrayFieldKey,
  SortKeyItem,
  Deck,
  CardWithPrint,
  DeckCard,
  SqliteDeck,
  MatchRecord,
  MatchGame,
  SqliteMatchGame,
  MatchSummary,
  MatchWithGames,
  MatchInput,
  MatchGameInput,
  MatchWinType,
} from './types'

// ==================== 配置 ====================
export { DB_NAME, TABLES, DEFAULT_PAGE_SIZE, DEFAULT_PAGE } from './config/constants'
export { TABLE_DEFINITIONS } from './config/schema'

// ==================== 环境检测 ====================
export { isTauri, isWeb } from './env'

// ==================== 仓储层 (Repository) ====================
export {
  getDatabase,
  closeDatabase,
  resetDatabaseInstance,
  getTableState,
  resetDatabase,
} from './repository/database'
export {
  saveCard,
  saveCards,
  getCardById,
  getCardByPrintId,
  getCardCount,
  deleteCard,
  clearAllCards,
  getLatestUpdateCardTime,
} from './repository/card-repository'
export {
  saveCardPrint,
  saveCardPrints,
  getPrintsByCardId,
  getPrintCount,
  deletePrint,
  deletePrintsByCardId,
  clearAllPrints,
  getPrints,
} from './repository/print-repository'

export {
  getRulesByDocName,
  getDocs,
  saveRules,
  clearRules,
  saveRule,
} from './repository/rules-repository'

export {
  getIcon,
  getIcons,
  saveIcons,
  clearIcons,
  clearIconCache,
} from './repository/icon-repository'

export {
  saveFilterOptions,
  getFilterOptions,
  clearFilterOptions,
} from './repository/filter-repository'
export { getVersion, saveVersion, clearVersion } from './repository/version-repository'
export { getTableCounts, getTableSizes } from './repository/stats'
export { clearCardData } from './repository/maintenance'
export * from './repository/deck-repository'
export {
  createMatch,
  updateMatch,
  getMatchById,
  getMatchesByDeck,
  deleteMatch,
  getDeckMatchStats,
  getMatchStatsForDecks,
  getMatchGroups,
} from './repository/match-record-repository'
// ==================== 服务层 (Service) ====================
export { searchCards } from './service/search-service'
export { initializeDatabase } from './service/sync-service'
export { updateFilterOptions } from './service/filter-service'
export { fetchLatestVersion, fetchAllCards, fetchAllPrints } from './service/remote-api'

// ==================== 工具函数 ====================
export {
  mapRowToCard,
  mapRowToPrint,
  mapRowToDeck,
  mapRowToDeckCard,
  toSqliteModel,
  toSqliteDeck,
  toSqliteDeckCard,
  serializeTags,
  parseTags,
  getBestPrint,
  buildSearchParams,
  buildOrderBy,
  formatBytes,
} from './helper'

// ==================== 排序常量 ====================
export { SORT_FIELD_MAP, SORT_FIELD_LIST } from './constants'
