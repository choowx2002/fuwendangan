/**
 * 储物柜 CSV 导入导出业务服务
 * 导出：基于收藏已拥有变体生成清单（可只导未收录）；
 * 导入：解析清单，按柜名/抽屉名自动创建，覆盖写入抽屉卡牌。
 */

import {
  getDatabase,
  getLockerExportVariants,
  getLockerByName,
  createLocker,
  getSectionByName,
  createSection,
  upsertSectionCard,
  normalizePresetCode,
  isLanguageCodeValid,
  TABLES,
} from '$lib/db'
import { parseLockerCsv, buildLockerCsv, saveLockerCsv } from '$lib/locker/locker-csv'

export interface LockerImportResult {
  applied: number
  skipped: { line: number; reason: string }[]
}

export interface LockerExportResult {
  saved: boolean
  count: number
}

/** 导出储物柜清单 */
export async function exportLockerCsv(opts?: { onlyUnplaced?: boolean }): Promise<LockerExportResult> {
  const variants = await getLockerExportVariants(opts)
  const content = buildLockerCsv(
    variants.map((v) => ({
      cardNoExtend: v.card_no_extend,
      cardNameCn: v.card_name_cn,
      language: v.language,
      ownedTotal: v.owned_total,
      lockerName: v.locker_name,
      sectionName: v.section_name,
      quantity: v.quantity,
      note: v.note,
    }))
  )
  const stamp = new Date().toISOString().slice(0, 10)
  const saved = await saveLockerCsv(content, `locker-manifest-${stamp}.csv`)
  return { saved, count: variants.length }
}

/** 导入储物柜清单 */
export async function importLockerCsv(content: string): Promise<LockerImportResult> {
  const parsed = parseLockerCsv(content)
  const skipped: { line: number; reason: string }[] = [...parsed.errors]
  let applied = 0

  const cardNoCache = new Map<string, string | null>()
  const lockerCache = new Map<string, string>()
  const sectionCache = new Map<string, string>()

  for (const row of parsed.rows) {
    if (!row.lockerName || !row.sectionName) {
      skipped.push({ line: 0, reason: '未填写柜名或抽屉名' })
      continue
    }
    if (row.quantity == null) {
      skipped.push({ line: 0, reason: '缺少数量' })
      continue
    }

    // 编号 → card_no（经 card_prints 反查）
    let cardNo = cardNoCache.get(row.cardNoExtend)
    if (cardNo === undefined) {
      cardNo = await resolveCardNo(row.cardNoExtend)
      cardNoCache.set(row.cardNoExtend, cardNo)
    }
    if (!cardNo) {
      skipped.push({ line: 0, reason: `无法识别的编号：${row.cardNoExtend}` })
      continue
    }

    // 语言合法性
    const code = normalizePresetCode(row.language)
    if (!code || !(await isLanguageCodeValid(code))) {
      skipped.push({ line: 0, reason: `不支持的语言：${row.language || '空'}` })
      continue
    }

    // 柜 → 抽屉（不存在则创建）
    const lockerKey = row.lockerName
    let lockerId = lockerCache.get(lockerKey)
    if (!lockerId) {
      lockerId = (await getLockerByName(lockerKey))?.id
    }
    if (!lockerId) {
      lockerId = await createLocker({ name: lockerKey })
    }
    lockerCache.set(lockerKey, lockerId)

    const sectionKey = `${lockerId}:${row.sectionName}`
    let sectionId = sectionCache.get(sectionKey)
    if (!sectionId) {
      sectionId = (await getSectionByName(lockerId, row.sectionName))?.id
    }
    if (!sectionId) {
      sectionId = await createSection(lockerId, { name: row.sectionName })
    }
    sectionCache.set(sectionKey, sectionId)

    await upsertSectionCard(sectionId, {
      card_no: cardNo,
      card_no_extend: row.cardNoExtend,
      language: code,
      quantity: row.quantity,
      note: row.note,
    })
    applied++
  }

  return { applied, skipped }
}

/** 由 card_no_extend 反查基础卡号（多语言印刷去重） */
async function resolveCardNo(cardNoExtend: string): Promise<string | null> {
  const db = await getDatabase()
  const rows = await db.select<{ card_no: string }[]>(
    `SELECT DISTINCT cb.card_no AS card_no
     FROM ${TABLES.CARD_PRINTS} p
     JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
     WHERE p.card_no_extend = ?
     LIMIT 1`,
    [cardNoExtend]
  )
  return rows[0]?.card_no ?? null
}
