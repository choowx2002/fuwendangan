# Rift Atlas 对局复盘：导入 / 覆盘 / 结果并入记录 — 设计方案

> 版本：v2.1（设计稿定稿，未动代码）
> 素材：`rift-atlas_all_*.json`（Rift Atlas 扩展导出）、`replay.html` + `cards-data.js`（临时 demo）、本仓库现有架构
> 对局来源：**符文战场（Riftbound TCG）**；应用：符文档案（Rune Archive）
> 本文所有结构均为对真实文件的**实测结论**（附证据），不是假设。

---

## 0. 核心结论（先看这个）

1. **一个房间（roomCode）= 一局游戏**。同一房间内的多条 game 记录 = 同一局游戏的
   **断线重连产生的多个 session**，必须合并回放、合并记录（§2.2 有序列号证据）。
2. **导出文件没有任何胜负字段**，且本游戏没有基地 HP 之类可判定的终局状态 →
   **结果以用户确认为唯一依据**，自动判定只做「比分预填」弱提示（§8）。
3. **卡组绑定只有两种选择**：绑定已有卡组（含相似度推荐）／不绑定（仅复盘，结果不入记录）。
   **不做自建卡组**。
4. **并入记录**：一局游戏（一个房间）→ **一条 BO1 记录**（best_of=1，一个小局）。
   **BO1 以上的合并本期不做**（多局合并为 BO3 等留待后续）。
5. **界面文案中文为主**（zh-CN 母版 / en 对照）；游戏内容（解说、卡名、卡组文本）为英文数据原样展示。
6. **入口**：首页「更多」网格 + `/simulator` 页卡片 + 新路由 `/replay`。
7. **未完成局不静默剔除**：并入弹窗里显示显眼提示（「未完成 — 请确认结果」），
   用户确认结果后可并入。
8. **比分预填两处都展示**：对局卡片摘要 + 并入弹窗逐局行。

---

## 1. 目标与范围

给「符文档案」增加一条新能力线：**Rift Atlas 对局导入与复盘**。

- 玩家导入 Rift Atlas 扩展导出的 JSON 文件（当前文件含 6 条 websocket 会话记录 = 2 局游戏）。
- 导入时选择**绑定已有卡组**（用于卡组归属与战绩并入），或**不绑定**（仅复盘，不入战绩）。
- 文件内对局按房间分组展示（一房一局），玩家**选择要对局复盘**进入查看器。
- 复盘查看器：合并同一局内全部 session 的事件连续回放；游戏内容英文原样展示，
  界面文案走 i18n（zh-CN 母版 / en 对照）。
- 卡图通过**卡号 + 本地 SC 版卡图（`card_prints`，language='SC'）**渲染，缺卡回退远端 CDN。
- 复盘结果可**并入现有对局记录**：每局（每房间）→ 一条 BO1 记录（best_of=1 + 一个小局）。

**非目标（本期）**：不做云端回放分享、实时观战、回放文件持久化（见 §11 M3）、自建卡组、
**多局合并为 BO3 等 BO1 以上赛制**（留待后续）。

---

## 2. 素材分析（实测结论）

### 2.1 导出 JSON 结构

```jsonc
{
  "meta": { "exporter": "Rift Atlas 对局记录器", "version": "0.2.0", "exportedAt": "..." },
  "matchCount": 6,          // 注意：是「会话」数，不是对局数！
  "eventCount": 3750,
  "matches": [
    {
      "sessionId": "s-msw1ttk1-1-at3i",
      "roomCode": "EMSBW",          // 房间号：一局游戏的标识
      "url": "wss://.../matchmaking/enam-v2-constructed-all-bo1?_pk=...",  // matchmaking 会话
      "startedAt": 1786899504097, "endedAt": ..., "durationMs": ...,
      "state": "complete", "reason": "socket-closed", "closeInfo": {...},
      "stats": { "sent": 391, "received": 851, "typeHist": {...} },
      "events": [
        { "seq": 1, "ts": ..., "direction": "in|out", "kind": "string", "size": 1037,
          "type": "authoritative_patch_commit",   // 也见 authoritative_snapshot / presence_event / ...
          "payload": "<JSON 字符串>" }            // ⚠️ payload 是字符串，需 JSON.parse
      ]
    }
  ]
}
```

### 2.2 关键认知：session ≠ 对局（断线重连证据，实测）

同一 `roomCode` 下的多条记录 = **同一局游戏的不同 websocket session**（断线重连）。
证据（`5HMU3` 房间，按 startedAt 排序）：

| #   | sessionId        | 类型        | 快照 sequence 范围 | 末补丁 seq | 与前一条间隔          |
| --- | ---------------- | ----------- | ------------------ | ---------- | --------------------- |
| 0   | `s-mswt6kny-1-…` | matchmaking | 无                 | —          | —                     |
| 1   | `s-mswt6lay-2-…` | game        | 0 → 89             | **155**    | 匹配结束后 0.5s       |
| 2   | `s-mswtk9nn-3-…` | game        | **155**            | **175**    | 上一条结束后 **1.1s** |
| 3   | `s-mswtm08x-4-…` | game        | **175** → 312      | **388**    | 上一条结束后 **1.1s** |

- **sequence 无缝衔接**：session 2 首快照 seq=155 = session 1 末补丁 seq；session 3 首快照 seq=175 = session 2 末补丁 seq —— 是同一局状态的延续。
- **间隔 ≈1.1s**：即时重连，非新开一局。
- **双方 playerId 完全一致**（`plr_23e100f1` / `plr_d445bfd8`）。

结论：

- **分组键 = roomCode**；组内所有 game session 的 events **合并、按 ts 排序** 后作为一局回放
  （demo 的 `buildReplay` 正是这么做的，直接复用）。
- `matchCount=6` 只代表 6 条会话 = **2 局游戏**（EMSBW 1 局 / 5HMU3 1 局）。
- 组内 session 数 = 重连次数 + 1（`5HMU3` 重连 2 次）。

### 2.3 事件与回放机制

- payload 均为字符串，必须 `JSON.parse`；解析失败/非对象的事件跳过（demo 已有防御）。
- 关键事件：
  - `authoritative_snapshot`：完整状态快照 `{type, gameInstanceId, sequence, snapshot, gameplayLog}`；
    `snapshot` 含 `phase / players / roomMode / gameVariant / playMode / chainEntries` 等。
  - `authoritative_patch_commit`：增量补丁 `{baseSequence, sequence, action, patch:{operations}, clientActionId}`。
    operation 类型实测：`zone_insert / zone_remove / zone_move / zone_reorder / patch_card_fields /
unset_card_fields / set_player_fields / set_board_fields / set_room_fields / unset_room_fields /
chain_insert / chain_remove / chain_replace / log_insert / log_remove`。
  - `log_insert` 的 `entries[].text`：**英文游戏解说**（narration 数据源）。
- 重连后服务器会重发全量快照（新 session 的首个快照），所以**多 session 合并后 base 快照天然衔接**，
  回放算法无需特殊处理；仅在 narration 里插入「连接中断/重连」标记（§6.2）。
- 玩家结构（snapshot.players[]）：
  - 有卡组信息的玩家带 `decklistRaw`（官方文本格式）、`deck.sections`
    （`legend / champion / mainDeck / battlefield / rune / sideboard`，每项 `{count, name, cardCode}`）、
    `board`（`score / floatingEnergy / floatingPower / legendXp / deck / hand / base / trash / banished /
battlefieldA|B|C / battlefieldToken / champion / legend / runeDeck / runeArea / deckPeek`）。
  - 无卡组信息的玩家只有 `id / seat / name / joinedAt / sealedFormatId / board`（对手卡组不可见时）。
  - 卡对象：`{id, name, source, ownerPlayerId, exhausted, createdAt, cardCode, type, isPlaceholder, ...}`；
    隐藏区为 `__hidden_zone__:{playerId}:{zone}:{index}` 占位。
- 「我方」识别（可靠）：matchmaking 会话的 `start`/`matched` 带 `playerId`/`playerName`；
  游戏快照里 `players.find(p => p.decklistRaw)` 通常即我方（本文件两局我方都是 `UMA`）。
- matchmaking 会话另有 `matchFormat`（实测恒为 `"bo1"`，天梯队列赛制，仅作展示标注）。

### 2.4 ⚠️ 结果信号：不存在（实测）

- 全部 session `reason='socket-closed'`，最后快照 phase 仍 `in_game`；日志无 won/defeat/victory/concede 字样。
- 本游戏**没有基地 HP**（`base` 只是「基地上的单位」区域），无可判定的终局状态。
- 6 条 `error` 事件均为 `stale_action_state`（重同步提示），与结果无关。
- ⇒ **结果必须由用户确认**（§8）。

### 2.5 demo replay.html 的可复用逻辑

| 模块                                                 | 说明                                                           | 去向                                            |
| ---------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| `groupByRoom`                                        | 按 roomCode 分组（= 一局）                                     | 直接复用（TS 化）                               |
| `buildReplay`                                        | 合并组内全部 events 按 ts 排序 → snapshot/patch 帧 + narration | 复用核心（+ 重连标记）                          |
| `applyOp` / `applyFrame` / `stateAt`                 | 快照 + 补丁回放，任意帧还原状态                                | 复用核心                                        |
| `selfIdFromState` / matchmaking playerId             | 我方识别                                                       | 复用                                            |
| `cardHTML` / `zoneRow` / `boardHTML` / `renderChain` | 卡牌与版面渲染                                                 | 重写为 Svelte 组件（§7）                        |
| 播放器（play/pause/step/scrub/速度/键盘）            | 帧推进                                                         | 重写为 Svelte 组件                              |
| `cards-data.js`                                      | 卡号静态映射                                                   | **不引入仓库**；本地 SC prints + 远端回退（§7） |

### 2.6 应用现有能力（可大量复用）

- **卡组绑定**：`getDecks()` 列出已有卡组；卡号重叠度推荐（§5.3）。
- **卡图解析**：`getCardAndPrintByPrintCode / getCardAndPrintByCardNo`、`getBestPrint`、
  `printCacheName`、`CardSimpleImage.svelte`；`normalizeSignedSuffix()`（`VEN-193S`→`VEN-193*`）。
- **文件选择**：Tauri `@tauri-apps/plugin-dialog` `open()` + `readTextFile`（见 settings 页），
  Web `<input type=file>` 兜底（`isTauri` 分支）。
- **跨页传数据**：`src/lib/stores/deck-import.svelte.ts` 的 pending 模式可仿。
- **记录写入**：`createMatch(input, games)` / `updateMatch` / `getMatchesByDeck`，
  `match_records` + `match_games`，同步实体 `user-sync/entities/matches.ts`（LWW + 墓碑 `'match'`）。
- **i18n**：`svelte-i18n`，`src/locales/zh-CN.json` + `en.json` 键一一对应，设置页可切语言。

---

## 3. 总体流程（用户旅程）

```
┌─ 入口：首页「更多」网格 + 模拟器页卡片 + 新路由 /replay
│
├─ 1. 导入页 /replay
│     ├─ 选择文件（.json：Tauri dialog / Web file input / 拖拽）
│     ├─ 解析校验（meta + matches 数组）
│     ├─ 卡组绑定（二选一）：
│     │     a) 绑定已有卡组（列表 + 卡号相似度推荐）
│     │     b) 不绑定 → 仅复盘（提示：结果不会写入对局记录）
│     └─ 对局列表（roomCode 分组，一房一局卡片：BO 徽标、对手、时长、session/重连数、
│         事件数、比分摘要），勾选 → 「复盘」 / 「并入记录」
│
├─ 2. 复盘查看器 /replay/[sessionKey]
│     ├─ 顶栏：传输控制（⏮ ◀ ▶/⏸ ▶ ⏭、速度、进度条、帧标签、在线卡图开关）
│     ├─ 主区：我方版面（上对手/下我方）＋ 中央（回合/阶段/Chain）
│     ├─ 侧栏：英文对局解说（含「连接中断 · 已重连」分隔标记）
│     └─ 浮层：标记本局结果（W/L/D/未完成）
│
└─ 3. 结果确认并并入（RecordImportModal）
      ├─ 每局（每房间）一行：比分预填 + 结果确认 + 先手；未完成局带显眼提示
      ├─ 去重检查（同一房间重复导入）
      └─ 写入 match_records / match_games（createMatch，best_of=1），战绩统计自动生效
```

---

## 4. 数据模型设计

### 4.1 本期：不新增业务表（临时解析 + 标记去重）

- 导入 JSON **解析后驻留内存**（2.4MB，`JSON.parse` 一次几十 ms），经
  `src/lib/stores/replay-import.svelte.ts` 跨页传递，**不落库**。
- 复盘查看器每次从 store 原始数据重建（`buildReplay` 纯函数）。
- **去重标记**：`match_records` 新增一列本地字段（老库 `ensureColumn()` 补列）：
  ```sql
  ALTER TABLE match_records ADD COLUMN source_replay_id TEXT;  -- 'ra:{roomCode}:{最早 startedAt}'
  ```
  一局（一房间）一个值。该列**不参与** user-sync（`matches.ts` 显式列映射天然忽略，安全）。

### 4.2 复用现有记录表（零改动）

并入走现有 `createMatch`：

| `match_records` 字段                         | 来源                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `deck_id`                                    | 玩家绑定的已有卡组；不绑定则不允许并入                                       |
| `player_name`                                | 我方名字（snapshot 玩家 name，如 `UMA`）                                     |
| `group_name`                                 | 房间号（如 `5HMU3`），或合并系列时自定义                                     |
| `opponent_name`                              | 对手玩家 name                                                                |
| `opponent_deck`                              | 对手 `decklistRaw`（存在时）或「未知」                                       |
| `opp_legend_id / _print_id / _name / _image` | 对手 `deck.sections.legend[0].cardCode` → 本地 SC print 解析，失败仅存 name  |
| `deck_version_id / number`                   | 绑定卡组当前版本（确认弹窗可改）                                             |
| `best_of`                                    | **恒为 1**（本期只做 BO1）                                                   |
| `note`                                       | 预填：`Rift Atlas 导入 · {roomCode} · 队列{queueFormat} · {exporterVersion}` |
| `played_at`                                  | 组内最早 `startedAt`（ISO）                                                  |

| `match_games` 字段     | 来源                                               |
| ---------------------- | -------------------------------------------------- |
| `game_number`          | 恒为 1（每局一条记录、一个小局）                   |
| `my_score / opp_score` | 该局最终重建状态双方 `board.score`（预填，可改）   |
| `win_type`             | `'normal'`                                         |
| `is_win`               | **用户确认结果**（推断只做预填）                   |
| `is_first`             | 快照 `room.firstPlayerId === 我方 id`；缺失留 NULL |
| `win_reason`           | 备注：`user-confirmed` / `score:{my}:{opp}` 等     |
| `log`                  | 该局 narration（英文解说）截断存储                 |

---

## 5. 导入页与对局选择界面（/replay）

### 5.1 页面骨架（新文件）

```
src/routes/replay/+page.svelte                 # 导入 + 对局列表 + 操作入口
src/lib/replay/
  import-parser.ts        # 文件 → ImportBundle（校验/分组/自识别/比分预填）
  replay-engine.ts        # buildReplay / applyOp / stateAt（demo 逻辑 TS 化）
  records-builder.ts      # ImportBundle + 用户确认 → createMatch 入参（§8.3）
  types.ts                # ImportBundle / ReplayGroup / ReplayFrame / GameDraft ...
src/lib/stores/replay-import.svelte.ts   # 跨页传递（仿 deck-import.svelte.ts）
src/lib/components/replay/
  ReplayImportDropzone.svelte
  DeckBindPanel.svelte       # 二选一（绑定已有 / 不绑定）
  ReplayGroupCard.svelte     # 一局一张卡片
  ReplayViewer.svelte        # 复盘查看器主组件
  ReplayBoard.svelte / ReplayCard.svelte / ReplayNarration.svelte
  RecordImportModal.svelte   # 结果确认 + 合并策略 + 写入（§8.3）
```

### 5.2 对局卡片信息（一房一局）

- 徽标：`BO1`（本局单场；副标：队列赛制，如 `队列 BO1`——实测恒为 bo1）
- 对手名、我方名
- 时间：最早 `startedAt` → 本地时间；总时长（最后 `endedAt - 最早 startedAt`）
- **重连信息**：`{n} 个 session · 重连 {n-1} 次`（本样本 5HMU3 显示「3 个 session · 重连 2 次」）
- 事件数（全部 session 合计）、比分预填摘要（如 `比分 7 : 8`，标注「待确认」）
- 卡组匹配提示：与已选卡组主牌卡号重叠度（如 38/40）

### 5.3 卡组绑定（二选一，无自建）

1. **绑定已有卡组**：列表展示 `getDecks()`，按「推荐分」排序 —— 用本局我方
   `deck.sections.mainDeck` 卡号集合与该卡组 `deck_cards` 卡号集合做命中率计算，
   命中率 > 0.7 标「高匹配」徽标。
2. **不绑定**：置灰「并入记录」入口，仅可复盘；界面明确提示「不绑定则结果不会写入对局记录」。

---

## 6. 复盘查看器设计（/replay/[sessionKey]）

### 6.1 数据流

```
store(ImportBundle) ──[sessionKey=roomCode]──▶ ReplayViewer
  └─ replay-engine.buildReplay(group) → { frames, snapshots, narration, selfId, roomCode,
                                          sessionBoundaries }   // 帧跨 session 无缝衔接
  └─ stateAt(i) → 帧状态（base snapshot + 增量补丁）
```

- 播放状态机：`current / playing / speed / timer`，速度 0.5/1/2/4×，空格/←/→/Home/End，
  进度条 scrubbing —— 照搬 demo 交互语义。
- 帧标签：`帧 {i+1}/{n} · seq {seq} · {phase} · 回合 {turnNumber}`（i18n）。
- 顶部：房间号、对手名、双方传奇卡小图 + 名字、当前比分、重连次数徽标。

### 6.2 版面

- **我方在下、对手在上**（demo 布局），中央栏 = 回合/阶段 + Chain（`chainEntries`）。
- 每侧：`champion / legend / base` 区 → 三条战场（A/B/C + token）→ 符文区/符文牌库/牌库（背面计数）/
  弃牌堆/放逐区 → 手牌（我方可见、对手背面）。
- 卡牌元素：能量费用、战力（might）、疲劳（旋转/灰度）、白/红计数器 —— 与 demo 一致，样式并入应用主题。
- **在线卡图开关**沿用 demo（关闭本地 SC 图源后走远端 CDN，§7）。
- 解说侧栏：narration 按时间戳滚动，**英文原文**；在 session 边界处插入
  `—— 连接中断 · 已重连 ——`（i18n 分隔行 + 重连时间）。
- 每局结尾浮层：`本局无记录结果（连接已断开）` → 标记胜负 / 标记未完成 / 并入记录（§8.3）。

### 6.3 空态与异常

- 组内无任何可回放 session（只有 matchmaking）→ 提示并禁用。
- 无快照但有补丁 / 无补丁但有快照 → 提示「数据不完整，可能只能看到开局」。
- 事件 payload 大量解析失败 → 显示解析失败统计。
- session 间间隔异常大（如 > 2 小时，疑似房间号复用）→ 提示「可能是两局，建议拆分」。

---

## 7. 卡图渲染方案（卡号 + 本地 SC card prints）

**渲染管线（仅本地库，无 CDN/外部数据源）：**

```
1. 本地 SC 版卡图（唯一图源）
   game cardCode（如 "VEN-193S" / "OGN-045"）
   → 检索候选（按顺序取首个命中）：
     a) 原卡号（"VEN-193S"）
     b) 签名后缀规整（"VEN-193S" → "VEN-193*"，应用本地 `*` 约定）
     c) 基础卡号（截取前 7 位："VEN-193S" → "VEN-193"）← 变体/签名卡的主要命中路径
   → card_prints WHERE card_no_extend = ? AND language = 'SC' → 关联 cards_base（cardbase）
   → img_cdn → 本地缓存加载（printCacheName 命名）
2. 占位卡背：应用现有卡背资源（如 /blue.jpg）
```

**要点：**

- 名称/费用/战力/类型元数据取本地 `cards_base + card_prints`（一次批量查，
  `Map<code, {print, base}>`）；本地缺失时用**事件数据自带字段**（卡对象 `name/type`、
  `deck.sections` `name`）兜底 —— 保证本地库无卡也能复盘，只是无图。
- 隐藏区/对手手牌渲染为卡背，不计入解析。
- **不使用 cards-data.js，不引入远端 CDN**：卡数据一律以应用本地库为准
  （实测签名变体卡号 `VEN-193S.webp` 在 CDN 上 404，截取前 7 位检索本地卡图才是可靠路径）。

---

## 8. 结果并入记录（每局 → 一条 BO1）

### 8.1 原则

导出无胜负信号（§2.4），故：**比分只做预填，结果以用户确认为准**；
`abandoned`（未完成）局**不静默剔除**：并入弹窗中显示显眼提示，用户确认结果后可并入。

### 8.2 每局预填（import-parser.ts）

对每局（每房间）做**最终状态重建**（末快照 + 后续补丁）：

| 信号     | 规则                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 比分     | 最终 `board.score` 双方数值 → 预填 `my_score/opp_score`（**对局卡片 + 并入弹窗两处展示**），结果默认「待确认」 |
| 显式结果 | 若扩展未来版本加 `result?: {winnerPlayerId, reason}` 字段 → 直接采用（预留读取位）                             |
| 无信号   | 当前格式下全部如此 → 默认 `未完成（待确认）`，带显眼提示                                                       |

### 8.3 并入记录（records-builder.ts + RecordImportModal）

1. **选择要并入的局**（默认全选可回放局；`未完成` 局**保留在列表里并显示显眼提示**
   「未完成 — 请确认结果」，确认 W/L/D 后并入）。
2. **逐局确认**：结果（W/L/D）、比分（预填，两处展示）、先手、`win_type`、备注。
3. **每条记录 = 一局**：1 条 `match_records(best_of=1)` + 1 条 `match_games(game_number=1)`。
   **本期不做多局合并**（BO3 等留待后续）。
4. **去重**：按 `source_replay_id`（每房间一个）查重；已存在 → 「已导入过」，
   可选「更新（updateMatch 重写小局）」或「跳过」。
5. **写入**：`withTransaction` 批量 `createMatch`。
6. **完成反馈**：列出写入记录，链接跳转 `decks/[deckid]/records`；战绩统计与分析自动生效。
7. **未绑定卡组**：并入按钮禁用，提示先绑定。

---

## 9. i18n 设计（中文为主 + 双语键）

### 9.1 原则

- 游戏内容（解说日志、卡名、卡组文本）是**英文数据，原样展示**，不翻译、不入词表。
- 界面文案**以中文为主（zh-CN 为母版）**，新增 `replay.*` 命名空间，
  `zh-CN.json` 与 `en.json` **键一一对应**，en 为对照翻译；跟随设置页语言切换。
- demo 的中文硬编码直接作为 zh-CN 文案来源，再补 en。

### 9.2 键位草案（zh 母版示例）

```jsonc
"replay": {
  "title": "对局复盘",
  "importTitle": "导入 Rift Atlas 复盘",
  "dropHint": "将 Rift Atlas 导出的 JSON 文件拖到这里\n或点击选择文件",
  "parseFailed": "解析失败：{error}",
  "noMatches": "文件中没有对局记录（缺少 matches 数组）",
  "fileInfo": "{file} · {games} 局 · {events} 个事件 · 导出于 {time}",
  "deckBindTitle": "绑定卡组（可选）",
  "deckBindExisting": "绑定已有卡组",
  "deckBindNone": "不绑定（仅复盘）",
  "deckBindNoneHint": "不绑定则结果不会写入对局记录。",
  "deckMatchScore": "高匹配（主牌重叠 {pct}%）",
  "groupTitle": "对局列表",
  "groupBo": "BO{n}",
  "groupQueueFormat": "队列 {format}",
  "groupSessions": "{n} 个 session",
  "groupReconnects": "重连 {n} 次",
  "groupScoreHint": "比分 {my} : {opp}（待确认）",
  "groupNotReplayable": "无可回放的对局记录",
  "replayAction": "复盘",
  "recordAction": "并入记录",
  // —— 查看器 ——
  "frame": "帧 {current} / {total}",
  "turn": "回合 {number}",
  "phase": "阶段",
  "chain": "Chain（{count}）",
  "chainEmpty": "空",
  "hand": "手牌（{count}）",
  "deck": "牌库", "trash": "弃牌堆", "banished": "放逐区",
  "battlefield": "战场{lane}", "battlefieldToken": "战场标记",
  "champion": "英雄", "legend": "传奇", "base": "基地",
  "runeArea": "符文区", "runeDeck": "符文牌库",
  "score": "比分", "energy": "能量", "power": "法力", "legendXp": "传奇经验",
  "narrationTitle": "对局记录",
  "reconnectedMark": "—— 连接中断 · 已重连 ——",
  "onlineArt": "在线卡图",
  "play": "播放", "pause": "暂停",
  "unfinishedTitle": "本局无记录结果",
  "unfinishedHint": "连接在对局结束前断开。请标记结果或跳过。",
  "markWin": "标记为胜", "markLoss": "标记为负", "markSkip": "跳过",
  // —— 并入记录 ——
  "importModalTitle": "将对局结果并入记录",
  "gameRow": "对局（房间 {room}）",
  "unfinishedWarn": "未完成 — 请确认结果",
  "alreadyImported": "该房间已导入过，是否更新？",
  "saved": "已保存 {count} 条对局记录",
  "resultWin": "胜", "resultLoss": "负", "resultDraw": "平",
  "resultAbandoned": "未完成",
  "inferredLabel": "推断结果，请确认",
  "first": "先手", "second": "后手",
  "confirmSave": "保存记录"
}
```

（`nav.replay` / `home.toolsReplay` / `simulator.replayTitle` 等入口键另加。）

---

## 10. 边界情况与风险

| #   | 情况                                         | 处理                                                                  |
| --- | -------------------------------------------- | --------------------------------------------------------------------- |
| 1   | 房间只有 matchmaking 记录                    | 卡片显示「无可回放的对局记录」，禁用复盘                              |
| 2   | 一局多次重连（本样本 5HMU3 重连 2 次）       | 事件合并回放 + narration 重连标记；卡片显示 session/重连数            |
| 3   | session 间隔异常大（>2h，房间号疑似复用）    | 提示「可能是两局」，允许手动拆分为两条记录                            |
| 4   | 所有对局中途断开（本样本即如此）             | 不静默剔除：并入弹窗里显示显眼提示「未完成 — 请确认结果」，确认后并入 |
| 5   | 对手卡组/卡图本地缺失                        | 名称用事件数据兜底，卡图走 CDN/占位                                   |
| 6   | 重复导入同一文件/房间                        | `source_replay_id` 去重 + 「更新或跳过」                              |
| 7   | 大文件/大对局（千级帧）                      | 帧重建惰性（base + 增量），scrub 用 rAF 节流                          |
| 8   | 未绑定卡组却点并入                           | 禁用 + 引导绑定                                                       |
| 9   | 扩展版本升级改变 payload 结构                | 解析层版本门（meta.version），宽容解析 + 提示                         |
| 10  | 补丁 op 出现未覆盖类型（如 `chain_replace`） | `applyOp` 补全 + 未知 op 静默跳过并计入「忽略数」                     |
| 11  | 我方识别失败                                 | 回退 seat 0 / 玩家名匹配设置页玩家名；仍失败让用户选                  |
| 12  | 老库无 `source_replay_id` 列                 | `ensureColumn()` 补列（符合迁移规范）                                 |
| 13  | Web 模式（无 Tauri）                         | `isTauri` 分支：`<input type=file>`；复盘可跑，记录写入依赖本地库     |
| 14  | i18n 键漏配                                  | 双语言键对校验纳入自检清单                                            |
| 15  | 比分预填的展示                               | **对局卡片摘要 + 并入弹窗逐局行两处都展示**                           |

---

## 11. 分阶段实施计划

**M0 — 解析与引擎（纯函数，可先行）**
`import-parser.ts`（分组=房间、session 合并、比分预填）、`replay-engine.ts`（demo 逻辑 TS 化

- `chain_replace` 补齐 + 重连边界标记）、类型与自检脚本（用本样本文件对照输出）。

**M1 — 导入页 + 查看器**
路由 `/replay`、store、Dropzone、对局卡片、DeckBindPanel（仅绑定已有/不绑定）、
ReplayViewer 全家桶、i18n 键（zh/en）、route-config 登记（backTo: '/'）、
**入口：首页「更多」网格（entries 数组）+ `/simulator` 页（simulatorCards 数组）**。

**M2 — 并入记录**
`source_replay_id` 列（ensureColumn）、records-builder、RecordImportModal
（逐局确认 + 未完成显眼提示 + 去重）、完成反馈与跳转、战绩页无改动验证。

**M3（可选二期）**

- 回放持久化：`replay_sessions` 表（原始 JSON 存 `$APPCACHE`），历史回放入口；
- `source_replay_id` 纳入 user-sync 实体；
- 扩展导出 `result` 字段后接入直读；
- **多局合并为 BO3 等 BO1 以上赛制**。

---

## 12. 已确认决策

| 项           | 结论                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| session 语义 | **房间 = 一局**；组内多条 game 记录 = 同一局的重连 session（sequence 无缝衔接 + 间隔≈1s 证据） |
| 胜负判定     | 导出无胜负字段、无基地 HP → **用户确认为唯一依据**，比分仅预填                                 |
| 自建卡组     | **不需要**；卡组绑定只有「绑定已有 / 不绑定」                                                  |
| BO 判定      | **每局 → 一条 BO1 记录**（best_of=1 + 一个小局）；BO1 以上合并本期不做                         |
| 未完成局     | **不静默剔除**：并入弹窗显示显眼提示「未完成 — 请确认结果」，确认后可并入                      |
| 比分预填     | **对局卡片 + 并入弹窗两处展示**                                                                |
| 局序         | session 内事件按 ts 合并排序（跨 session 无缝回放）                                            |
| i18n 母版    | **中文为主**（zh-CN 母版，en 对照）；游戏内容英文原样展示                                      |
| 入口         | 首页「更多」网格 + `/simulator` 页 + `/replay` 路由                                            |
| 去重         | `source_replay_id = ra:{roomCode}:{最早 startedAt}`（本地列，不参与同步）                      |

## 13. 设计定稿说明

本轮已确认的全部决策：

| 确认项       | 结论                                                            |
| ------------ | --------------------------------------------------------------- |
| BO1 以上赛制 | **本期不做**（多局合并 BO3 等移到 M3 后续）                     |
| 未完成局处理 | **显示显眼提示**「未完成 — 请确认结果」，确认后并入，不静默剔除 |
| 比分预填展示 | **对局卡片 + 并入弹窗两处都展示**                               |

设计定稿。可进入实施（M0 → M1 → M2，见 §11）。
