/**
 * 卡组导入服务：将 Piltover Riftbound Deck Code 解码并转换为 Builder 需要的分区状态
 */

import { getDeckFromCode } from '@piltoverarchive/riftbound-deck-codes'
import type {
  Card as RiftboundCard,
  DeckWithSideboard,
} from '@piltoverarchive/riftbound-deck-codes'
import {
  getCardAndPrintByPrintCode,
  getCardAndPrintByEnglishName,
  getCardAndPrintByCardNo,
} from '$lib/db'
import type { cardAndPrint } from './types'
import { ZONE_CONFIG, type ZoneKey } from './zone'
import { QR_PAYLOAD_VERSION } from './deck-qr'
import { get } from 'svelte/store'
import { t } from '$lib/i18n'

export interface ImportError {
  messageKey: string
  params: Record<string, string | number>
}

export interface DecodedDeckResult {
  deck: {
    legendCards: cardAndPrint[]
    championCards: cardAndPrint[]
    mainDeckCards: cardAndPrint[]
    battlefieldCards: cardAndPrint[]
    runeCards: cardAndPrint[]
    sideboardCards: cardAndPrint[]
  }
  /** 未能匹配到本地卡图的卡牌编号数 */
  missingCount: number
  /** 本地数据库中不存在的卡牌编号 */
  missingCodes: string[]
}

/**
 * 根据卡牌类别判断其所在分区。
 * 需与 deck-code.ts 的编码顺序（legend + champion + battlefields + runes 均并入 mainDeck）对应。
 */
function classifyZone(
  categories: string[] | null | undefined
): 'legend' | 'rune' | 'battlefield' | 'main' {
  if (!categories?.length) return 'main'
  if (categories.some((c) => c.includes('传奇'))) return 'legend'
  if (categories.some((c) => c.includes('符文'))) return 'rune'
  if (categories.some((c) => c.includes('战场'))) return 'battlefield'
  return 'main'
}

/**
 * 把签名后缀规整为应用的 `*` 约定（仅用于查卡键）。
 * 库默认把签名卡解码为 `s`；本应用卡号存储用 `*`（见 tts-communication-service 的 `*`→`S` 替换）。
 * 结尾的 `s`/`S`（签名变体）统一替换为 `*`，保证无论代码来源都能命中本地打印。
 */
export function normalizeSignedSuffix(code: string): string {
  if (!code) return code
  const last = code[code.length - 1]
  if (last === 's' || last === 'S') return `${code.slice(0, -1)}*`
  return code
}

/**
 * 解码一个 Riftbound Deck Code。
 * 返回 null 表示解码失败（非法 / 或不支持的版本）。
 */
export function parseDeckCodeText(code: string): DeckWithSideboard | null {
  const trimmed = code.trim()
  if (!trimmed) return null
  try {
    // 签名卡用 `*` 后缀解码，与应用本地卡号（card_no_extend 用 `*`）一致
    return getDeckFromCode(trimmed, { signedSuffix: '*' })
  } catch {
    return null
  }
}

/**
 * 解码一个 Riftbound Deck Code，并保留失败原因。
 * 返回 { deck, error }，成功时 error 为 null，失败时 deck 为 null。
 */
export function tryParseDeckCodeText(code: string): {
  deck: DeckWithSideboard | null
  error: string | null
} {
  const trimmed = code.trim()
  if (!trimmed) return { deck: null, error: null }
  try {
    return { deck: getDeckFromCode(trimmed, { signedSuffix: '*' }), error: null }
  } catch (e) {
    return {
      deck: null,
      error: e instanceof Error ? e.message : get(t)('decks.decodeCodeFailed'),
    }
  }
}

/** 将解码出的卡牌列表按分区归档成 Builder 可用的分区状态 */
export async function resolveDeckCards(decoded: DeckWithSideboard): Promise<DecodedDeckResult> {
  const result: DecodedDeckResult = {
    deck: {
      legendCards: [],
      championCards: [],
      mainDeckCards: [],
      battlefieldCards: [],
      runeCards: [],
      sideboardCards: [],
    },
    missingCount: 0,
    missingCodes: [],
  }

  const championCode = normalizeSignedSuffix(decoded.chosenChampion?.trim() ?? '')

  async function appendCards(cards: RiftboundCard[], target: cardAndPrint[]) {
    for (const item of cards) {
      const resolved = await getCardAndPrintByPrintCode(normalizeSignedSuffix(item.cardCode))
      if (!resolved) {
        result.missingCodes.push(item.cardCode)
        result.missingCount++
        continue
      }
      for (let i = 0; i < item.count; i++) {
        target.push(resolved)
      }
    }
  }

  // sideboard 原样放入 sideboard 分区
  await appendCards(decoded.sideboard, result.deck.sideboardCards)

  // mainDeck 需按类别拆分
  for (const item of decoded.mainDeck) {
    // chosenChampion 优先落到 champion 分区
    if (
      championCode &&
      normalizeSignedSuffix(item.cardCode).toUpperCase() === championCode.toUpperCase()
    ) {
      const resolved = await getCardAndPrintByPrintCode(normalizeSignedSuffix(item.cardCode))
      if (resolved) {
        result.deck.championCards = [resolved]
      } else {
        result.missingCodes.push(item.cardCode)
        result.missingCount++
      }
      continue
    }

    const resolved = await getCardAndPrintByPrintCode(normalizeSignedSuffix(item.cardCode))
    if (!resolved) {
      result.missingCodes.push(item.cardCode)
      result.missingCount++
      continue
    }

    const zone = classifyZone(resolved.card_category)
    const target =
      zone === 'legend'
        ? result.deck.legendCards
        : zone === 'rune'
          ? result.deck.runeCards
          : zone === 'battlefield'
            ? result.deck.battlefieldCards
            : result.deck.mainDeckCards
    for (let i = 0; i < item.count; i++) {
      target.push(resolved)
    }
  }

  // 兜底：若 champion 分区为空但解码里有 chosenChampion，尝试按编号解析
  if (championCode && result.deck.championCards.length === 0) {
    const resolved = await getCardAndPrintByPrintCode(championCode)
    if (resolved) {
      result.deck.championCards = [resolved]
    }
  }

  return result
}

// ==================== 国际官方文本导入 ====================

export interface OfficialTextEntry {
  name: string
  qty: number
}

export interface ParsedOfficialText {
  zones: Record<ZoneKey, OfficialTextEntry[]>
  errors: ImportError[]
}

const OFFICIAL_ZONE_LABELS: Record<string, ZoneKey> = {
  legend: 'legend',
  champion: 'champion',
  maindeck: 'mainDeck',
  main: 'mainDeck',
  battlefields: 'battlefields',
  battlefield: 'battlefields',
  runes: 'runes',
  rune: 'runes',
  runepool: 'runes',
  sideboard: 'sideboard',
  side: 'sideboard',
}

/**
 * 解析「国际官方文本」格式。支持两种写法：
 *  1) 分区头独占一行（"Legend:"），卡牌行跟在后续行（"1 Master Yi, Wuju Bladesman"）
 *  2) 分区头与卡牌同行（"MainDeck: 3 Charm 3 Defy 3 Discipline..."）
 * 卡名可含空格与副标题（如 "Punch First" / "Master Yi, Wuju Bladesman"）。
 */
export function parseGlobalOfficialText(raw: string): ParsedOfficialText {
  const zones: Record<ZoneKey, OfficialTextEntry[]> = {
    legend: [],
    champion: [],
    mainDeck: [],
    battlefields: [],
    runes: [],
    sideboard: [],
  }
  const errors: ImportError[] = []

  let currentZone: ZoneKey | null = null
  // console.log("parseGlobalOfficialText");
  function pushEntries(zone: ZoneKey, text: string) {
    const entryRe = /(\d+)\s+(.*?)(?=\s+\d+\s|$)/g
    let m: RegExpExecArray | null
    // console.log(zone)
    while ((m = entryRe.exec(text)) !== null) {
      const name = m[2].trim()
      // console.log(m, "name:", name,);
      if (name) {
        zones[zone].push({ name, qty: parseInt(m[1], 10) })
      }
    }
  }

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const headerMatch = /^([A-Za-z][A-Za-z\s]*):\s*(.*)$/.exec(line)
    if (headerMatch) {
      const key = headerMatch[1].replace(/\s+/g, '').toLowerCase()
      const zone = OFFICIAL_ZONE_LABELS[key]
      if (zone) {
        currentZone = zone
        const rest = headerMatch[2].trim()
        if (rest) pushEntries(zone, rest)
      } else {
        errors.push({
          messageKey: 'decks.importErrUnknownZone',
          params: { zone: headerMatch[1] },
        })
        currentZone = null
      }
      continue
    }

    const entryMatch = /^(\d+)\s+(.+)$/.exec(line)
    if (entryMatch) {
      if (!currentZone) {
        errors.push({ messageKey: 'decks.importErrLineNoZone', params: { line } })
        continue
      }
      zones[currentZone].push({ name: entryMatch[2].trim(), qty: parseInt(entryMatch[1], 10) })
      continue
    }

    errors.push({ messageKey: 'decks.importErrUnparsableLine', params: { line } })
  }

  return { zones, errors }
}

/** 将解析出的官方文本卡牌解析为本地卡图并按显式分区归档 */
export async function resolveGlobalOfficialText(
  parsed: ParsedOfficialText
): Promise<DecodedDeckResult> {
  const result: DecodedDeckResult = {
    deck: {
      legendCards: [],
      championCards: [],
      mainDeckCards: [],
      battlefieldCards: [],
      runeCards: [],
      sideboardCards: [],
    },
    missingCount: 0,
    missingCodes: [],
  }

  const zoneToKey: Record<ZoneKey, keyof DecodedDeckResult['deck']> = {
    legend: 'legendCards',
    champion: 'championCards',
    mainDeck: 'mainDeckCards',
    battlefields: 'battlefieldCards',
    runes: 'runeCards',
    sideboard: 'sideboardCards',
  }

  for (const zone of Object.keys(ZONE_CONFIG) as ZoneKey[]) {
    const entries = parsed.zones[zone]
    const target = result.deck[zoneToKey[zone]]
    for (const entry of entries) {
      const resolved = await getCardAndPrintByEnglishName(entry.name, {
        legendOnly: zone === 'legend',
      })
      if (!resolved) {
        result.missingCodes.push(entry.name)
        result.missingCount++
        continue
      }
      for (let i = 0; i < entry.qty; i++) {
        target.push(resolved)
      }
    }
  }

  return result
}

// ==================== 二维码（RA1 payload）导入 ====================

export interface QrZoneEntry {
  card_no: string
  quantity: number
}

export interface ParsedQrPayload {
  zones: {
    main: QrZoneEntry[]
    side: QrZoneEntry[]
    champion: QrZoneEntry[]
  }
  errors: ImportError[]
}

const QR_ZONE_LETTERS: Record<string, 'main' | 'side' | 'champion'> = {
  m: 'main',
  s: 'side',
  c: 'champion',
}

/**
 * 解析二维码 payload（本应用「二维码」导出生成的 RA1 格式）。
 * 首行必须为版本标记（RA1），其后每行为一个分区：
 *   `{m|s|c}{分区总数}:{card_no}:{qty}:{card_no}:{qty}...`
 */
export function parseQrPayload(raw: string): ParsedQrPayload {
  const result: ParsedQrPayload = {
    zones: { main: [], side: [], champion: [] },
    errors: [],
  }
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0 || lines[0] !== QR_PAYLOAD_VERSION) {
    result.errors.push({
      messageKey: 'decks.importErrQrVersion',
      params: { version: QR_PAYLOAD_VERSION },
    })
    return result
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const m = /^([msc])(\d+)(?:(?::[^:]+:\d+)*)$/.exec(line)
    if (!m) {
      result.errors.push({
        messageKey: 'decks.importErrQrLineFormat',
        params: { line: i + 1, text: line },
      })
      continue
    }
    const zone = QR_ZONE_LETTERS[m[1]]
    const declaredTotal = parseInt(m[2], 10)
    const pairs = line.slice(m[0].indexOf(':') + 1).split(':') as string[]
    let actualTotal = 0
    const entries: QrZoneEntry[] = []
    for (let j = 0; j + 1 < pairs.length; j += 2) {
      const cardNo = pairs[j]
      const qty = parseInt(pairs[j + 1], 10)
      if (!cardNo || Number.isNaN(qty) || qty <= 0) {
        result.errors.push({
          messageKey: 'decks.importErrQrInvalidEntry',
          params: { line: i + 1, card: cardNo || pairs[j] },
        })
        continue
      }
      actualTotal += qty
      entries.push({ card_no: cardNo, quantity: qty })
    }
    if (declaredTotal !== actualTotal) {
      result.errors.push({
        messageKey: 'decks.importErrQrTotalMismatch',
        params: { line: i + 1, declared: declaredTotal, actual: actualTotal },
      })
      continue
    }
    result.zones[zone] = entries
  }
  return result
}

/** 将解析出的二维码卡牌按 card_no 解析为本地卡图；main 区按卡牌类别拆回传奇/战场/符文/主牌。 */
export async function resolveQrPayload(parsed: ParsedQrPayload): Promise<DecodedDeckResult> {
  const result: DecodedDeckResult = {
    deck: {
      legendCards: [],
      championCards: [],
      mainDeckCards: [],
      battlefieldCards: [],
      runeCards: [],
      sideboardCards: [],
    },
    missingCount: 0,
    missingCodes: [],
  }

  async function appendEntry(entry: QrZoneEntry, target: cardAndPrint[]) {
    const resolved = await getCardAndPrintByCardNo(entry.card_no)
    if (!resolved) {
      result.missingCodes.push(entry.card_no)
      result.missingCount++
      return
    }
    for (let i = 0; i < entry.quantity; i++) {
      target.push(resolved)
    }
  }

  for (const entry of parsed.zones.side) {
    await appendEntry(entry, result.deck.sideboardCards)
  }
  for (const entry of parsed.zones.champion) {
    await appendEntry(entry, result.deck.championCards)
  }
  for (const entry of parsed.zones.main) {
    const resolved = await getCardAndPrintByCardNo(entry.card_no)
    if (!resolved) {
      result.missingCodes.push(entry.card_no)
      result.missingCount++
      continue
    }
    const zone = classifyZone(resolved.card_category)
    const target =
      zone === 'legend'
        ? result.deck.legendCards
        : zone === 'rune'
          ? result.deck.runeCards
          : zone === 'battlefield'
            ? result.deck.battlefieldCards
            : result.deck.mainDeckCards
    for (let i = 0; i < entry.quantity; i++) {
      target.push(resolved)
    }
  }

  return result
}
