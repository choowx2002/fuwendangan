/**
 * 卡组可用的游戏格式列表（值为 DB 持久值，展示时按 FORMAT_LABEL_KEYS 翻译）
 */
export const DECK_FORMATS = [
  '1v1（决斗）',
  '1v1（比赛）',
  '3 人乱斗（遭遇战）',
  '4 人乱斗（全面战争）',
  '2v2（熔岩大厅）',
] as const

export type FormatKey = (typeof DECK_FORMATS)[number]

export const FORMAT_LABEL_KEYS: Record<string, string> = {
  '1v1（决斗）': 'decks.formatDuel1v1',
  '1v1（比赛）': 'decks.formatMatch1v1',
  '3 人乱斗（遭遇战）': 'decks.format3v3FreeForAll',
  '4 人乱斗（全面战争）': 'decks.format4v4TotalWar',
  '2v2（熔岩大厅）': 'decks.format2v2LavaHall',
}
