/**
 * 储物柜 CSV 导入导出
 * 以收藏（已拥有变体）为数据源生成清单，用户编辑柜名/抽屉名/数量后回导。
 * 复用统一 CSV 工具（RFC4180 转义 + BOM + 表头别名映射）。
 */

import { isTauri } from '$lib/db/env'
import { writeTextFile } from '$lib/services/db-file-service'
import {
  buildCsv,
  buildColumnMap,
  looksLikeHeader,
  parseCsvRows,
  parseIntCell,
  type CsvHeaderAliases,
} from '$lib/csv/csv-utils'

/** 导出行：一个卡牌变体（card_no_extend），放置信息可回填 */
export interface LockerCsvRow {
  cardNoExtend: string
  cardNameCn: string | null
  language: string
  ownedTotal: number
  lockerName: string | null
  sectionName: string | null
  quantity: number | null
  note: string | null
}

export interface LockerCsvParseRow {
  cardNoExtend: string
  language: string
  lockerName: string
  sectionName: string
  quantity: number | null
  note: string | null
  raw: string[]
}

export interface LockerCsvParseResult {
  rows: LockerCsvParseRow[]
  /** 被跳过的行号（第 0 行为表头）与原因 */
  errors: { line: number; reason: string }[]
}

const LOCKER_ALIASES: CsvHeaderAliases = {
  card_no_extend: ['编号', '卡号'],
  language: ['语言'],
  locker_name: ['柜名'],
  section_name: ['抽屉名'],
  quantity: ['数量'],
  note: ['备注'],
}

/** 生成储物柜清单 CSV（首行表头，编号/语言/柜名/抽屉名/数量/备注可回读） */
export function buildLockerCsv(rows: LockerCsvRow[]): string {
  const body = rows.map((item) => [
    item.cardNoExtend,
    item.cardNameCn,
    item.language,
    item.ownedTotal,
    item.lockerName,
    item.sectionName,
    item.quantity,
    item.note,
  ])
  return buildCsv(['编号', '卡名', '语言', '拥有数', '柜名', '抽屉名', '数量', '备注'], body)
}

/**
 * 解析储物柜清单 CSV 文本。
 * 支持列位置不固定的表头定位（编号/语言/柜名/抽屉名/数量/备注）；
 * 未填柜名/抽屉名的行可正常解析，由导入阶段决定是否跳过。
 */
export function parseLockerCsv(content: string): LockerCsvParseResult {
  const rows: LockerCsvParseRow[] = []
  const errors: LockerCsvParseResult['errors'] = []

  const parsed = parseCsvRows(content)
  if (parsed.length === 0) return { rows, errors }

  const first = parsed[0]
  const isHeader = looksLikeHeader(first.cells)
  const columns = isHeader ? buildColumnMap(first.cells, LOCKER_ALIASES) : {}
  const noIdx = columns['card_no_extend'] ?? -1
  const langIdx = columns['language']
  const lockerIdx = columns['locker_name']
  const sectionIdx = columns['section_name']
  const qtyIdx = columns['quantity']
  const noteIdx = columns['note']
  const start = isHeader ? 1 : 0

  for (let i = start; i < parsed.length; i++) {
    const { cells, line } = parsed[i]
    const no = noIdx >= 0 ? (cells[noIdx]?.trim() ?? '') : ''
    if (!no) {
      errors.push({ line, reason: '缺少编号' })
      continue
    }
    const qtyRaw = qtyIdx !== undefined ? (cells[qtyIdx]?.trim() ?? '') : ''
    let quantity: number | null = null
    if (qtyRaw !== '') {
      const qty = parseIntCell(qtyRaw)
      if (qty === null || qty < 1) {
        errors.push({ line, reason: `无效的数量：${qtyRaw}` })
        continue
      }
      quantity = qty
    }
    rows.push({
      cardNoExtend: no,
      language: langIdx !== undefined ? (cells[langIdx]?.trim() ?? '') : '',
      lockerName: lockerIdx !== undefined ? (cells[lockerIdx]?.trim() ?? '') : '',
      sectionName: sectionIdx !== undefined ? (cells[sectionIdx]?.trim() ?? '') : '',
      quantity,
      note: noteIdx !== undefined ? (cells[noteIdx]?.trim() ?? null) : null,
      raw: cells,
    })
  }

  return { rows, errors }
}

/** 保存储物柜清单 CSV（返回是否成功） */
export async function saveLockerCsv(content: string, defaultName: string): Promise<boolean> {
  try {
    if (isTauri) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const dest = await save({
        title: '导出储物柜清单',
        defaultPath: defaultName,
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      })
      if (!dest) return false
      await writeTextFile(dest, content)
    } else {
      const { downloadCsvInWeb } = await import('$lib/csv/csv-utils')
      downloadCsvInWeb(content, defaultName)
    }
    return true
  } catch {
    return false
  }
}
