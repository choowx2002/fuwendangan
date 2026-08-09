export const ZONE_CONFIG = {
  legend: { name: 'Legend', labelKey: 'builder.legend', maxCount: 1 },
  champion: { name: 'Champion', labelKey: 'builder.champion', maxCount: 1 },
  mainDeck: { name: 'MainDeck', labelKey: 'builder.mainDeck', maxCount: 39 },
  battlefields: { name: 'Battlefields', labelKey: 'builder.battlefields', maxCount: 3 },
  runes: { name: 'Runes', labelKey: 'builder.runes', maxCount: 12 },
  sideboard: { name: 'Sideboard', labelKey: 'builder.sideboard', maxCount: 10 },
} as const

export type ZoneKey = keyof typeof ZONE_CONFIG
