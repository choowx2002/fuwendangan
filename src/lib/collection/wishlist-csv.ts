/**
 * 心愿单 CSV 导出 / 导入
 * 表头稳定中文，导入按 card_no_extend × 语言 × 工艺 唯一键 upsert。
 */

import {
  buildCsv,
  buildColumnMap,
  looksLikeHeader,
  parseCsvRows,
  parseIntCell,
  type CsvHeaderAliases,
} from '$lib/csv/csv-utils'
import type { WishlistFinish, WishlistStatus } from '$lib/db'

/** 心愿单 CSV 表头（稳定中文） */
export const WISHLIST_CSV_HEADERS = [
  '编号',
  '卡名',
  '语言',
  '工艺',
  '数量',
  '优先级',
  '备注',
  '状态',
] as const

const WISHLIST_ALIASES: CsvHeaderAliases = {
  card_no_extend: ['编号', '卡号'],
  card_name: ['卡名', '卡牌'],
  language: ['语言'],
  finish: ['工艺', '版本', 'finish'],
  qty_wanted: ['数量', '需求数量', 'wanted'],
  priority: ['优先级', 'priority'],
  note: ['备注', 'note'],
  status: ['状态', 'status'],
}

export interface WishlistCsvRow {
  cardNoExtend: string
  cardNameCn: string | null
  languageCode: string
  finish: WishlistFinish
  qtyWanted: number
  priority: number
  status: WishlistStatus
  note: string | null
}

export interface WishlistCsvResult {
  rows: WishlistImportRow[]
  errors: { line: number; reason: string }[]
}

export interface WishlistImportRow {
  cardNoExtend: string
  languageCode: string
  finish: WishlistFinish
  qtyWanted: number
  priority: number
  status: WishlistStatus
  note: string | null
}

/** 生成心愿单 CSV */
export function buildWishlistCsv(rows: WishlistCsvRow[]): string {
  const body = rows.map((item) => [
    item.cardNoExtend,
    item.cardNameCn,
    item.languageCode,
    item.finish,
    item.qtyWanted,
    item.priority,
    item.note,
    item.status,
  ])
  return buildCsv([...WISHLIST_CSV_HEADERS], body)
}

/** 生成心愿单导入模板（表头 + 一行示例） */
export function buildWishlistCsvTemplate(): string {
  return buildCsv(
    [...WISHLIST_CSV_HEADERS],
    [['ABC-001', '示例卡牌', 'SC', 'normal', 1, 3, '备选', 'active']]
  )
}

const KNOWN_FINISH: readonly string[] = ['any', 'normal', 'foil']
const KNOWN_STATUS: readonly string[] = ['active', 'acquired', 'archived']

/**
 * 解析心愿单 CSV。
 * 编号必填；语言默认 '*'；工艺默认 any；数量默认 1（须 >=1）；优先级默认 3（1-5）；状态默认 active。
 */
export function parseWishlistCsv(content: string): WishlistCsvResult {
  const rows: WishlistImportRow[] = []
  const errors: WishlistCsvResult['errors'] = []

  const parsed = parseCsvRows(content)
  if (parsed.length === 0) return { rows, errors }

  const first = parsed[0]
  const isHeader = looksLikeHeader(first.cells)
  const columns = isHeader ? buildColumnMap(first.cells, WISHLIST_ALIASES) : {}
  const noIdx = columns['card_no_extend'] ?? -1
  const langIdx = columns['language']
  const finishIdx = columns['finish']
  const qtyIdx = columns['qty_wanted']
  const priorityIdx = columns['priority']
  const noteIdx = columns['note']
  const statusIdx = columns['status']
  const start = isHeader ? 1 : 0

  for (let i = start; i < parsed.length; i++) {
    const { cells, line } = parsed[i]
    const no = noIdx >= 0 ? (cells[noIdx]?.trim() ?? '') : ''
    if (!no) {
      errors.push({ line, reason: '缺少编号' })
      continue
    }

    const rawFinish = finishIdx !== undefined ? cells[finishIdx]?.trim() || 'any' : 'any'
    if (!KNOWN_FINISH.includes(rawFinish)) {
      errors.push({ line, reason: `无效的工艺：${rawFinish}` })
      continue
    }

    const rawStatus = statusIdx !== undefined ? cells[statusIdx]?.trim() || 'active' : 'active'
    if (!KNOWN_STATUS.includes(rawStatus)) {
      errors.push({ line, reason: `无效的状态：${rawStatus}` })
      continue
    }

    const qty = parseIntCell(qtyIdx !== undefined ? cells[qtyIdx] : undefined) ?? 1
    if (qty < 1) {
      errors.push({ line, reason: '数量必须 ≥ 1' })
      continue
    }
    const priorityRaw = parseIntCell(priorityIdx !== undefined ? cells[priorityIdx] : undefined)
    const priority = priorityRaw === null ? 3 : Math.min(5, Math.max(1, priorityRaw))

    rows.push({
      cardNoExtend: no,
      languageCode: langIdx !== undefined ? cells[langIdx]?.trim() || '*' : '*',
      finish: rawFinish as WishlistFinish,
      qtyWanted: qty,
      priority,
      status: rawStatus as WishlistStatus,
      note: noteIdx !== undefined ? cells[noteIdx]?.trim() || null : null,
    })
  }

  return { rows, errors }
}
