/**
 * 完整收藏 CSV 导出 / 导入
 * 以 card_no_extend × language 为粒度（一行 = 一个印刷 × 一种语言），
 * 包含普通数量 / 闪卡数量 / 状态，可完整迁移与备份（foil 不丢失）。
 */

import {
  buildCsv,
  buildColumnMap,
  looksLikeHeader,
  parseCsvRows,
  parseIntCell,
  type CsvHeaderAliases,
} from '$lib/csv/csv-utils'
import type { CollectionStatus } from '$lib/db'

/** 完整收藏 CSV 表头（稳定中文，不随 UI 语言切换） */
export const FULL_COLLECTION_CSV_HEADERS = [
  '编号',
  '卡名',
  '语言',
  '普通数量',
  '闪卡数量',
  '状态',
] as const

const FULL_COLLECTION_ALIASES: CsvHeaderAliases = {
  card_no_extend: ['编号', '卡号'],
  card_name: ['卡名', '卡牌'],
  language: ['语言'],
  normal_qty: ['普通数量', '普卡数量', '普卡'],
  foil_qty: ['闪卡数量', '闪卡'],
  status: ['状态'],
}

/** 完整收藏导出行：一个印刷 × 语言 */
export interface FullCollectionCsvRow {
  cardNoExtend: string
  cardNameCn: string | null
  language: string
  normalQty: number
  foilQty: number
  status: CollectionStatus
}

/** 完整收藏解析行（导入用） */
export interface FullCollectionImportRow {
  cardNoExtend: string
  language: string
  normalQty: number
  foilQty: number
  status?: CollectionStatus
}

export interface FullCollectionCsvResult {
  rows: FullCollectionImportRow[]
  errors: { line: number; reason: string }[]
}

/** 生成完整收藏 CSV */
export function buildFullCollectionCsv(rows: FullCollectionCsvRow[]): string {
  const body = rows.map((item) => [
    item.cardNoExtend,
    item.cardNameCn,
    item.language,
    item.normalQty,
    item.foilQty,
    item.status,
  ])
  return buildCsv([...FULL_COLLECTION_CSV_HEADERS], body)
}

/** 生成完整收藏导入模板（表头 + 一行示例） */
export function buildFullCollectionCsvTemplate(): string {
  return buildCsv([...FULL_COLLECTION_CSV_HEADERS], [['ABC-001', '示例卡牌', 'SC', 1, 0, 'owned']])
}

const KNOWN_STATUS: readonly CollectionStatus[] = ['owned', 'wishlist', 'ordered']

/**
 * 解析完整收藏 CSV。
 * 编号 / 语言 必填；数量默认 0；状态默认 owned。
 */
export function parseFullCollectionCsv(content: string): FullCollectionCsvResult {
  const rows: FullCollectionImportRow[] = []
  const errors: FullCollectionCsvResult['errors'] = []

  const parsed = parseCsvRows(content)
  if (parsed.length === 0) return { rows, errors }

  const first = parsed[0]
  const isHeader = looksLikeHeader(first.cells)
  const columns = isHeader ? buildColumnMap(first.cells, FULL_COLLECTION_ALIASES) : {}
  const noIdx = columns['card_no_extend'] ?? -1
  const langIdx = columns['language']
  const normalIdx = columns['normal_qty']
  const foilIdx = columns['foil_qty']
  const statusIdx = columns['status']
  const start = isHeader ? 1 : 0

  for (let i = start; i < parsed.length; i++) {
    const { cells, line } = parsed[i]
    const no = noIdx >= 0 ? (cells[noIdx]?.trim() ?? '') : ''
    if (!no) {
      errors.push({ line, reason: '缺少编号' })
      continue
    }
    const language = langIdx !== undefined ? (cells[langIdx]?.trim() ?? '') : ''
    if (!language) {
      errors.push({ line, reason: '缺少语言列' })
      continue
    }
    const normal = parseIntCell(normalIdx !== undefined ? cells[normalIdx] : undefined) ?? 0
    const foil = parseIntCell(foilIdx !== undefined ? cells[foilIdx] : undefined) ?? 0
    if (normal < 0 || foil < 0) {
      errors.push({ line, reason: '数量不能为负数' })
      continue
    }
    const rawStatus = statusIdx !== undefined ? (cells[statusIdx]?.trim() ?? '') : ''
    let status: CollectionStatus | undefined
    if (rawStatus) {
      if ((KNOWN_STATUS as readonly string[]).includes(rawStatus)) {
        status = rawStatus as CollectionStatus
      } else {
        errors.push({ line, reason: `无效的状态：${rawStatus}` })
        continue
      }
    }

    rows.push({ cardNoExtend: no, language, normalQty: normal, foilQty: foil, status })
  }

  return { rows, errors }
}
