/**
 * 统一 CSV 工具
 * 全项目 CSV 导出/导入共用：转义、构建、解析、表头别名映射、Web 下载。
 * - 导出默认 UTF-8 with BOM（Excel 中文友好）
 * - 导入兼容并移除 BOM
 * - 换行：导出默认 \n，导入兼容 \r\n / \r / \n
 * - 转义：RFC4180，覆盖双引号 / 逗号 / 换行 / 回车
 *
 * 约定：CSV 表头使用稳定中文名（不随 UI 语言切换），导入端通过别名映射定位列。
 */

/** 表头别名映射：规范字段名 -> 别名列表（不区分大小写，匹配时会 trim） */
export type CsvHeaderAliases = Record<string, string[]>

/** 全项目共享的表头别名（各模块可自行扩展） */
export const DEFAULT_HEADER_ALIASES: CsvHeaderAliases = {
  card_no_extend: ['编号', '卡号'],
  card_name: ['卡名', '卡牌'],
  language: ['语言'],
  owned_qty: ['拥有数', '拥有量', '已有'],
  needed: ['需求量', '需要', '需求'],
  normal_qty: ['普通数量', '普卡数量', '普卡'],
  foil_qty: ['闪卡数量', '闪卡'],
  status: ['状态'],
  rarity: ['稀有度'],
  note: ['备注'],
  finish: ['工艺', '版本'],
  priority: ['优先级'],
  qty_ordered: ['已下单', '下单'],
  qty_borrowed: ['已借入', '借入'],
  qty_bought: ['已购买', '购买'],
  qty_to_buy: ['待购买', '还需'],
  quantity: ['数量'],
}

/** 表头探测关键词（用于判断第一行是否为表头） */
const HEADER_HINT =
  /编号|卡名|卡牌|语言|拥有|需求|稀有度|数量|状态|备注|工艺|优先级|已下单|已借入|已购买|待购买|普卡|闪卡|柜名|抽屉/

/** CSV 单元格转义（RFC4180：含逗号/引号/换行/回车的字段用双引号包裹并双写引号） */
export function escapeCsvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 构建 CSV 文本（含 UTF-8 BOM，\n 换行） */
export function buildCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','))
  return `\uFEFF${lines.join('\n')}`
}

/** 解析一行 CSV（RFC4180：处理引号包裹的逗号/双引号/换行转义） */
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

export interface CsvRow {
  cells: string[]
  /** 原始行号（1 起始，含表头行；跳过空行但保留行号） */
  line: number
}

/**
 * 解析整段 CSV 文本：移除 BOM、兼容 \r\n / \r / \n、跳过空行。
 * 返回带原始行号的行列表，第一行为表头（调用方自行判断）。
 */
export function parseCsvRows(content: string): CsvRow[] {
  const raw = content.replace(/^\uFEFF/, '')
  const lines = raw.split(/\r\n|\r|\n/)
  const out: CsvRow[] = []
  lines.forEach((line, i) => {
    if (!line.trim()) return
    out.push({ cells: parseCsvLine(line), line: i + 1 })
  })
  return out
}

/**
 * 判断一行是否为表头（命中任一表头关键词）。
 * 用于兼容“无表头”的旧格式文件。
 */
export function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => HEADER_HINT.test(c))
}

/**
 * 构建表头别名 -> 列索引映射。
 * 返回 Record<规范字段名, 列索引>；未命中的字段不出现。同一字段取第一个匹配列。
 */
export function buildColumnMap(
  header: string[] | null,
  aliases: CsvHeaderAliases
): Record<string, number> {
  const map: Record<string, number> = {}
  if (!header) return map
  const aliasToKey = new Map<string, string>()
  for (const [key, list] of Object.entries(aliases)) {
    for (const a of list) aliasToKey.set(a.trim().toLowerCase(), key)
  }
  header.forEach((h, i) => {
    const key = aliasToKey.get(h.trim().toLowerCase())
    if (key && map[key] === undefined) map[key] = i
  })
  return map
}

/** 从一行单元格按列映射取值（未命中返回 undefined，命中返回 trim 后值） */
export function cellAt(
  columns: Record<string, number>,
  cells: string[],
  key: string
): string | undefined {
  const idx = columns[key]
  if (idx === undefined) return undefined
  return cells[idx]?.trim() ?? ''
}

/** 解析整数；空串/非法返回 fallback（默认 NaN 语义由调用方判断） */
export function parseIntCell(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

/** Web 环境浏览器下载文本文件 */
export function downloadTextInWeb(text: string, name: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Web 环境浏览器下载 CSV 文件 */
export function downloadCsvInWeb(text: string, name: string): void {
  downloadTextInWeb(text, name, 'text/csv')
}

/** 生成导入模板（仅表头；可附带示例行，示例行须与表头对齐） */
export function createCsvTemplate(
  headers: string[],
  exampleRows?: (string | number | null)[][]
): string {
  const rows = exampleRows && exampleRows.length > 0 ? exampleRows : [headers.map(() => '')]
  return buildCsv(headers, rows)
}
