/**
 * 购买清单 CSV 导出
 * 与缺卡清单 CSV 保持同一 entity（列结构一致）：编号/卡名/稀有度/语言/拥有数/需求量。
 * 表头固定为稳定中文（不随 UI 语言切换）。
 */

import { buildCsv } from '$lib/csv/csv-utils'

/** 购买清单 CSV 表头（与缺卡清单一致） */
export const PURCHASE_LIST_CSV_HEADERS = [
  '编号',
  '卡名',
  '稀有度',
  '语言',
  '拥有数',
  '需求量',
] as const

/** 购买清单导出行（entity 与缺卡清单一致） */
export interface PurchaseListCsvRow {
  cardNoExtend: string
  cardNameCn: string
  rarity: string | null
  /** 语言偏好（'*' 表示任意） */
  language: string
  /** 拥有数 = 已有 + 已借入（own + borrowed） */
  ownedQty: number
  /** 需求量 = 卡组需求数量 */
  needed: number
}

/** 生成购买清单 CSV */
export function buildPurchaseListCsv(rows: PurchaseListCsvRow[]): string {
  const body = rows.map((item) => [
    item.cardNoExtend,
    item.cardNameCn,
    item.rarity,
    item.language,
    item.ownedQty,
    item.needed,
  ])
  return buildCsv([...PURCHASE_LIST_CSV_HEADERS], body)
}
