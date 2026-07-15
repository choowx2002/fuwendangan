interface RouteConfig {
  backTo: string | null
  description: string
}

export const routeBackConfig: Record<string, RouteConfig> = {
  // 主页面
  '/': { backTo: null, description: '首页 - 正常退出' },

  // 二级页面
  '/cards': { backTo: '/', description: '单卡库 → 首页' },
  '/decks': { backTo: '/', description: '我的卡组 → 首页' },
  '/collection': { backTo: '/', description: '收藏与闪卡 → 首页' },
  '/simulator': { backTo: '/', description: '模拟器 → 首页' },

  // 工具与设置
  '/tools': { backTo: '/', description: '对战工具 → 首页' },
  '/settings': { backTo: '/', description: '设置 → 首页' },

  // 可以扩展嵌套页面
  '/decks/builder': { backTo: '/decks', description: '编辑卡组 → 我的卡组' },
}
