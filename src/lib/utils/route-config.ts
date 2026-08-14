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
  '/locker': { backTo: '/', description: '储物柜 → 首页' },
  '/simulator': { backTo: '/', description: '模拟器 → 首页' },
  '/simulator/chainSimulator': { backTo: '/simulator', description: '结算链模拟器 → 模拟器' },
  '/simulator/packOpener': { backTo: '/simulator', description: '开包模拟 → 模拟器' },

  // 工具与设置
  '/tools': { backTo: '/', description: '对战工具 → 首页' },
  '/tools/gameCounter': { backTo: '/tools', description: '对战记录 → 对战工具' },
  '/tools/dice': { backTo: '/tools', description: '骰子 → 对战工具' },
  '/scanner': { backTo: '/decks', description: '扫码 → 卡组导入' },
  '/settings': { backTo: '/', description: '设置 → 首页' },

  // 可以扩展嵌套页面
  '/decks/builder': { backTo: '/decks', description: '编辑卡组 → 我的卡组' },
  '/decks/:deckid/records': { backTo: '/decks', description: '对局记录 → 我的卡组' },
  '/decks/:deckid/records/:matchid/logs': { backTo: '/decks', description: '对局日志 → 对局记录' },
  '/collection/:seriesCode': { backTo: '/collection', description: '系列收藏 → 收藏总览' },
  '/collection/history': { backTo: '/collection', description: '收藏历史 → 收藏总览' },
  '/collection/missing': { backTo: '/collection', description: '缺卡清单 → 收藏总览' },
  '/collection/wishlist': { backTo: '/collection', description: '心愿单 → 收藏总览' },
  '/collection/loans': { backTo: '/collection', description: '借出借入 → 收藏总览' },
  '/collection/purchase-lists': { backTo: '/collection', description: '购买清单 → 收藏总览' },
  '/collection/purchase-lists/new': {
    backTo: '/collection/purchase-lists',
    description: '新建购买清单 → 购买清单',
  },
  '/collection/purchase-lists/:listId': {
    backTo: '/collection/purchase-lists',
    description: '购买清单详情 → 购买清单',
  },
  '/collection/purchase-lists/:listId/edit': {
    backTo: '/collection/purchase-lists',
    description: '编辑购买清单 → 购买清单',
  },
  '/locker/:lockerId': { backTo: '/locker', description: '储物柜详情 → 储物柜列表' },
  '/locker/:lockerId/:sectionId': { backTo: '/locker', description: '抽屉卡片 → 储物柜详情' },
}
