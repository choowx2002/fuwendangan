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
} from './types'

// ==================== 配置 ====================
export { DB_NAME, TABLES, DEFAULT_PAGE_SIZE, DEFAULT_PAGE } from './config/constants'
export { TABLE_DEFINITIONS } from './config/schema'

// ==================== 环境检测 ====================
export { isTauri, isWeb } from './env'

// ==================== 仓储层 (Repository) ====================
export { getDatabase, closeDatabase, resetDatabaseInstance } from './repository/database'
export { saveCard, saveCards, getCardById, getCardCount, deleteCard, clearAllCards } from './repository/card-repository'
export {
  saveCardPrint,
  saveCardPrints,
  getPrintsByCardId,
  getPrintCount,
  deletePrint,
  deletePrintsByCardId,
  clearAllPrints,
} from './repository/print-repository'
export { saveFilterOptions, getFilterOptions, clearFilterOptions } from './repository/filter-repository'
export { getVersion, saveVersion, clearVersion } from './repository/version-repository'

// ==================== 服务层 (Service) ====================
export { searchCards } from './service/search-service'
export { initializeDatabase } from './service/sync-service'
export { updateFilterOptions } from './service/filter-service'
export { fetchLatestVersion, fetchAllCards, fetchAllPrints } from './service/remote-api'

// ==================== 工具函数 ====================
export { mapRowToCard, mapRowToPrint, toSqliteModel, getBestPrint, buildSearchParams, buildOrderBy } from './helper'

// ==================== 排序常量 ====================
export { SORT_FIELD_MAP, SORT_FIELD_LIST } from './constants'
