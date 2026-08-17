/**
 * 复盘卡牌元数据解析（M1）
 *
 * 卡图渲染管线（设计 §7）：
 * 1. 本地 SC 版卡图（card_prints language='SC' 的 img_cdn，经 loadImageFromAppFolder 加载）
 * 2. 占位卡背（组件层处理）
 * 不使用 cards-data.js / 远端 CDN —— 卡数据一律以应用本地库（card_prints + cards_base）为准。
 * 元数据（名称/费用/战力/类型）优先本地 cards_base，缺失时由事件数据自带字段兜底。
 */

import { getBestPrint, getCardAndPrintByPrintCode, printCacheName } from '$lib/db'
import { isTauri } from '$lib/db/env'
import { normalizeSignedSuffix } from '$lib/decks/deck-import'
import type { GameState } from './replay-engine.js'

export interface ReplayCardMeta {
  /** 本地库卡名（en 优先） */
  name: string | null
  /** 本地库卡牌类别（中文，可作兜底展示） */
  type: string | null
  energyCost: number | null
  might: number | null
  /** 本地 SC 卡图地址（经 loadImageFromAppFolder 加载；null 表示本地无图） */
  imgCdn: string | null
  /** 图片缓存名（printCacheName） */
  cacheName: string | null
  /** 本地库是否命中 */
  found: boolean
}

/**
 * 基础卡号：形如 "XXX-NNN"（7 字符）+ 可选变体后缀（S=签名、A=异画等）。
 * 本地 card_prints 按基础卡号收录（实测 VEN-193S 这类签名/变体卡号无法直接命中，
 * 需截取前 7 位得到 VEN-193 再检索），因此超长卡号截取前 7 字符。
 */
export function baseCardCode(code: string): string {
  return code && code.length > 7 ? code.slice(0, 7) : code
}

/** 未命中本地库时的兜底元数据（名称/类型等由事件数据补充） */
export function createFallbackMeta(code: string): ReplayCardMeta {
  return fallbackMeta(code)
}

function fallbackMeta(code: string): ReplayCardMeta {
  return {
    name: null,
    type: null,
    energyCost: null,
    might: null,
    imgCdn: null,
    cacheName: null,
    found: false,
  }
}

/**
 * 批量解析卡号 → 元数据，全部来自本地库（card_prints + cards_base）。
 * Web 模式无本地库，返回全兜底（仅展示事件数据自带的名称/类型，卡图占位）。
 *
 * 本地检索候选（按顺序取首个命中）：
 * 1. 原卡号（如 "VEN-193S"，能命中独立印刷则用之）
 * 2. 签名后缀规整（"VEN-193S" → "VEN-193*"，应用本地 `*` 约定）
 * 3. 基础卡号（截取前 7 位，如 "VEN-193"）→ card_prints 搜索 → 得到其 cardbase
 */
export async function resolveCardMetas(codes: string[]): Promise<Map<string, ReplayCardMeta>> {
  const map = new Map<string, ReplayCardMeta>()
  const unique = [
    ...new Set(codes.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean)),
  ]

  if (!isTauri) {
    for (const code of unique) map.set(code, fallbackMeta(code))
    return map
  }

  await Promise.all(
    unique.map(async (code) => {
      const meta = fallbackMeta(code)
      const candidates = [...new Set([code, normalizeSignedSuffix(code), baseCardCode(code)])]
      try {
        for (const cand of candidates) {
          const card = await getCardAndPrintByPrintCode(cand)
          if (!card) continue
          const best = getBestPrint(card)
          meta.name = card.card_name_en ?? card.card_name_cn ?? null
          meta.type = Array.isArray(card.card_category)
            ? card.card_category.join(' / ')
            : typeof card.card_category === 'string'
              ? card.card_category
              : null
          meta.energyCost = typeof card.energy === 'number' ? card.energy : null
          meta.might = typeof card.power === 'number' ? card.power : null
          if (best?.url) {
            meta.imgCdn = best.url
            meta.cacheName = printCacheName(best)
          }
          meta.found = true
          break
        }
      } catch {
        // 本地查询失败时保持 CDN 回退
      }
      map.set(code, meta)
    })
  )
  return map
}

/** 从回放构建的快照中收集全部出现过的卡号（版面 + Chain + 卡组分区） */
export function collectCardCodesFromStates(states: GameState[]): string[] {
  const codes = new Set<string>()
  const zoneNames = [
    'deck',
    'hand',
    'base',
    'trash',
    'banished',
    'battlefieldA',
    'battlefieldB',
    'battlefieldC',
    'battlefieldToken',
    'champion',
    'legend',
    'runeDeck',
    'runeArea',
  ]
  const addCode = (v: unknown) => {
    if (v && typeof v === 'object' && 'cardCode' in v) {
      const code = (v as { cardCode?: unknown }).cardCode
      if (typeof code === 'string' && code) codes.add(code)
    }
  }
  for (const state of states) {
    for (const pl of state.players ?? []) {
      const board = pl.board ?? {}
      for (const zone of zoneNames) {
        const list = board[zone]
        if (Array.isArray(list)) for (const c of list) addCode(c)
      }
      const sections = pl.deck?.sections
      if (sections && typeof sections === 'object') {
        for (const key of Object.keys(sections as Record<string, unknown>)) {
          const list = (sections as Record<string, unknown>)[key]
          if (Array.isArray(list)) {
            for (const en of list) {
              if (en && typeof en === 'object' && 'cardCode' in en) {
                const code = (en as { cardCode?: unknown }).cardCode
                if (typeof code === 'string' && code) codes.add(code)
              }
            }
          }
        }
      }
    }
    for (const en of state.chainEntries ?? []) addCode(en.card)
  }
  return [...codes]
}
