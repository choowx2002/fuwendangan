/**
 * 缺卡清单 CSV 导入
 * 解析导出的 CSV（含 BOM、RFC4180 引号/逗号/换行转义），按表头列名定位
 * 编号 / 语言 / 拥有数，供收藏数量回导。
 */

/** 缺卡清单 CSV 解析结果：一行一个印刷卡牌（编号/语言/拥有数） */
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

/** 把一行的每个 CSV 单元格转成数组 */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuote = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

/**
 * 解析缺卡清单 CSV 文本。
 * 支持列位置不固定的表头定位（编号 / 语言 / 拥有数 / 需求量）；
 * 无表头时退化为「编号,拥有,需求量」或「编号,拥有」。
 */
export function parseMissingListCsv(content: string): MissingListCsvResult {
  const rows: MissingListCsvRow[] = []
  const errors: MissingListCsvResult['errors'] = []

  const raw = content.replace(/^\uFEFF/, '')
  const lines = raw.split(/\r\n|\r|\n/)
  if (lines.length === 0) return { rows, errors }

  const first = parseCsvLine(lines[0])
  const isHeader = first.some((c) => /编号|卡名|语言|拥有|需求|稀有度/.test(c))

  let colNo = -1
  let colLang = -1
  let colQty = -1
  let start = 0

  if (isHeader) {
    first.forEach((h, i) => {
      const t = h.trim()
      if (t === '编号') colNo = i
      if (t === '语言') colLang = i
      if (t === '拥有数' || t === '拥有量') colQty = i
    })
    start = 1
  } else {
    colNo = 0
    colQty = 1
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
    const qty = parseInt(qtyRaw, 10)
    if (!Number.isFinite(qty) || qty < 0) {
      errors.push({ line: l + 1, reason: `无效的拥有数：${qtyRaw}` })
      continue
    }
    const language = colLang >= 0 ? cells[colLang]?.trim() || 'SC' : 'SC'
    rows.push({ cardNoExtend: no, language, ownedQty: qty, raw: cells })
  }

  return { rows, errors }
}
