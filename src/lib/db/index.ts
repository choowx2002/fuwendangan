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
  CardWithOwned,
  VariantWithOwned,
  CardVariantSearchParams,
  CardVariantSearchResult,
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
  CollectionEntry,
  CollectionLang,
  CustomLanguage,
  CollectionStatus,
  CompletionModeId,
  Series,
  OwnershipType,
  CollectionSortKey,
  CollectionSort,
  SeriesStats,
  CollectionStats,
  CustomPrintInput,
  OwnershipCheckRow,
  OwnershipMatchMode,
  RecentCollectionCard,
  MissingListRow,
  CollectionItem,
  CollectionHistoryOpType,
  CollectionHistoryItemAction,
  CollectionHistory,
  CollectionHistoryItem,
  CollectionHistoryQuery,
  SnapshotTrigger,
  CollectionStatsSnapshot,
} from './types'

// ==================== 配置 ====================
export { DB_NAME, TABLES, DEFAULT_PAGE_SIZE, DEFAULT_PAGE } from './config/constants'
export { TABLE_DEFINITIONS } from './config/schema'
export {
  PRESET_LANGUAGE_CODES,
  LANGUAGE_NAMES,
  normalizePresetCode,
  languageDisplayName,
} from './config/languages'
export {
  COLLECTION_STATUSES,
  resolveStatus,
  shouldKeepLangRow,
  shouldDeleteVariant,
} from './config/collection-rules'

// ==================== 环境检测 ====================
export { isTauri, isWeb } from './env'

// ==================== 仓储层 (Repository) ====================
export {
  getDatabase,
  closeDatabase,
  resetDatabaseInstance,
  resetDatabase,
} from './repository/database'
export {
  saveCard,
  saveCards,
  getCardById,
  getCardByPrintId,
  getCardAndPrintByPrintCode,
  getCardAndPrintByEnglishName,
  getCardAndPrintByCardNo,
  getCardCount,
  getTokenCards,
  deleteCard,
  clearAllCards,
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
  getRandomPackPrint,
  type PackPrintFilter,
  type PackPrint,
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
export {
  getVersion,
  getVersions,
  upsertTableVersion,
  clearVersion,
} from './repository/version-repository'
export { getDbStats } from './repository/stats'
export { clearCardData } from './repository/maintenance'
export {
  upsertLangQty,
  getVariantLangs,
  getCardCollection,
  getCollectionStats,
  setLangStatus,
  createCustomPrint,
  updateCustomPrintImg,
  updateCustomPrint,
  deleteCustomPrint,
  checkDeckOwnership,
  cleanupOrphans,
  getRecentCollectionCards,
  getMissingVariants,
  getMissingListRarityOptions,
  bulkMarkOwned,
  bulkIncrement,
  bulkDeleteCollection,
  importOwnedCounts,
  type UpsertLangQtyOptions,
  type MissingListFilter,
  type ImportOwnedRow,
  type ImportOwnedResult,
} from './repository/collection-repository'
export {
  getHistory,
  getHistoryItems,
  undoHistory,
  clearHistory,
  logCollectionHistory,
  logCollectionHistoryNote,
  type HistoryItemInput,
} from './repository/collection-history-repository'
export {
  captureCollectionSnapshot,
  getCollectionSnapshots,
} from './repository/collection-snapshot-repository'
export {
  getCustomLanguages,
  isLanguageCodeValid,
  addCustomLanguage,
  renameCustomLanguage,
  deleteCustomLanguage,
} from './repository/language-repository'
export {
  saveSeries,
  clearAllSeries,
  getAllSeries,
  clearSeriesCache,
} from './repository/series-repository'
export {
  getLockers,
  getLocker,
  createLocker,
  updateLocker,
  deleteLocker,
  getSections,
  getSection,
  createSection,
  updateSection,
  deleteSection,
  updateSectionPosition,
  clearSectionPosition,
  getSectionCards,
  addSectionCard,
  addSectionCardsBatch,
  updateSectionCard,
  removeSectionCard,
  removeSectionCardsBatch,
  getGlobalSectionCardQtys,
  getLockerDetail,
  findCardLocations,
  type Locker,
  type LockerSummary,
  type LockerSection,
  type LockerCard,
  type CardLocation,
  type LockerDetail,
} from './repository/locker-repository'
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
export { searchCards, searchCardVariants } from './service/search-service'
export { initializeDatabase } from './service/sync-service'
export { updateFilterOptions } from './service/filter-service'
export {
  COMPLETION_MODES,
  getCompletionMode,
  type CompletionMode,
} from './service/completion-modes'
export {
  fetchAllVersions,
  fetchAllCards,
  fetchAllPrints,
  fetchAllSeries,
} from './service/remote-api'

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
  printCacheName,
  gameResult,
  buildSearchParams,
  buildOrderBy,
  formatBytes,
} from './helper'

// ==================== 排序常量 ====================
export { SORT_FIELD_MAP, SORT_FIELD_LIST } from './constants'
