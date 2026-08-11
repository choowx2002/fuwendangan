import { DECK_FORMATS, type FormatKey } from './format'
export type { FormatKey }

/** 区域身份（与格式无关的名称 / 文案 key） */
export const ZONE_CONFIG = {
  legend: { name: 'Legend', labelKey: 'builder.legend' },
  champion: { name: 'Champion', labelKey: 'builder.champion' },
  mainDeck: { name: 'MainDeck', labelKey: 'builder.mainDeck' },
  battlefields: { name: 'Battlefields', labelKey: 'builder.battlefields' },
  runes: { name: 'Runes', labelKey: 'builder.runes' },
  sideboard: { name: 'Sideboard', labelKey: 'builder.sideboard' },
} as const

export type ZoneKey = keyof typeof ZONE_CONFIG

export interface ZoneConfig {
  name: string
  labelKey: string
  maxCount: number
}

/** 默认格式：新建卡组 / 未知格式回退用 */
export const DEFAULT_FORMAT: FormatKey = '1v1（比赛）'

/** 各模式各分区的数量上限（主牌 39 + 英雄 1 = 40 张主牌堆） */
export const FORMAT_ZONE_LIMITS: Record<FormatKey, Record<ZoneKey, number>> = {
  '1v1（决斗）': { legend: 1, champion: 1, mainDeck: 39, battlefields: 3, runes: 12, sideboard: 10 },
  '1v1（比赛）': { legend: 1, champion: 1, mainDeck: 39, battlefields: 3, runes: 12, sideboard: 10 },
  '3 人乱斗（遭遇战）': {
    legend: 1,
    champion: 1,
    mainDeck: 39,
    battlefields: 3,
    runes: 12,
    sideboard: 10,
  },
  '4 人乱斗（全面战争）': {
    legend: 1,
    champion: 1,
    mainDeck: 39,
    battlefields: 3,
    runes: 12,
    sideboard: 10,
  },
  '2v2（熔岩大厅）': {
    legend: 1,
    champion: 1,
    mainDeck: 39,
    battlefields: 3,
    runes: 12,
    sideboard: 10,
  },
}

/** 是否为合法的卡组格式 */
export function isValidFormat(format: string | null | undefined): format is FormatKey {
  return DECK_FORMATS.includes(format as FormatKey)
}

/** 将任意 format 值规整为合法格式；空 / 非法回退默认格式 */
export function resolveFormat(format: string | null | undefined): FormatKey {
  return isValidFormat(format) ? format : DEFAULT_FORMAT
}

/** 获取某格式下某分区的容量配置 */
export function getZoneConfig(format: FormatKey, zone: ZoneKey): ZoneConfig {
  return { ...ZONE_CONFIG[zone], maxCount: FORMAT_ZONE_LIMITS[format][zone] }
}
