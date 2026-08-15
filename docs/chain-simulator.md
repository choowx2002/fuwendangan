# 结算链模拟器设计文档（Rune Archive）

> 状态：设计中（待实施）
> 版本：v1.4（2026-08-14 修订：区域可折叠（眼睛按钮，设置可关）；卡图 100% 宽度贴附；拖拽本地镜像修复）
> 参考：社区工具 [rune-chain-tools.pages.dev](https://rune-chain-tools.pages.dev/)（Chaintools）
> 范围：**纯本地演示工具，不参与内容同步，不改 DB schema**；状态持久化到 `tools.json`，支持剪贴板 + 文件导入导出。
> 决策：纯自由拖拽（无自动流转按钮）；手动快照历史（玩家点击「记录」才入栈，供撤销/重做与演示翻阅）；导入导出剪贴板 + 文件双载体；演示模式 = 全屏 + 左右键翻快照；支持 2-4 人对局。

---

## 1. 背景与目标

《符文战场》对局存在明确的结算链（Stack）机制：打出卡牌 → 待处理 → 上链 → 结算 → 落位。线下/教学场景需要一块可视化棋盘，直观演示结算过程。

参考站 Chaintools 已实现单页面结算链工具（6 区域 + 玩家标记 + 历史快照 + 导入导出 + 演示模式），但其区域与玩家数固定（2 人、基地/战场各 1）。本设计在参考站基础上扩展：

1. **支持 2-4 人对局**：基地、手牌、弃牌堆、放逐按玩家各一组。
2. **战场最多 3 个**：共享战场，双方单位可同场。
3. **区域可配置**：玩家数 / 战场数 / 区域开关 / 自定义区域。
4. **纯自由操作**：不做任何自动化流转，玩家用拖拽自由摆放到任意区域。
5. **导入导出**：版本化 JSON，剪贴板 + 文件双载体，供演示与复盘。

**非目标**：不接入任何同步（内容同步 / 玩家数据同步均不涉及）；不改 `config/schema.ts`；不新增 Rust command（文件读写 / 剪贴板能力已存在）。

## 2. 区域模型

区域分三类，全部可折叠/隐藏：

### 2.1 共享区域（全局唯一）

| 区域              | 语义                  | 展示           |
| --------------- | ------------------- | ------------ |
| 结算链 `chain`     | 已上链项（LIFO 栈，后放先结）   | 栈顶大卡 + 折叠栈列表 |
| 结算中 `resolving` | 正在结算的单项             | 单格 + 归属玩家标记  |
| 待处理效果 `pending` | 打出但未完成上链的项（FIFO 队列） | 队首 + 展开列表    |

### 2.2 每玩家区域（× 玩家数，2-4）

| 区域            | 说明                            |
| ------------- | ----------------------------- |
| 手牌 `hand`     | 每人一组                          |
| 基地 `base`     | 每人一组（4 人对局 → 基地最多 4 个）        |
| 弃牌堆 `discard` | 每人一组（即"废牌"）                   |
| 放逐 `banish`    | 每人一组                          |
| 牌库 `deck`     | **可选区域，默认关闭**，设置里可开启（演示抽牌流程用） |

### 2.3 战场与自定义

- **战场 `battlefield`**：1-3 个共享战场（`bf0` / `bf1` / `bf2`），双方（多方）单位可同场；数量可在设置中配置，默认值随玩家数给建议（2 人默认 2，3-4 人默认 3），可改。
- **自定义区域**：支持新建命名区域（共享或每玩家一组），用于规则扩展产生的其他归属（如"待结算区""保留区"等"各种的"场景）。

## 3. 数据模型

纯前端状态，结构化存储（不写 SQLite）。

```ts
interface ChainItem {
  id: string                 // 雪花ID
  cardNo?: string            // 引用本地卡牌（cards_base.card_no），空则纯自定义条目
  customName?: string        // 自定义条目名称（效果/技能条目，如"光明未来"的多步效果）
  owner?: 0 | 1 | 2 | 3      // 玩家归属（可空 = 未标记）
  targetZone?: string        // 自定义条目「结算后去向」区域 key
}

interface SimState {
  playerCount: 2 | 3 | 4
  battlefieldCount: 1 | 2 | 3
  shared: {
    chain: ChainItem[]
    resolving: ChainItem[]
    pending: ChainItem[]
  }
  players: {
    hand: ChainItem[]
    base: ChainItem[]
    discard: ChainItem[]
    banish: ChainItem[]
  }[]                       // 按玩家下标 0..playerCount-1
  battlefields: ChainItem[][]   // 下标 0..battlefieldCount-1
  customZones: {
    id: string
    name: string
    perPlayer: boolean      // true = 每玩家一组，false = 共享
    items: ChainItem[]
  }[]
  customPool: ChainItem[]             // 侧栏自定义条目池（纯文本效果条目）
  extra: { deck: ChainItem[] } | null   // 可选牌库，默认 null
  displayMode: 'auto' | 'text' | 'image' | 'both'  // 全局显示偏好，默认 'auto'
}
```

区域 key 约定：`chain` / `resolving` / `pending` / `bf0..bf2` / `p<玩家下标>-hand|base|discard|banish|deck` / 自定义区域 id（每玩家自定义区域地址为 `自定义id#<玩家下标>`）。每玩家自定义区域渲染时按 owner 分组展示（未标记项归玩家 1）。

### 3.1 校验与兼容

- 导入时按 `playerCount` / `battlefieldCount` 重建区域结构，多余 key 丢弃。
- 类型守卫逐层校验（对齐 `stores/tools.ts` 现有 `isScoreCounterState` 模式）。
- 版本号不匹配/校验失败时拒绝导入并 toast 报错。
- `targetZone` 须指向重建后的有效区域 key，否则回退为 owner 的弃牌堆。
- `cardNo` 引用的卡在本地库下架/缺失时，渲染降级为文本卡名（卡图不裂）。
- **玩家数/战场数减少的迁移规则**：变更前弹确认提示；被移除区域非空时要求先清空，或确认后整体转移至各自 owner 的弃牌堆（被丢弃项 toast 提示）。

## 4. 自由操作语义

**无任何自动化**：不做「完成打出 / 开始结算 / 结算完成」流转，也没有结算去向弹窗。全部操作由玩家拖拽完成：

- 拖拽（`@thisux/sveltednd`）支持任意区域间跨区移动与区域内排序。
- 卡牌来源入口：侧栏搜索/自定义条目点击后加入「待处理」区，玩家随后自由拖到任意区域。
- 玩家在演示/讲解时自行决定每个条目的位置（如法术拖到弃牌堆、单位拖到战场或基地），工具不做规则判断。

## 5. 核心交互

- **卡牌来源**：
  - 右侧栏搜索本地卡库（`searchCards` + `getBestPrint` + 图片缓存），点击加入「待处理」区，再自由拖拽；
  - 自定义条目池（`customPool`）：纯文本效果条目，可设置 owner（`targetZone` 字段保留以兼容旧存档，UI 不再提供设置）。
- **玩家归属**：每项带玩家角标与底色（2-4 人配色）。
- **显示偏好**：区域头部不含任何切换控件；显示方式在**设置弹窗**中全局配置（`displayMode`）：`'auto'`（推荐）按区域类型智能分区默认——结算链/战场/基地看卡图、手牌/弃牌/除外/牌库/待处理看文本、结算中图文兼顾；或全局统一 `text` / `image` / `both`。由 `resolveZoneMode(pref, key)` 解析。
- **大图查看**：点击（桌面）/ 长按（移动端）查看卡牌大图。
- **区域折叠（闭眼）**：每个区域头部有眼睛按钮，点击收起/展开条目列表（状态不持久化）；可在设置弹窗关闭「区域折叠」（演示模式不显示按钮）。卡牌条目卡图 100% 贴附卡片宽度。
- **区域管理**：设置弹窗（CommonModal）内配置玩家数、战场数、区域开关、自定义区域增删、牌库开关、显示偏好、区域折叠；弹窗顶部含操作帮助文本（拖拽/大图/手动记录/演示键位/历史弹窗入口）。

## 6. 历史快照 + 导入导出

### 6.1 快照历史（手动记录）

- **变更不自动入栈**：所有增/删/移/配置修改只改当前状态，写入快照历史仅当玩家点击顶栏「记录」按钮（`snapshotNow()` → `snapshotForChange`）。
- 快照为全量结构化副本，上限 50，超出丢弃最旧。
- undo / redo 支持（past / present / future 三态），基于手动快照点。
- 演示模式：左右键在手动快照间前后翻页，退出即回到编辑态当前位置。

### 6.2 导出格式（版本化 JSON）

```json
{
  "type": "chain-sim",
  "version": 1,
  "savedAt": "2026-08-14T10:00:00+08:00",
  "playerCount": 2,
  "battlefieldCount": 2,
  "shared": { "chain": [], "resolving": [], "pending": [] },
  "players": [
    { "hand": [], "base": [], "discard": [], "banish": [] },
    { "hand": [], "base": [], "discard": [], "banish": [] }
  ],
  "battlefields": [[], []],
  "customZones": [],
  "customPool": [],
  "extra": null,
  "displayMode": "auto"
}
```

### 6.3 载体

- **导出**：序列化 → 剪贴板（`plugin-clipboard-manager`，参考 decks 页）或存文件（`write_text_file` command + 对话框）。
- **导入**：剪贴板读取（`plugin-clipboard-manager`）或文件读取（`read_text_file` command）→ 版本 + 类型守卫校验 → 重建状态（含历史，导入结果作为新 present）。

## 7. 演示模式

- 隐藏侧栏 / 工具栏 / 区域折叠，沉浸式大卡展示当前状态。
- **左右方向键**在历史快照间前后步进，逐步还原对局，适合复盘讲解。
- 与编辑状态互斥：进入演示模式前自动保存当前状态为快照末尾。
- 左右键步进**复用 undo/redo 的同一份快照历史与索引**（非独立机制），退出演示模式即恢复编辑态当前位置。

## 8. 持久化

- 状态与守卫放 `src/lib/simulator/chain.ts`（`chainSimulatorState`），从 `$lib/stores/tools.ts` **引入** `persistentWritable('chainSimulator', …)`（不复制实现）自动落盘到 `tools.json`（每次变更即 save）。
- 启动时类型守卫校验 + 归一化（对齐 `scoreCounterState` 的旧数据兼容处理）。
- 崩溃/重启可恢复，适合演示前离线准备。

## 9. 布局（响应式）

- **桌面**：
  - 顶排 = 结算链 / 结算中 / 待处理（焦点区）；
  - 中排 = 战场 1-3；
  - 下排 = 玩家区域网格（2 人并排，3-4 人 2×2，含手牌/基地/弃牌堆/放逐/可选牌库）。
- **移动端**：共享区固定顶部 + 玩家 Tab 切换（每玩家一屏 4 区域）+ 战场横滑。
- 所有区域可折叠，配置变化时网格自适应重排。

## 10. 复用与改动清单

### 10.1 复用（不新增）

| 能力        | 来源                                                                      |
| --------- | ----------------------------------------------------------------------- |
| 卡牌搜索 / 卡图 | `searchCards` / `getBestPrint` / 图片缓存（`$lib/db` 统一导出）                   |
| 拖拽        | `@thisux/sveltednd`（`SortModal.svelte` 已有先例）                           |
| 弹窗        | `CommonModal`                                                           |
| 持久化       | `stores/tools.ts` 的 `persistentWritable`                                |
| 剪贴板 / 文件  | `plugin-clipboard-manager` / `write_text_file`、`read_text_file` command |
| 全屏工具页模式   | `gameCounter` / `dice` 页先例                                              |

### 10.2 改动清单

1. 新建 `src/routes/simulator/chainSimulator/+page.svelte`（全屏工具页，自绘返回键；操作区拆分为 `src/lib/components/simulator/chain/` 下组件：区域列 / 卡牌项 / 侧栏 / 历史面板）。
2. `src/lib/simulator/chain.ts`：`ChainItem` / `SimState` 类型 + 默认状态工厂 + 动态校验守卫（按 playerCount / battlefieldCount 重建区域结构）+ 快照历史（past/present/future、上限 50）+ `serializeSimState` / `parseSimImport` + `chainSimulatorState`（从 `$lib/stores/tools.ts` 引入 `persistentWritable`）。
3. **`/simulator` 路由重构为枢纽页**（对齐 `tools/+page.svelte` 卡片网格，`simulatorCards` 含开包模拟 + 结算链模拟器）；开包模拟迁至 `src/routes/simulator/packOpener/+page.svelte`（保持现有非全屏布局），并在 `src/lib/utils/route-config.ts` 登记新路由。
4. `src/locales/zh-CN.json` + `en.json`：`simulator` 段新增 i18n keys（title/desc/chainTitle/chainDesc/区域名/记录/撤销重做/历史/设置/演示/导入导出/帮助文本等）。
5. `src/lib/components/AppShell.svelte`（`:48-54`）：全屏排除列表登记 `/simulator/chainSimulator`。
6. 设置弹窗（CommonModal）：玩家数 / 战场数 / 区域开关 / 自定义区域管理 / 牌库开关（含玩家数/战场数减少的迁移确认）。

### 10.3 明确不改

- 无 Rust 改动（文件/剪贴板 command 已存在）。
- 不改 `config/schema.ts`、不建新表、不碰 5 张同步表与 version 行。
- 不接入玩家数据同步（此数据为演示工具，跨设备由导入导出承担）。

## 11. 验证方式

- 前端：`pnpm check`（svelte-check，strict）。
- 手动走查（`pnpm tauri dev`）：拖拽跨区、手动「记录」快照 → undo/redo、演示模式左右键翻快照、剪贴板 + 文件导出导入往返、4 人 + 3 战场布局、玩家数/战场数增减迁移、自定义区域与牌库开关、重启后状态恢复。
- 仓库无测试框架，不提供测试脚本。
