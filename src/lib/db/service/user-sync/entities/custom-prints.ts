/**
 * 自定义打印实体：print + 引用的 CUSTOM 基础卡 成对打包（key = card_prints.id），
 * LWW + 墓碑 'custom_print'。图片文件不跨设备（bundle 只同步元数据）。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import type { SyncCustomPrint, SyncTombstone } from '../types'
import { mergeById, type DbLike, type MergeResult } from './common'

const CARD_BASE_COLUMNS = [
  'id',
  'card_no',
  'card_name_cn',
  'card_name_en',
  'sub_title_cn',
  'sub_title_en',
  'card_category',
  'card_color_list',
  'region',
  'tag',
  'keyword',
  'advanced_tag',
  'champion_tag',
  'effect_cn',
  'effect_en',
  'energy',
  'return_energy',
  'power',
  'rarity_name',
  'series_name',
  'flavor_text_cn',
  'flavor_text_en',
  'is_banned',
  'deck_limit',
  'created_at',
  'updated_at',
]

const PRINT_COLUMNS = [
  'id',
  'card_id',
  'card_no',
  'card_no_extend',
  'rarity_name',
  'extend_rarity_name',
  'back_image',
  'language',
  'img_cdn',
  'tts_cdn',
  'artist',
  'print_order',
  'is_default',
  'is_promo',
  'is_custom',
  'created_at',
  'updated_at',
]

export function extractCustomPrints(): Promise<SyncCustomPrint[]> {
  return (async () => {
    const db = await getDatabase()
    const rows = (await db.select(
      `SELECT p.id AS p_id,
         p.card_id AS p_card_id, p.card_no AS p_card_no, p.card_no_extend AS p_card_no_extend,
         p.rarity_name AS p_rarity_name, p.extend_rarity_name AS p_extend_rarity_name,
         p.back_image AS p_back_image, p.language AS p_language, p.img_cdn AS p_img_cdn,
         p.tts_cdn AS p_tts_cdn, p.artist AS p_artist, p.print_order AS p_print_order,
         p.is_default AS p_is_default, p.is_promo AS p_is_promo, p.is_custom AS p_is_custom,
         p.created_at AS p_created_at, p.updated_at AS p_updated_at,
         cb.id AS cb_id, cb.card_no AS cb_card_no, cb.card_name_cn AS cb_card_name_cn,
         cb.card_name_en AS cb_card_name_en, cb.sub_title_cn AS cb_sub_title_cn,
         cb.sub_title_en AS cb_sub_title_en, cb.card_category AS cb_card_category,
         cb.card_color_list AS cb_card_color_list, cb.region AS cb_region, cb.tag AS cb_tag,
         cb.keyword AS cb_keyword, cb.advanced_tag AS cb_advanced_tag,
         cb.champion_tag AS cb_champion_tag, cb.effect_cn AS cb_effect_cn,
         cb.effect_en AS cb_effect_en, cb.energy AS cb_energy,
         cb.return_energy AS cb_return_energy, cb.power AS cb_power,
         cb.rarity_name AS cb_rarity_name, cb.series_name AS cb_series_name,
         cb.flavor_text_cn AS cb_flavor_text_cn, cb.flavor_text_en AS cb_flavor_text_en,
         cb.is_banned AS cb_is_banned, cb.deck_limit AS cb_deck_limit,
         cb.created_at AS cb_created_at, cb.updated_at AS cb_updated_at
       FROM ${TABLES.CARD_PRINTS} p
       JOIN ${TABLES.CARDS_BASE} cb ON cb.id = p.card_id
       WHERE p.is_custom = 1`
    )) as Record<string, unknown>[]

    return rows.map((r) => {
      const baseCard: Record<string, unknown> = {}
      for (const col of CARD_BASE_COLUMNS) baseCard[col] = r[`cb_${col}`] ?? null
      baseCard.updated_at =
        (r.cb_updated_at as string) ?? (r.cb_created_at as string) ?? new Date().toISOString()
      return {
        print: {
          id: String(r.p_id),
          card_id: String(r.p_card_id),
          card_no: (r.p_card_no as string) ?? null,
          card_no_extend: String(r.p_card_no_extend),
          rarity_name: (r.p_rarity_name as string) ?? null,
          extend_rarity_name: (r.p_extend_rarity_name as string) ?? null,
          back_image: (r.p_back_image as string) ?? null,
          language: String(r.p_language ?? 'SC'),
          img_cdn: (r.p_img_cdn as string) ?? null,
          tts_cdn: (r.p_tts_cdn as string) ?? null,
          artist: (r.p_artist as string) ?? null,
          print_order: (r.p_print_order as number) ?? null,
          is_default: (r.p_is_default as number) ?? null,
          is_promo: (r.p_is_promo as number) ?? null,
          is_custom: (r.p_is_custom as number) ?? 1,
          created_at: (r.p_created_at as string) ?? null,
          updated_at:
            (r.p_updated_at as string) ?? (r.p_created_at as string) ?? new Date().toISOString(),
        },
        baseCard: baseCard as SyncCustomPrint['baseCard'],
      }
    })
  })()
}

export function mergeCustomPrints(opts: {
  local: SyncCustomPrint[]
  remote: SyncCustomPrint[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncCustomPrint> {
  // 实体键为 print.id
  return mergeById({
    local: opts.local.map((c) => ({ ...c, id: c.print.id, updated_at: c.print.updated_at })),
    remote: opts.remote.map((c) => ({ ...c, id: c.print.id, updated_at: c.print.updated_at })),
    localTomb: opts.localTomb,
    remoteTomb: opts.remoteTomb,
    localDeviceId: opts.localDeviceId,
    remoteDeviceId: opts.remoteDeviceId,
    live: opts.live,
  }) as MergeResult<SyncCustomPrint>
}

/**
 * 基础卡非破坏性 upsert：返回打印应引用的 cards_base id。
 * id 已存在 → UPDATE 快照列（不动 id/card_no 身份键）；id 缺失但 card_no 冲突 → 复用现存卡；
 * 否则 INSERT。禁止 REPLACE：删行会级联删除官方打印，触发 deck_cards 外键失败。
 */
async function upsertBaseCard(db: DbLike, baseCard: SyncCustomPrint['baseCard']): Promise<string> {
  const { id, card_no } = baseCard
  const exists = (await db.select(`SELECT id FROM ${TABLES.CARDS_BASE} WHERE id = ?`, [id])) as {
    id: string
  }[]
  if (exists[0]?.id) {
    const setCols = CARD_BASE_COLUMNS.filter((col) => col !== 'id' && col !== 'card_no')
    await db.execute(
      `UPDATE ${TABLES.CARDS_BASE} SET ${setCols.map((col) => `${col} = ?`).join(', ')} WHERE id = ?`,
      [...setCols.map((col) => baseCard[col] ?? null), id]
    )
    return id
  }
  if (card_no) {
    const byNo = (await db.select(`SELECT id FROM ${TABLES.CARDS_BASE} WHERE card_no = ?`, [
      card_no,
    ])) as { id: string }[]
    if (byNo[0]?.id) return byNo[0].id
  }
  await db.execute(
    `INSERT INTO ${TABLES.CARDS_BASE} (${CARD_BASE_COLUMNS.join(', ')})
     VALUES (${CARD_BASE_COLUMNS.map(() => '?').join(', ')})`,
    CARD_BASE_COLUMNS.map((col) => baseCard[col] ?? null)
  )
  return id
}

export async function applyCustomPrints(
  db: DbLike,
  upsert: SyncCustomPrint[],
  deleteIds: string[]
): Promise<void> {
  for (const id of deleteIds) {
    const rows = (await db.select(`SELECT card_id FROM ${TABLES.CARD_PRINTS} WHERE id = ?`, [
      id,
    ])) as { card_id: string }[]
    // 卡组引用该打印时先删引用（deck_cards.card_id 外键无 ON DELETE 动作，直接删打印会报错）
    await db.execute(`DELETE FROM ${TABLES.DECK_CARDS} WHERE card_id = ?`, [id])
    await db.execute(`DELETE FROM ${TABLES.CARD_PRINTS} WHERE id = ?`, [id])
    const cardId = rows[0]?.card_id
    if (cardId) {
      const others = (await db.select(
        `SELECT 1 FROM ${TABLES.CARD_PRINTS} WHERE card_id = ? LIMIT 1`,
        [cardId]
      )) as unknown[]
      if (others.length === 0) {
        await db.execute(`DELETE FROM ${TABLES.CARDS_BASE} WHERE id = ?`, [cardId])
      }
    }
  }

  for (const c of upsert) {
    // 先写基础卡（print 外键依赖），再写打印
    const resolvedCardId = await upsertBaseCard(db, c.baseCard)
    const p = c.print
    await db.execute(
      `INSERT INTO ${TABLES.CARD_PRINTS}
       (${PRINT_COLUMNS.join(', ')})
       VALUES (${PRINT_COLUMNS.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET
         ${PRINT_COLUMNS.filter((col) => col !== 'id')
           .map((col) => `${col} = excluded.${col}`)
           .join(', ')}`,
      [
        p.id,
        resolvedCardId,
        p.card_no,
        p.card_no_extend,
        p.rarity_name,
        p.extend_rarity_name,
        p.back_image,
        p.language,
        p.img_cdn,
        p.tts_cdn,
        p.artist,
        p.print_order,
        p.is_default,
        p.is_promo,
        p.is_custom,
        p.created_at,
        p.updated_at,
      ]
    )
  }
}
