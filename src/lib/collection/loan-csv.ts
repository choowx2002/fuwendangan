/**
 * 借还记录 / 联系人 CSV 导出
 * 与收藏/心愿/清单 CSV 同一套 buildCsv 工具（RFC4180 + UTF-8 BOM），表头固定中文（不随 UI 语言切换）。
 */

import { buildCsv } from '$lib/csv/csv-utils'

/** 借还记录导出行 */
export interface LoanCsvRow {
  cardNoExtend: string
  cardName: string
  direction: string
  contact: string
  language: string
  finish: string
  qty: number
  loanedAt: string
  dueAt: string
  returnedAt: string
  status: string
  note: string
}

export const LOAN_CSV_HEADERS = [
  '编号',
  '卡名',
  '方向',
  '联系人',
  '语言',
  '工艺',
  '数量',
  '借出时间',
  '应还时间',
  '归还时间',
  '状态',
  '备注',
] as const

/** 生成借还记录 CSV */
export function buildLoansCsv(rows: LoanCsvRow[]): string {
  const body = rows.map((r) => [
    r.cardNoExtend,
    r.cardName,
    r.direction,
    r.contact,
    r.language,
    r.finish,
    r.qty,
    r.loanedAt,
    r.dueAt,
    r.returnedAt,
    r.status,
    r.note,
  ])
  return buildCsv([...LOAN_CSV_HEADERS], body)
}

/** 联系人导出行 */
export interface ContactCsvRow {
  name: string
  wechat: string
  qq: string
  phone: string
  email: string
  note: string
}

export const CONTACT_CSV_HEADERS = ['姓名', '微信', 'QQ', '电话', '邮箱', '备注'] as const

/** 生成联系人 CSV */
export function buildContactsCsv(rows: ContactCsvRow[]): string {
  const body = rows.map((r) => [r.name, r.wechat, r.qq, r.phone, r.email, r.note])
  return buildCsv([...CONTACT_CSV_HEADERS], body)
}
