/**
 * 缺卡清单 CSV 导入
 * 解析导出的 CSV（含 BOM、RFC4180 引号/逗号/换行转义），按表头列名定位
 * 编号 / 语言 / 拥有数，供收藏数量回导。
 *
 * 安全约定（P0）：
 * - 语言列必须明确：空语言不再默认归为 SC，而是按错误行跳过并提示，
 *   避免“全部语言”汇总数量被误写入单一语言。
 * - 无表头的旧格式（编号,拥有数）因缺少语言列同样按错误处理。
 */

import {
  buildColumnMap,
  cellAt,
  DEFAULT_HEADER_ALIASES,
  looksLikeHeader,
  parseCsvRows,
  parseIntCell,
} from '$lib/csv/csv-utils'

/** 缺卡清单 CSV 解析结果：一行一个印刷卡牌 × 语言（编号/语言/拥有数） */
export interface MissingListCsvRow {
  cardNoExtend: string
  language: string
  ownedQty: number
  raw: string[]
}

export interface MissingListCsvResult {
  rows: MissingListCsvRow[]
  /** 被跳过的行号（第 0 行为表头）与原因 */
  errors: { line: number; reason: string }[]
}

/**
 * 解析缺卡清单 CSV 文本。
 * 支持列位置不固定的表头定位（编号 / 语言 / 拥有数）；
 * 语言列缺失或为空的行按错误跳过（不静默猜测语言归属）。
 */
export function parseMissingListCsv(content: string): MissingListCsvResult {
  const rows: MissingListCsvRow[] = []
  const errors: MissingListCsvResult['errors'] = []

  const parsed = parseCsvRows(content)
  if (parsed.length === 0) return { rows, errors }

  const first = parsed[0]
  const isHeader = looksLikeHeader(first.cells)

  let columns: Record<string, number>
  let start: number
  let noIdx: number
  let qtyIdx: number
  let langIdx: number | undefined

  if (isHeader) {
    columns = buildColumnMap(first.cells, DEFAULT_HEADER_ALIASES)
    noIdx = columns['card_no_extend'] ?? -1
    qtyIdx = columns['owned_qty'] ?? -1
    langIdx = columns['language']
    start = 1
  } else {
    // 无表头旧格式：编号,拥有数（无语言列）
    columns = {}
    noIdx = 0
    qtyIdx = 1
    langIdx = undefined
    start = 0
  }

  for (let i = start; i < parsed.length; i++) {
    const { cells, line } = parsed[i]
    const no = noIdx >= 0 ? (cells[noIdx]?.trim() ?? '') : ''
    if (!no) {
      errors.push({ line, reason: '缺少编号' })
      continue
    }
    const qtyRaw = qtyIdx >= 0 ? (cells[qtyIdx]?.trim() ?? '') : ''
    const qty = parseIntCell(qtyRaw)
    if (qty === null || qty < 0) {
      errors.push({ line, reason: `无效的拥有数：${qtyRaw}` })
      continue
    }
    const language = langIdx !== undefined ? (cellAt(columns, cells, 'language') ?? '') : ''
    if (!language) {
      errors.push({ line, reason: '缺少语言列' })
      continue
    }
    rows.push({ cardNoExtend: no, language, ownedQty: qty, raw: cells })
  }

  return { rows, errors }
}
