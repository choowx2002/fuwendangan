export const SORT_FIELD_MAP: Record<string, string> = {
  编号: 'card_no',
  类型: 'card_category',
  颜色: 'card_color_list',
  战力: 'power',
  法力: 'energy',
  符能: 'return_energy',
}

export const SORT_FIELD_LIST: string[] = [
  'card_no',
  'card_category',
  'card_color_list',
  'power',
  'energy',
  'return_energy',
]

export const ZONE_CONFIG = {
  legend: { name: 'Legend', label: '传奇', maxCount: 1 },
  champion: { name: 'Champion', label: '选定英雄', maxCount: 1 },
  mainDeck: { name: 'MainDeck', label: '主牌堆', maxCount: 39 },
  battlefields: { name: 'Battlefields', label: '战场', maxCount: 3 },
  runes: { name: 'Runes', label: '符文', maxCount: 12 },
  sideboard: { name: 'Sideboard', label: '备牌', maxCount: 10 },
} as const

export type ZoneKey = keyof typeof ZONE_CONFIG
