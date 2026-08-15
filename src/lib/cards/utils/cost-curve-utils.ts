export type CurveMode = 'energy' | 'return_energy'

export const COLOR_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'neutral']

export const COLOR_VARS: Record<string, string> = {
  red: 'var(--card-color-red)',
  orange: 'var(--card-color-orange)',
  yellow: 'var(--card-color-yellow)',
  green: 'var(--card-color-green)',
  blue: 'var(--card-color-blue)',
  purple: 'var(--card-color-purple)',
  neutral: 'var(--card-color-neutral)',
}

export function normalizeColor(raw: string): string {
  const map: Record<string, string> = {
    red: 'red',
    红: 'red',
    红色: 'red',
    orange: 'orange',
    橙: 'orange',
    橙色: 'orange',
    yellow: 'yellow',
    黄: 'yellow',
    黄色: 'yellow',
    green: 'green',
    绿: 'green',
    绿色: 'green',
    blue: 'blue',
    蓝: 'blue',
    蓝色: 'blue',
    purple: 'purple',
    紫: 'purple',
    紫色: 'purple',
  }
  return map[raw.toLowerCase()] ?? 'neutral'
}

export function parseColorList(raw: string | string[] | null | undefined): string[] {
  if (!raw) return ['neutral']
  if (Array.isArray(raw)) {
    const colors = raw.map((c) => normalizeColor(String(c).trim())).filter(Boolean)
    return colors.length > 0 ? colors : ['neutral']
  }

  let str = raw.trim()
  if (!str) return ['neutral']

  if (str.startsWith('[')) {
    try {
      const arr = JSON.parse(str.replace(/'/g, '"'))
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((c) => normalizeColor(String(c).trim()))
      }
    } catch {
      // fall through to split
    }
  }

  const parts = str
    .split(/[,，、|;]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.map(normalizeColor) : ['neutral']
}

export function fmt(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

export interface CostStatCard {
  quantity: number
  energy: number | null
  return_energy: number | null
  card_color_list: string | string[] | null
  card_category?: string | string[] | null
}

export interface CostCurvePoint {
  value: number
  total: number
  colors: Record<string, number>
}

export function computeCostCurve(cards: CostStatCard[], mode: CurveMode): CostCurvePoint[] {
  const buckets: Record<number, Record<string, number>> = {}

  cards.forEach((c) => {
    const value = mode === 'energy' ? (c.energy ?? 0) : (c.return_energy ?? 0)
    if (!buckets[value]) buckets[value] = {}

    const colors = parseColorList(c.card_color_list)
    const share = c.quantity / colors.length

    colors.forEach((color) => {
      buckets[value][color] = (buckets[value][color] || 0) + share
    })
  })

  return Object.entries(buckets)
    .map(([key, colors]) => ({
      value: Number(key),
      total: Object.values(colors).reduce((s, n) => s + n, 0),
      colors,
    }))
    .sort((a, b) => a.value - b.value)
}

export function computeColorTotals(cards: CostStatCard[]): Record<string, number> {
  const totals: Record<string, number> = {}

  cards.forEach((c) => {
    const colors = parseColorList(c.card_color_list)
    const share = c.quantity / colors.length
    colors.forEach((color) => {
      totals[color] = (totals[color] || 0) + share
    })
  })

  return totals
}

/** 卡牌类型分组（费用 × 类型 chips 用）；双类别卡按「包含计数」同时计入多个分组 */
export type TypeGroupKey = 'unit' | 'spell' | 'equipment'

export const TYPE_GROUPS: ReadonlyArray<{ key: TypeGroupKey; labels: readonly string[] }> = [
  { key: 'unit', labels: ['单位', '英雄单位', '专属单位'] },
  { key: 'spell', labels: ['法术', '专属法术'] },
  { key: 'equipment', labels: ['装备', '专属装备'] },
]

export type TypeCounts = Record<TypeGroupKey, number>

/** 解析 card_category（SQLite 中为 JSON 字符串，CardBase 中为数组） */
export function parseCategoryList(raw: string | string[] | null | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  const str = raw.trim()
  if (!str) return []
  if (str.startsWith('[')) {
    try {
      const arr = JSON.parse(str.replace(/'/g, '"'))
      if (Array.isArray(arr)) return arr.map(String)
    } catch {
      // fall through to split
    }
  }
  return str
    .split(/[,，、|;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 每个费用桶的三系卡牌数量（按 quantity 加权；「包含计数」：
 * 双类别卡同时计入其所属的所有分组，三系合计可能大于柱子总数）。
 */
export function computeTypeCounts(cards: CostStatCard[], mode: CurveMode): Map<number, TypeCounts> {
  const buckets = new Map<number, TypeCounts>()

  for (const c of cards) {
    const value = mode === 'energy' ? (c.energy ?? 0) : (c.return_energy ?? 0)
    const categories = parseCategoryList(c.card_category)
    if (categories.length === 0) continue
    const row = buckets.get(value) ?? { unit: 0, spell: 0, equipment: 0 }
    for (const group of TYPE_GROUPS) {
      if (categories.some((cat) => group.labels.includes(cat))) {
        row[group.key] += c.quantity
      }
    }
    buckets.set(value, row)
  }

  return buckets
}
