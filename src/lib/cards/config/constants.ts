export const OPTIONS_PRIORITY = {
  card_color_list: ['red', 'green', 'blue', 'orange', 'purple', 'yellow'],
  series: ['FND', 'ARC', 'OGS', 'OGN', 'SFD', 'UNL', 'VEN'],
  rarity: ['普通', '不凡', '稀有', '史诗', '异画'],
  card_category: [
    '传奇',
    '英雄单位',
    '单位',
    '法术',
    '装备',
    '战场',
    '符文',
    '专属单位',
    '专属法术',
    '专属装备',
    '单位指示物',
    '装备指示物',
    '战场指示物',
  ],
  keyword: [
    '反应',
    '迅捷',
    '后排',
    '壁垒',
    '伏击',
    '急速',
    '游走',
    '绝念',
    '瞬息',
    '鼓舞',
    '预知',
    '待命',
    '回响',
    '获得',
    '眩晕',
    '增益',
    '强力',
    '百炼',
    '灵便',
    '装配',
  ],
}

/*
* translate to chinese map
*/
const languageMap: Record<string, string> = {
  'red': '炽烈',
  'green': '翠意',
  'blue': '灵光',
  'orange': '摧破',
  'purple': '混沌',
  'yellow': '序理',
  'colorless': '无色'
};

export const iconLanguage = Object.freeze(languageMap)
