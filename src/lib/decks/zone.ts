export const ZONE_CONFIG = {
  legend: { name: 'Legend', label: '传奇', maxCount: 1 },
  champion: { name: 'Champion', label: '选定英雄', maxCount: 1 },
  mainDeck: { name: 'MainDeck', label: '主牌堆', maxCount: 39 },
  battlefields: { name: 'Battlefields', label: '战场', maxCount: 3 },
  runes: { name: 'Runes', label: '符文', maxCount: 12 },
  sideboard: { name: 'Sideboard', label: '备牌', maxCount: 10 },
} as const

export type ZoneKey = keyof typeof ZONE_CONFIG
