/**
 * 图标信息仓储层
 */

import type { RuleUpdate, RuleInsert, Rule, RuleBooks } from '../types'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'

export async function getRulesByDocName(name: string): Promise<Rule[]> {
  const db = await getDatabase()
  const results = await db.select<Rule[]>(
    `SELECT * FROM ${TABLES.RULES}  WHERE rules_book = ? ORDER BY sort_order ASC`,
    [name]
  )

  return results.length > 0 ? results : []
}

export async function getDocs(): Promise<RuleBooks[]> {
  const db = await getDatabase()
  const results = await db.select<RuleBooks[]>(`SELECT
      rules_book as name,
      MAX(updated_at) AS updated_at
  FROM
      ${TABLES.RULES}
  GROUP BY
      rules_book; `)

  console.log("res", results);
  return results.length > 0 ? results : []
}

export async function saveRule(rule: RuleUpdate): Promise<void> {
  const db = await getDatabase()
  const isHeader = rule.is_heading === null ? null : rule.is_heading ? 1 : 0
  await db.execute(
    `INSERT OR REPLACE INTO ${TABLES.RULES} (
      id, rule_number, parent_number, level, is_heading,
      text_en, text_zh, sort_order, rules_book, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      rule.id,
      rule.rule_number,
      rule.parent_number,
      rule.level,
      isHeader,
      rule.text_en,
      rule.text_zh,
      rule.sort_order,
      rule.rules_book,
      rule.updated_at,
    ]
  )
}

/**
 * 批量保存或更新信息 (全量同步时常用)
 */
export async function saveRules(rules: RuleUpdate[]): Promise<void> {
  for (const rule of rules) {
    await saveRule(rule)
  }
}

/**
 * 清空所有信息
 */
export async function clearRules(): Promise<void> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.RULES}`)
}
