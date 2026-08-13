/**
 * 借出/借入记录仓储层
 * 一笔 loan 一行（同卡可有多笔并发借出）；direction='out' 我借出，direction='in' 我借入。
 * 可用数量计算中 status IN ('active','overdue') 视为生效中：
 *   available = owned - 生效借出 + 生效借入
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import { get } from 'svelte/store'
import type { CardLoan, LoanDirection, LoanStatus, WishlistFinish } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { addTombstone } from './sync-repository'
import { defaultLanguage } from '$lib/stores/settings'

const now = () => new Date().toISOString()

export interface LoanInput {
  direction: LoanDirection
  contactId?: string | null
  cardNo: string
  cardNoExtend: string
  /** 语言码，缺省用设置中的默认语言 */
  languageCode?: string
  /** 'any' 表示不限普卡/闪卡 */
  finish?: WishlistFinish
  qty: number
  loanedAt: string
  dueAt?: string | null
  note?: string | null
}

export interface LoanFilter {
  direction?: LoanDirection
  status?: LoanStatus
  cardNo?: string
  cardNoExtend?: string
}

/** 借还记录 + 卡名 + 代表卡图（列表展示用；卡被删除时 card_name_cn 为 NULL） */
export type CardLoanWithName = CardLoan & {
  card_name_cn: string | null
  img_cdn: string | null
  img_lang: string | null
}

function mapLoanRow(r: any): CardLoan {
  return {
    id: r.id,
    direction: r.direction as LoanDirection,
    contact_id: r.contact_id ?? null,
    card_no: r.card_no,
    card_no_extend: r.card_no_extend,
    language_code: r.language_code ?? get(defaultLanguage),
    finish: (r.finish ?? 'any') as WishlistFinish,
    qty: r.qty ?? 0,
    loaned_at: r.loaned_at,
    due_at: r.due_at ?? null,
    returned_at: r.returned_at ?? null,
    status: r.status as LoanStatus,
    note: r.note ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

/**
 * 生效中借出/借入按卡聚合（status IN ('active','overdue')）。
 * @param keys mode='print' 时为 'card_no|card_no_extend' 列表；mode='card' 时为 card_no 列表
 */
export async function getActiveLoanQty(
  keys: string[],
  mode: 'card' | 'print'
): Promise<Map<string, { loanedOut: number; borrowedIn: number }>> {
  const db = await getDatabase()
  const map = new Map<string, { loanedOut: number; borrowedIn: number }>()
  if (keys.length === 0) return map

  let conds: string
  let params: any[]
  let groupBy: string
  if (mode === 'print') {
    conds = keys.map(() => '(card_no = ? AND card_no_extend = ?)').join(' OR ')
    params = keys.flatMap((k) => k.split('|'))
    groupBy = 'card_no, card_no_extend'
  } else {
    conds = `card_no IN (${keys.map(() => '?').join(',')})`
    params = keys
    groupBy = 'card_no'
  }

  const rows = await db.select<any[]>(
    `SELECT card_no, card_no_extend,
       SUM(CASE WHEN direction = 'out' AND status IN ('active','overdue') THEN qty ELSE 0 END) AS loaned_out,
       SUM(CASE WHEN direction = 'in' AND status IN ('active','overdue') THEN qty ELSE 0 END) AS borrowed_in
     FROM ${TABLES.CARD_LOANS}
     WHERE ${conds}
     GROUP BY ${groupBy}`,
    params
  )
  for (const r of rows) {
    const key = mode === 'print' ? `${r.card_no}|${r.card_no_extend}` : r.card_no
    map.set(key, { loanedOut: r.loaned_out ?? 0, borrowedIn: r.borrowed_in ?? 0 })
  }
  return map
}

/**
 * 借还记录列表（可选方向/状态/卡牌过滤，按借出时间倒序，携带卡名）。
 * 查询前先把「过期未还」的 active 记录落库为 overdue（不参与计数的语义差，仅展示准确）。
 */
export async function getLoans(filter?: LoanFilter): Promise<CardLoanWithName[]> {
  const db = await getDatabase()
  await markOverdueLoans()

  const conds: string[] = []
  const params: any[] = []
  if (filter?.direction) {
    conds.push('l.direction = ?')
    params.push(filter.direction)
  }
  if (filter?.status) {
    conds.push('l.status = ?')
    params.push(filter.status)
  }
  if (filter?.cardNo) {
    conds.push('l.card_no = ?')
    params.push(filter.cardNo)
  }
  if (filter?.cardNoExtend) {
    conds.push('l.card_no_extend = ?')
    params.push(filter.cardNoExtend)
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''

  const rows = await db.select<any[]>(
    `SELECT l.id, l.direction, l.contact_id, l.card_no, l.card_no_extend, l.language_code,
       l.finish, l.qty, l.loaned_at, l.due_at, l.returned_at, l.status, l.note,
       l.created_at, l.updated_at, cb.card_name_cn AS card_name_cn,
       rep.img_cdn AS img_cdn, rep.language AS img_lang
     FROM ${TABLES.CARD_LOANS} l
     LEFT JOIN ${TABLES.CARDS_BASE} cb ON cb.card_no = l.card_no
     LEFT JOIN (
       SELECT card_id, card_no_extend, img_cdn, language,
         ROW_NUMBER() OVER (
           PARTITION BY card_id, card_no_extend
           ORDER BY CASE WHEN COALESCE(is_promo, 0) = 1 THEN 1 ELSE 0 END,
                    CASE WHEN language = 'SC' THEN 0 WHEN COALESCE(is_default, 0) = 1 THEN 1 ELSE 2 END,
                    COALESCE(print_order, 0)
         ) AS rn
       FROM ${TABLES.CARD_PRINTS}
     ) rep ON rep.card_id = cb.id AND rep.card_no_extend = l.card_no_extend AND rep.rn = 1
     ${where}
     ORDER BY l.loaned_at DESC`,
    params
  )
  return rows.map((r) => ({
    ...mapLoanRow(r),
    card_name_cn: r.card_name_cn ?? null,
    img_cdn: r.img_cdn ?? null,
    img_lang: r.img_lang ?? null,
  }))
}

/** 单笔借还记录 */
export async function getLoan(id: string): Promise<CardLoan | null> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT id, direction, contact_id, card_no, card_no_extend, language_code, finish,
       qty, loaned_at, due_at, returned_at, status, note, created_at, updated_at
     FROM ${TABLES.CARD_LOANS} WHERE id = ?`,
    [id]
  )
  return rows[0] ? mapLoanRow(rows[0]) : null
}

/** 创建借出/借入记录，返回 id */
export async function createLoan(input: LoanInput): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const t = now()
  await db.execute(
    `INSERT INTO ${TABLES.CARD_LOANS}
     (id, direction, contact_id, card_no, card_no_extend, language_code, finish,
      qty, loaned_at, due_at, returned_at, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?)`,
    [
      id,
      input.direction,
      input.contactId ?? null,
      input.cardNo,
      input.cardNoExtend,
      input.languageCode ?? get(defaultLanguage),
      input.finish ?? 'any',
      input.qty,
      input.loanedAt,
      input.dueAt ?? null,
      input.note ?? null,
      t,
      t,
    ]
  )
  return id
}

/** 更新借还记录（传入的字段才修改；状态变更时自动维护 returned_at） */
export async function updateLoan(
  id: string,
  patch: {
    contactId?: string | null
    qty?: number
    languageCode?: string
    finish?: WishlistFinish
    loanedAt?: string
    dueAt?: string | null
    status?: LoanStatus
    note?: string | null
  }
): Promise<void> {
  const db = await getDatabase()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now()]
  if (patch.contactId !== undefined) {
    sets.push('contact_id = ?')
    params.push(patch.contactId ?? null)
  }
  if (patch.qty !== undefined) {
    sets.push('qty = ?')
    params.push(patch.qty)
  }
  if (patch.languageCode !== undefined) {
    sets.push('language_code = ?')
    params.push(patch.languageCode ?? get(defaultLanguage))
  }
  if (patch.finish !== undefined) {
    sets.push('finish = ?')
    params.push(patch.finish ?? 'any')
  }
  if (patch.loanedAt !== undefined) {
    sets.push('loaned_at = ?')
    params.push(patch.loanedAt)
  }
  if (patch.dueAt !== undefined) {
    sets.push('due_at = ?')
    params.push(patch.dueAt ?? null)
  }
  if (patch.note !== undefined) {
    sets.push('note = ?')
    params.push(patch.note ?? null)
  }
  if (patch.status !== undefined) {
    sets.push('status = ?')
    params.push(patch.status)
    if (patch.status === 'returned') {
      // 标记归还：保留已有 returned_at，没有则填当前时间
      sets.push('returned_at = COALESCE(returned_at, ?)')
      params.push(now())
    } else {
      // 非 returned 状态：若旧状态是 returned（SQLite SET 表达式基于更新前行求值），清空实际归还时间
      sets.push(`returned_at = CASE WHEN status = 'returned' THEN NULL ELSE returned_at END`)
    }
  }
  params.push(id)
  await db.execute(`UPDATE ${TABLES.CARD_LOANS} SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 删除借还记录（写入同步墓碑传播删除） */
export async function deleteLoan(id: string): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.CARD_LOANS} WHERE id = ?`, [id])
  await addTombstone('loan', id)
}

/**
 * 维护：把「已到期未归还」的 active 记录置为 overdue。
 * 可用数量计算不依赖该落库（active/overdue 都生效），仅用于列表展示准确性。
 */
export async function markOverdueLoans(): Promise<void> {
  const db = await getDatabase()
  await db.execute(
    `UPDATE ${TABLES.CARD_LOANS}
     SET status = 'overdue', updated_at = ?
     WHERE status = 'active' AND due_at IS NOT NULL AND due_at < ?`,
    [now(), now()]
  )
}

/** 借还汇总（首页提醒 / 借还页汇总条用） */
export interface LoanDueSummary {
  /** 进行中（status='active'，未逾期）笔数 */
  active: number
  /** 已逾期（status='overdue'）笔数 */
  overdue: number
  /** 今天应还（due_at 落在今天，含 active/overdue）笔数 */
  dueToday: number
  /** 近 N 天应还（due_at 落在 [明天, 今天+daysAhead)）笔数 */
  dueSoon: number
}

/**
 * 计算借还汇总。
 * due_at 由表单以 `new Date('YYYY-MM-DD').toISOString()` 存储（所选日期的 UTC 零点），
 * 因此「今天」边界必须在 JS 侧按本地日期构造 ISO 后比较，勿用 SQL 本地日判断。
 * 调用前先落库 overdue，保证 overdue 计数准确。
 * @param daysAhead 「即将到期」窗口天数（不含今天），默认 3
 */
export async function getLoanDueSummary(daysAhead = 3): Promise<LoanDueSummary> {
  const db = await getDatabase()
  await markOverdueLoans()

  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  const todayISO = new Date(
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  ).toISOString()
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  const tomorrowISO = new Date(
    `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  ).toISOString()
  const soon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1 + daysAhead)
  const soonISO = new Date(
    `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`
  ).toISOString()

  const rows = await db.select<any[]>(
    `SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN due_at >= ? AND due_at < ? THEN 1 ELSE 0 END) AS due_today,
       SUM(CASE WHEN due_at >= ? AND due_at < ? THEN 1 ELSE 0 END) AS due_soon
     FROM ${TABLES.CARD_LOANS}
     WHERE status IN ('active','overdue')`,
    [todayISO, tomorrowISO, tomorrowISO, soonISO]
  )
  const r = rows[0] ?? {}
  return {
    active: r.active ?? 0,
    overdue: r.overdue ?? 0,
    dueToday: r.due_today ?? 0,
    dueSoon: r.due_soon ?? 0,
  }
}
