# 软件总览 · Rune Archive（符文档案）

> 基于代码证据的产品分析文档。版本基线：0.8.5（git HEAD `59805b7`）。验证：`pnpm check` 0 错误 0 警告。

## 软件定位

「符文档案」是一款基于 **Tauri 2 + SvelteKit 5 + TypeScript + SQLite** 构建的 **Local-first** 卡牌收藏与卡组管理应用，面向《符文战场》（Riftbound: LoL TCG）玩家。提供卡牌资料库、卡组构筑、收藏录入与进度统计、心愿单、借出/借入记录、按缺卡生成购买清单、规则查询、对局记录与卡柜整理。

- 非官方第三方社区项目（MIT，不隶属 Riot Games）。
- 数据架构 Local-first：内容数据（卡牌/卡图/图标/规则/系列）从开发者自有 Supabase 单向同步到本地 SQLite，离线可查；玩家自有数据（收藏/卡组/借还/心愿单/购买清单/对局）**仅存本机**，通过手动备份/恢复与 CSV 导入导出迁移。

## 目标用户

- Riftbound 卡牌玩家：组卡、验卡、查规则、记对局。
- 卡牌收藏者：多语言 × 普卡/闪卡录入、收藏进度、缺卡清单。
- 需要「组卡 → 查缺 → 生成购买清单 → 标记已购」闭环的玩家。
- 有借出/借入习惯的玩家（联系人管理、应还提醒）。

## 核心使用场景

1. **卡库浏览与查询**：搜索（名称/编号/副标题/标签/关键词）、多维筛选（系列/类别/颜色/稀有度/属性数值）、排序、卡图本地缓存与批量下载。
2. **收藏录入**：按「卡图印刷 × 语言」记录普卡/闪卡数量；批量标记已拥有/批量 +1；进度统计（五桶 base/alt/overnum/rune/token × 系列）；缺卡清单（可筛选、可导出）。
3. **卡组构筑**：Legend / Champion / Main Deck / Battlefields / Runes / Sideboard 六区；拖拽、数量管理、合法性检查、版本管理、Deck Code / 文本 / JSON / QR 导入导出。
4. **卡组持有检查**：`available = owned − 生效借出 + 生效借入`，按印刷号精确或按卡牌合并两种模式，导出 TXT/CSV，一键生成购买清单。
5. **心愿单**：期望语言/工艺、数量、优先级；标记已拥有（幂等写回收藏）；导出/回导 CSV；一键转购买清单。
6. **借出/借入**：双向记录、联系人（微信/QQ/电话/邮箱）、应还日期、逾期自动标记、到期汇总提醒；借还数量参与可用库存计算。
7. **购买清单**：从卡组缺卡或心愿单生成；`qty_required / owned / to_buy / ordered / borrowed / bought` 全链路；已购买写回收藏、借入自动对账、状态跟踪（pending/ordered/bought/skipped/met）。
8. **附加**：规则书阅读器、对局记录与计分器、卡柜（Locker）整理、开包模拟器、骰子工具、扫码导入、TTS 联动（默认关闭）。

## 核心业务流程

```
开发者 Supabase（内容源）
   │ 按表 timestamp 增量，整表全量替换（cards/prints/icons/rules/series）
   ▼
本地 SQLite（Local-first，离线可用）
   │
   ├─ 卡库：搜索 / 筛选 / 排序 / 卡图缓存
   ├─ 收藏录入（印刷 × 语言 × 普卡/闪卡）→ 进度统计 / 缺卡清单 / 历史与快照
   ├─ 借出/借入（active/overdue 生效）→ available = owned − 借出 + 借入
   ├─ 卡组构筑 → 持有检查（print / card 模式）→ 缺卡 qty_to_buy
   │      └─ 生成购买清单 → 已购写回收藏 / 借入对账 / 状态跟踪
   └─ 备份（整库 .db） / 恢复 / 卡组 JSON 导出导入 / 各模块 CSV 导出导入
```

## 当前产品阶段判断

- **成熟度**：卡库、卡组、规则、收藏、同步等核心链路完整；`pnpm check` 0 错误 0 警告。
- **新增模块**：心愿单、借出/借入（含联系人）、购买清单（含数量对账与写回）、卡柜、开包模拟器、扫码、计分器，均已有完整仓储层 + 页面，非桩代码。
- **明确缺口**：① 多设备玩家数据同步仅设计稿（`docs/player-data-sync.md` 标注「待实施」）；② 无自动化测试/CI；③ 无应用自动更新机制；④ 老用户启动不自动检查内容更新（仅手动）。
- **结论**：功能覆盖足以进入**小范围 Beta（内部测试 → Closed Beta）**，但需先修复少量阻塞项并明确 Beta 边界（详见 `beta-readiness.md`）。

## 主要模块划分

| 模块 | 路由 | 状态 |
| --- | --- | --- |
| 卡牌库（搜索/筛选/排序/卡图） | `/cards` | 已实现 |
| 收藏（统计/系列/缺卡/历史/自定义打印） | `/collection`、`/[seriesCode]`、`/missing`、`/history` | 已实现 |
| 心愿单 | `/collection/wishlist` | 已实现（较新） |
| 借出/借入 + 联系人 | `/collection/loans` | 已实现（较新） |
| 购买清单 | `/collection/purchase-lists`、`/[listId]`、`/new`、`/edit` | 已实现（较新） |
| 卡组 + 构建器 + 持有检查 | `/decks`、`/decks/builder`、`/decks/[deckid]` | 已实现 |
| 对局记录 | `/decks/[deckid]/records`、`.../records/[matchid]/logs` | 已实现 |
| 卡柜（Locker） | `/locker` 及子路由 | 已实现 |
| 规则书 | `/rules`、`/rules/[slug]` | 已实现 |
| 对战工具（骰子 / 计分器） | `/tools/dice`、`/tools/gameCounter` | 已实现 |
| 扫码导入 | `/scanner`（移动端） | 已实现 |
| 开包模拟器 | `/simulator`（+404 彩蛋） | 已实现 |
| 设置 / 备份 / 数据管理 / 日志 / 反馈 | `/settings` | 已实现 |
| TTS 联动 | 侧栏入口（默认隐藏，`showTTSFeatures`） | 已实现（可选） |
