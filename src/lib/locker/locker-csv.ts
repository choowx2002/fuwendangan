/**
 * 储物柜 CSV 导入导出
 * 以收藏（已拥有变体）为数据源生成清单，用户编辑柜名/抽屉名/数量后回导。
 * 复用缺卡清单的 CSV 解析（RFC4180 引号/逗号/换行转义），表头中文定位。
 */

import { isTauri } from '$lib/db/env'
import { writeTextFile } from '$lib/services/db-file-service'
import { parseCsvLine } from '$lib/collection/collection-csv'

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

/** CSV 单元格转义（引号包裹含逗号/引号/换行的字段） */
function csvCell(value: string | number | null): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 生成储物柜清单 CSV（首行表头，编号/语言/柜名/抽屉名/数量/备注可回读） */
export function buildLockerCsv(rows: LockerCsvRow[]): string {
  const lines: string[] = ['编号,卡名,语言,拥有数,柜名,抽屉名,数量,备注']
  for (const item of rows) {
    lines.push(
      [
        csvCell(item.cardNoExtend),
        csvCell(item.cardNameCn),
        csvCell(item.language),
        csvCell(item.ownedTotal),
        csvCell(item.lockerName),
        csvCell(item.sectionName),
        csvCell(item.quantity),
        csvCell(item.note),
      ].join(',')
    )
  }
  return `\uFEFF${lines.join('\n')}`
}

/**
 * 解析储物柜清单 CSV 文本。
 * 支持列位置不固定的表头定位（编号/语言/柜名/抽屉名/数量/备注）；
 * 未填柜名/抽屉名的行可正常解析，由导入阶段决定是否跳过。
 */
export function parseLockerCsv(content: string): LockerCsvParseResult {
  const rows: LockerCsvParseRow[] = []
  const errors: LockerCsvParseResult['errors'] = []

  const raw = content.replace(/^\uFEFF/, '')
  const lines = raw.split(/\r\n|\r|\n/)
  if (lines.length === 0) return { rows, errors }

  const first = parseCsvLine(lines[0])
  const isHeader = first.some((c) => /编号|柜名|抽屉|数量/.test(c))

  let colNo = -1
  let colLang = -1
  let colLocker = -1
  let colSection = -1
  let colQty = -1
  let colNote = -1
  let start = 0

  if (isHeader) {
    first.forEach((h, i) => {
      const t = h.trim()
      if (t === '编号') colNo = i
      if (t === '语言') colLang = i
      if (t === '柜名') colLocker = i
      if (t === '抽屉名') colSection = i
      if (t === '数量') colQty = i
      if (t === '备注') colNote = i
    })
    start = 1
  }

  for (let l = start; l < lines.length; l++) {
    const text = lines[l]
    if (!text.trim()) continue
    const cells = parseCsvLine(text)
    const no = colNo >= 0 ? (cells[colNo]?.trim() ?? '') : ''
    if (!no) {
      errors.push({ line: l + 1, reason: '缺少编号' })
      continue
    }
    const qtyRaw = colQty >= 0 ? (cells[colQty]?.trim() ?? '') : ''
    let quantity: number | null = null
    if (qtyRaw !== '') {
      const qty = parseInt(qtyRaw, 10)
      if (!Number.isFinite(qty) || qty < 1) {
        errors.push({ line: l + 1, reason: `无效的数量：${qtyRaw}` })
        continue
      }
      quantity = qty
    }
    rows.push({
      cardNoExtend: no,
      language: colLang >= 0 ? (cells[colLang]?.trim() ?? '') : '',
      lockerName: colLocker >= 0 ? (cells[colLocker]?.trim() ?? '') : '',
      sectionName: colSection >= 0 ? (cells[colSection]?.trim() ?? '') : '',
      quantity,
      note: colNote >= 0 ? (cells[colNote]?.trim() ?? null) : null,
      raw: cells,
    })
  }

  return { rows, errors }
}

function downloadTextInWeb(text: string, name: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
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
      downloadTextInWeb(content, defaultName)
    }
    return true
  } catch {
    return false
  }
}
