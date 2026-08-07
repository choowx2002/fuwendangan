/**
 * 404 开包彩蛋：按官方单包概率配置模拟开包（每包 5 张）。
 * 概率基准：普通/不凡基础版每包必定出现（槽 1/2），其余按每包概率随机掉落。
 * 槽 3-5 独立判定，每档概率换算为单槽概率 p_slot = 1 - (1 - p_pack)^(1/3)，
 * 精确还原每包出现率；同槽命中多档时取最稀有者，全部未命中则补普通/不凡。
 */

import { getRandomPackPrint, getAllSeries, type PackPrint } from '$lib/db'

export type PackTierId =
  | 'normal'
  | 'normalFoil'
  | 'token'
  | 'uncommon'
  | 'uncommonFoil'
  | 'rare'
  | 'epic'
  | 'alt'
  | 'overnum'
  | 'signedOvernum'

export interface PackTier {
  id: PackTierId
  label: string
  /** 每包出现概率（0-1），官方数据 */
  packChance: number
  isFoil: boolean
  color: string
}

/** 基础稀有度（必出槽位） */
export const PACK_BASE_TIERS: PackTier[] = [
  { id: 'normal', label: '普通', packChance: 1, isFoil: false, color: '#9b9a97' },
  { id: 'uncommon', label: '不凡', packChance: 1, isFoil: false, color: '#30a46c' },
]

/** 奖励掉落档（按稀有度从高到低，同槽命中多个时取靠前者） */
export const PACK_BONUS_TIERS: PackTier[] = [
  { id: 'signedOvernum', label: '签名超编', packChance: 0.0005, isFoil: true, color: '#d4af37' },
  { id: 'overnum', label: '超编', packChance: 0.0053, isFoil: true, color: '#e5484d' },
  { id: 'alt', label: '异画', packChance: 0.0313, isFoil: true, color: '#d6409f' },
  { id: 'epic', label: '史诗', packChance: 0.1, isFoil: false, color: '#8e4ec6' },
  { id: 'rare', label: '稀有', packChance: 0.7, isFoil: false, color: '#3e63dd' },
  { id: 'uncommonFoil', label: '不凡(闪)', packChance: 0.1167, isFoil: true, color: '#30a46c' },
  { id: 'normalFoil', label: '普通(闪)', packChance: 0.2213, isFoil: true, color: '#f76808' },
  { id: 'token', label: '指示物', packChance: 0.025, isFoil: false, color: '#9b9a97' },
]

const ALL_TIERS = new Map<PackTierId, PackTier>(
  PACK_BASE_TIERS.concat(PACK_BONUS_TIERS).map((t) => [t.id, t])
)

export interface PackCard {
  print: PackPrint
  tier: PackTierId
  label: string
  color: string
  isFoil: boolean
}

export interface PackResult {
  seriesCode: string
  cards: PackCard[]
}

export interface PackSeriesOption {
  code: string
  nameCn: string | null
}

/** 获取可开包的系列（优先启用中的，无启用系列时退回全部） */
export async function getPackSeriesList(): Promise<PackSeriesOption[]> {
  const series = await getAllSeries()
  const list = series.filter((s) => s.is_active)
  const source = list.length > 0 ? list : series
  return source.map((s) => ({ code: s.code, nameCn: s.name_cn }))
}

/** 单槽概率：把每包出现率换算为单槽出现率（每包 3 个奖励槽） */
function slotChance(packChance: number): number {
  return 1 - Math.pow(1 - packChance, 1 / 3)
}

function drawPrintForTier(seriesCode: string, tier: PackTier): Promise<PackPrint | null> {
  switch (tier.id) {
    case 'normal':
    case 'normalFoil':
      return getRandomPackPrint(seriesCode, { rarityName: '普通', extendRarityName: null, isToken: false })
    case 'uncommon':
    case 'uncommonFoil':
      return getRandomPackPrint(seriesCode, { rarityName: '不凡', extendRarityName: null, isToken: false })
    case 'rare':
      return getRandomPackPrint(seriesCode, { rarityName: '稀有', extendRarityName: null })
    case 'epic':
      return getRandomPackPrint(seriesCode, { rarityName: '史诗', extendRarityName: null })
    case 'alt':
      return getRandomPackPrint(seriesCode, { extendRarityName: '异画' })
    case 'overnum':
      return getRandomPackPrint(seriesCode, { extendRarityName: '超编' })
    case 'signedOvernum':
      return getRandomPackPrint(seriesCode, { extendRarityName: '签名超编' })
    case 'token':
      return getRandomPackPrint(seriesCode, { isToken: true })
  }
}

/** 抽取指定档位的一张卡；命中档查不到时依次降级，最终兜底为系列内任意卡 */
async function drawTier(
  seriesCode: string,
  tierId: PackTierId,
  fallbacks: PackTierId[] = []
): Promise<PackCard | null> {
  for (const id of [tierId, ...fallbacks]) {
    const tier = ALL_TIERS.get(id)
    if (!tier) continue
    const print = await drawPrintForTier(seriesCode, tier)
    if (print) {
      return { print, tier: tier.id, label: tier.label, color: tier.color, isFoil: tier.isFoil }
    }
  }
  const print = await getRandomPackPrint(seriesCode, {})
  if (!print) return null
  const tier = ALL_TIERS.get('normal')!
  return { print, tier: tier.id, label: tier.label, color: tier.color, isFoil: tier.isFoil }
}

/** 奖励槽掷骰：各档独立判定，取命中的最稀有档，未命中补普通/不凡 */
async function drawBonusSlot(seriesCode: string, attempt = 0): Promise<PackCard> {
  if (attempt > 5) throw new Error('开包失败：该系列卡池为空')
  const hits = PACK_BONUS_TIERS.filter((t) => Math.random() < slotChance(t.packChance))
  if (hits.length > 0) {
    const card = await drawTier(seriesCode, hits[0].id, ['rare', 'epic', 'normal', 'uncommon'])
    if (card) return card
  }
  const baseId = Math.random() < 0.5 ? 'normal' : 'uncommon'
  const card = await drawTier(seriesCode, baseId, ['normal', 'uncommon'])
  if (card) return card
  return drawBonusSlot(seriesCode, attempt + 1)
}

/** 开一包：5 张卡（槽 1 必普通、槽 2 必不凡，槽 3-5 独立掷奖励） */
export async function openPack(seriesCode: string): Promise<PackResult> {
  const cards: PackCard[] = []
  cards.push(
    (await drawTier(seriesCode, 'normal', ['uncommon'])) ?? (await drawBonusSlot(seriesCode))
  )
  cards.push(
    (await drawTier(seriesCode, 'uncommon', ['normal'])) ?? (await drawBonusSlot(seriesCode))
  )
  for (let i = 0; i < 3; i++) {
    cards.push(await drawBonusSlot(seriesCode))
  }
  return { seriesCode, cards }
}
