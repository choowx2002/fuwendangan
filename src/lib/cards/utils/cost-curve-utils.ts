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
