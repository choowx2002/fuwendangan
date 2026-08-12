# 软件总览 · Rune Archive（符文档案）

> 基于代码证据的产品分析文档，生成时间：2026-08-12。版本基线：0.8.5。

## 软件定位

「符文档案」是一款基于 **Tauri 2 + SvelteKit 5 + TypeScript + SQLite** 构建的 **Local-first 桌面应用**，为 Riftbound（符文战场）玩家提供卡牌资料库、卡组构筑、收藏管理、借还记录、购买清单与规则查询。非官方第三方社区项目（MIT 许可，不隶属 Riot Games）。

## 目标用户

- Riftbound 卡牌玩家（组卡、验卡、借还）
- 卡牌收藏者（进度统计、缺卡清单、心愿单）
- 需要根据缺卡生成购买清单的玩家

## 核心使用场景

1. 浏览卡牌库：搜索（名称/编号/副标题）、高级筛选、排序、卡图本地缓存
2. 录入收藏：多语言版本 × 普卡/闪卡数量，批量标记、收藏进度统计
3. 构筑卡组：Legend / Champion / Main / Battlefields / Runes / Sideboard 六区，拖拽、合法性检查、版本管理、Deck Code / 扫码 / JSON 导入导出
4. 卡组持有检查：按印刷号或按卡牌合并，计算 `available = owned - 生效借出 + 生效借入`，缺卡数量
5. 生成购买清单：从卡组缺卡一键生成，支持重新计算与 `pending/ordered/bought/skipped` 状态跟踪
6. 心愿单 + 借出/借入记录（联系人、应还时间、逾期标记）
7. 规则文档、对局记录、对战工具（骰子/计分）、TTS 联动

## 核心业务流程

```
内容数据同步（5 张同步表：cards/prints/icons/rules/series）
        │
        ▼
  本地 SQLite（Local-first，离线可用）
        │
        ├── 搜索 / 浏览 / 筛选
        ├── 录入收藏（语言 × 普卡/闪卡）→ 进度统计 / 缺卡清单
        ├── 借出/借入 → 生效数量（active/overdue）→ available 计算
        ├── 卡组 → 持有检查（print/card）→ qty_to_buy → 购买清单（upsert 去重）
        └── 备份 / 恢复 / 数据管理（仅本机）
```

## 当前产品阶段判断

- 核心功能（卡库/卡组/规则/收藏/同步）完整，`pnpm check` 0 错误 0 警告。
- 本轮新增：心愿单、借出/借入（含联系人）、购买清单（含按卡牌合并模式）、卡组持有检查弹窗内一键生成清单。
- 尚缺：多设备玩家数据同步（`docs/player-data-sync.md` 标注「设计定稿，待实施」）；无自动化测试（无测试框架/CI）。
- 结论：**功能覆盖已足够进入小范围 Beta，但需先修复一批阻塞项（见 beta-readiness.md）。**

## 主要模块划分

| 模块                              | 路由                                                                | 状态                                    |
| --------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| 卡牌库（搜索/筛选/卡图）          | `/cards`                                                            | 已实现                                  |
| 收藏（统计/缺卡/历史/自定义打印） | `/collection`, `/[seriesCode]`, `/missing`, `/history`              | 已实现                                  |
| 心愿单                            | `/collection/wishlist`                                              | 已实现（新）                            |
| 借出/借入 + 联系人                | `/collection/loans`                                                 | 已实现（新）                            |
| 购买清单                          | `/collection/purchase-lists`, `/collection/purchase-lists/[listId]` | 已实现（新）                            |
| 卡组 + 持有检查 + 生成清单        | `/decks`, `/decks/builder`, `/decks/[deckid]`                       | 已实现                                  |
| 对局记录                          | `/decks/[deckid]/records`, `/decks/[deckid]/records/[matchid]/logs` | 已实现                                  |
| 储物柜（卡柜整理）                | `/locker`                                                           | 已实现                                  |
| 规则文档                          | `/rules`                                                            | 已实现                                  |
| 对战工具（骰子/计分）             | `/tools/dice`, `/tools/gameCounter`                                 | 已实现                                  |
| 扫码导入                          | `/scanner`                                                          | 已实现                                  |
| 设置 / 备份 / 数据管理            | `/settings`                                                         | 已实现                                  |
| （导航）模拟器                    | `/simulator`                                                        | **死链（无路由，见 missing-features）** |
