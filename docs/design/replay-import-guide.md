# Replay 导入方案：实现理解与调试指南

> 现状版（对齐当前代码 HEAD，Schema v3 系列化 + 两段式导入之后）。
> 姊妹文档：`docs/design/rift-atlas-replay-import.md`（v2.1 设计定稿，含素材实测结论，部分内容已过时——**实际实现超出了"不落库"的设计范围**，差异见 §7）。

## 0. 核心结论（先看这个）

```
┌─────────────┐  ①读取    ┌──────────────────────────┐
│ 用户选择 JSON ├─────────►│ ReplayImportDropzone.svelte│  Tauri: plugin-dialog open
└─────────────┘  文件文本  └────────────┬─────────────┘
                                        │ text + fileName
                                        ▼
┌───────────────────────────────────────────────────────┐
│ ② parseRiftExport(text)  src/lib/replay/import-parser.ts │  纯函数，无 IO
│    JSON.parse → 结构校验 → 对局信号校验 → session 化 →     │  throw ReplayImportError
│    按 room 分组 → buildGame（玩家/胜负/战场/来源探测）→     │  (not-json|bad-shape|no-matches|
│    buildReplay 预填比分统计 → 按 seriesId 聚合 → 最终 groups │   no-replay-data)
└───────────────────────┬───────────────────────────────┘
                        │ ImportBundle
                        ▼
┌───────────────────────────────────────────────────────┐
│ ③ 页面暂存：每个 series 写 replays/tmp/{key}-{ts}.json   │  writeImportTmp（仅 Tauri）
│    弹窗切换到「选择要导入的系列」（ReplayImportSelect）    │
└───────────────────────┬───────────────────────────────┘
                        ▼ 用户勾选 series（默认全选）→ 确认
┌───────────────────────────────────────────────────────┐
│ ④ confirmImport：逐 series 调 saveSeriesFile 写真实文件  │  每 series 一个文件、按 key
│    → cleanupImportTmp 清空暂存 → toast + refresh()      │  替换更新；web 模式造 session-*
└───────────────────────┬───────────────────────────────┘
                        ▼
┌───────────────────────────────────────────────────────┐
│ ⑤ loadLibrary() → /replay 列表（跨文件按 group.key 去重） │
│ ⑥ 点击 → goto /replay/<key> → [key]/+page.svelte        │
│    store 命中直接用；否则 loadLibrary 兜底 → ReplayViewer │
└───────────────────────────────────────────────────────┘
```

四个最重要的认知：

1. **完全是前端功能**：没有任何 replay 专用 Rust command、不写 SQLite。唯一 Tauri 依赖是通用 `read_text_file`（`db-file-service.ts:19-21`）、`plugin-dialog`（选文件/确认删除）和 `plugin-fs`（写 `$APPLOCALDATA/replays/`，含 `replays/tmp/` 暂存）。
2. **payload 是字符串形式的 JSON，不是 Base64**：所有事件 `payload` 都要二次 `JSON.parse`（`replay-engine.ts:148-155 parsePayload`）。
3. **roomCode = 一局，session ≠ 对局**：断线重连会产生多条 session；BO3 的多局通过服务器权威 `seriesId` 聚合。
4. **导入是两段式**：先解析 + 暂存（tmp），再弹窗勾选要落盘的 series。落盘**一个 series 一个文件**，重复导入同 key 直接替换更新（`saveSeriesFile`）。

---

## 1. 文件地图

### 1.1 核心逻辑层（纯函数，无 DOM/IO）

| 文件 | 职责 | 关键函数（行号） |
|---|---|---|
| `src/lib/replay/types.ts` | 全部类型 + `ReplayImportError` | 原始格式 `RiftExport`/`RiftEvent`（15-53）；规范模型 `RiftAtlasMatchRecord`（158-171）；错误码（194-203，含 `no-replay-data`） |
| `src/lib/replay/import-parser.ts` | 原始导出 → `ImportBundle` | `detectSourceHost`（50，来源探测）；`scanSessions`（112，含 `room_shell_sync` 读 sessionDoc）；`parseRiftExport`（396，含信号校验 449-495）；`buildGame`（675）；`buildSeriesRecord`（770）；迁移 `migrateV1Group`（902）/`migrateV2ToV3`（940） |
| `src/lib/replay/replay-engine.ts` | 回放引擎 | `parsePayload`（148）；`applyOp`（214-333）；`buildReplay`（346-472）；`stateAt`（478）；`collectKeyframes`（499）；`extractBattlefieldSelections`（619-711） |
| `src/lib/replay/card-meta.ts` | 卡号 → 本地库元数据 | `baseCardCode`（47）；`resolveCardMetas`（103）；`resolveNameMetas`（142）；`collectCardCodesFromStates`（178） |

### 1.2 状态与持久化

| 文件 | 职责 |
|---|---|
| `src/lib/stores/replay-import.svelte.ts` | 跨页内存传递 `ImportBundle`（`setReplayBundle` 17 / `peekReplayBundle` 23）；卡组绑定/结果标记（M2 预留） |
| `src/lib/services/replay-library-service.ts` | `$APPLOCALDATA/replays/` 文件库：`hashText`（81）、`loadLibrary`（123，含 v1/v2→v3 迁移）、`saveLibraryFile`（174，⚠️ **已弃用**，新流程不再引用）、`writeImportTmp`（223）、`cleanupImportTmp`（251）、`saveSeriesFile`（289，两段式落盘主入口）、`removeRoom`（366）、`removeFile`（401）、`updateGameStarterChooser`（425） |
| `src/lib/db/repository/match-record-repository.ts` | **卡组绑定（对局资料）**：`replay_key` 本地列（不进云同步）；`getMatchByReplayKey` / `getAllReplayBindings` / `deleteMatchByReplayKey`（复用 `deleteMatch`+墓碑）/ `findSyncedMatchForReplay`（身份指纹 roomCode+startedAt）/ `relinkReplayToSyncedMatch`（导入静默重链） |

### 1.3 路由与组件

| 文件 | 职责 |
|---|---|
| `src/routes/replay/+page.svelte` | 导入页：`onFile`（131，解析+暂存+弹窗切换）、`confirmImport`（232，逐 series 落盘 + 静默重链 `relinkReplayToSyncedMatch`）、`closeImportModal`（221，清理暂存）、`mergedGroups`（48 跨文件按 key 去重）、多选批量删除（`enterSelect` 309 / `onDeleteMany` 332，**联动删除 match 记录**）、**顶栏排序**（`SortModal` 复用 + `REPLAY_SORT_FIELDS`：created_at=导入时间 importedAt / game_time=meta.startedAt / format / self_legend=我方传奇，观战取左玩家；空规则 = 默认最近导入倒序）、**对局资料**（`infoKey` → `ReplayInfoModal`；`loadBindings` 加载 `replay_key→deck_id` 绑定 Map 与主牌重叠率） |
| `src/routes/replay/[key]/+page.svelte` | 查看器页：store 优先 → `loadLibrary` 兜底 → 找不到跳回 `/replay`（14-35） |
| `src/lib/components/replay/ReplayImportDropzone.svelte` | 导入入口：dialog / file input / 拖拽（19-54）；空库时也直接内嵌在页面主体（`+page.svelte:397`） |
| `src/lib/components/replay/ReplayImportSelect.svelte` | **两段式选择弹窗**：系列勾选列表 + 全选/取消全选 + 传奇缩略图/比分/来源徽标 + 导入/取消 |
| `src/lib/components/replay/ReplayGroupCard.svelte` | 对局卡片：传奇/战场缩略图、比分、BO 徽标；多选模式勾选框（`selectable/selected/onToggleSelect`）；**右上角资料按钮**（`Info` 打开对局资料弹窗，已绑定卡组时追加 `FileLock` 指示 + 主牌重叠徽标 `deckOverlap`） |
| `src/lib/components/replay/ReplayInfoModal.svelte` | **对局资料弹窗**：视角选择（选「我方」，决定分数方向/胜负，切视角自动翻转已标记的胜↔负）；双方卡表**折叠面板**（默认收起，标题为传奇卡图+中文名+展开箭头，展开后仅 50px 卡图+数量角标）；卡组绑定（`<select 卡组>` 仅列含双方任一传奇的卡组 + `<select 版本>` 默认最新）；每小局 胜/负/平 + 备注。保存：先写 json 注解（`saveGroupAnnotation`），选卡组则 `createMatch`/`updateMatch`，无卡组则 `deleteMatchByReplayKey` 解绑。**观战仅角标，不 gate 任何编辑** |
| `src/lib/components/replay/ReplayViewer.svelte` | 查看器主组件（1274 行）：播放控制/棋盘/书签/结果标记 |
| `src/lib/components/replay/ReplayBoard.svelte` / `ReplayBattlefield.svelte` / `ReplayCard.svelte` / `ReplayCardReader.svelte` / `ReplayNarration.svelte` | 版面渲染层 |
| `src/lib/components/replay/DeckBindPanel.svelte` | 卡组绑定选择面板（导入流程预留）；重叠率计算已抽到 `src/lib/replay/deck-overlap.ts`（`deckOverlapRatio`，纯函数，`ReplayInfoModal`/列表卡片共用） |

### 1.4 入口与基础设施

- 首页入口：`src/routes/+page.svelte:95-101`（desktopOnly）；模拟器页入口：`src/routes/simulator/+page.svelte:24-31`
- `route-config.ts:28-29`：`/replay`、`/replay/:key` 的 backTo
- `AppShell.svelte:48-56`：`/replay/` 前缀走全页模式（无侧栏/顶栏/底栏）
- 权限：`src-tauri/capabilities/default.json` — fs scope `$APPLOCALDATA`（43-50 行）、`dialog:allow-open/ask`（71-75 行）。**新增 API 忘记登记会报 `not allowed`**
- i18n：`src/locales/zh-CN.json:1808-1940` 的 `replay` 命名空间（137 键，`en.json` 一一对应）
- 通用文件读取：`src/lib/services/db-file-service.ts:19-21`（`invoke('read_text_file')`）

---

## 2. 数据格式速查

### 2.1 原始导出 JSON（Rift Atlas 扩展导出）

```jsonc
{
  "meta": { "exporter": "Rift Atlas 对局记录器", "version": "0.2.0", "exportedAt": "..." },
  "matchCount": 6,        // 会话数 ≠ 对局数
  "eventCount": 3750,
  "matches": [            // RiftMatchRecord[]
    {
      "sessionId": "s-msw1ttk1-1-at3i",
      "roomCode": "EMSBW",          // 一局的标识 = 分组键
      "url": "wss://.../matchmaking/enam-v2-constructed-all-bo1?..."  // 含 /matchmaking/ 即匹配会话（无对局内容）
      "startedAt": 1786899504097,
      "endedAt": ..., "durationMs": ..., "state": "complete", "reason": "socket-closed",
      "events": [
        { "seq": 1, "ts": ..., "direction": "in|out", "kind": "string",
          "type": "authoritative_patch_commit",       // 或 authoritative_snapshot / chat_append ...
          "payload": "<JSON 字符串>" }                 // ⚠️ 字符串，需二次 JSON.parse
      ]
    }
  ]
}
```

### 2.2 关键事件类型（`replay-engine.ts:360-442`）

| type | payload 内容 | 处理 |
|---|---|---|
| `authoritative_snapshot` | `{type, gameInstanceId, sequence, snapshot, gameplayLog}`；`snapshot` 含 `phase/players/roomMode/gameVariant/playMode/chainEntries` | 存为 base 快照（重连后服务器重发全量 → 天然衔接）；`snapshot.players[].board.legend` 是**双方传奇的最终兜底来源**（对手卡组不可见时唯一来源，`scanSessions` 的 upsert 会补进玩家池） |
| `authoritative_patch_commit` | `{baseSequence, sequence, action, patch: {operations}, clientActionId}` | `operations[]` 即补丁帧（`ReplayFrame.ops`） |
| `room_shell_sync` | `{type, gameInstanceId, sessionDoc, sequence}`；`sessionDoc` 含 `roomCode/matchFormat/selfPlayer/publicPlayers/viewer/createdAt/phase`，`selfPlayer.deck.sections.legend` 有卡组传奇 | ⚠️ payload 内**没有 url**（url 只在 match 记录级）；用于 session 化兜底读玩家/传奇信息（`scanSessions`，import-parser.ts:112-248）；`sessionDoc.viewer` 的 `role/playerId` 参与**观战判定** |
| `join_shell` | `{type, gameInstanceId, playerId, viewerRole, roomCode}` | **观战判定主来源**：`playerId === 'spectator'` 或 `viewerRole === 'spectator'` 即观战视角（`scanSessions`，import-parser.ts:146-166）；玩家视角为 `{playerId:'plr_xxx', viewerRole:'player'}` |
| `chat_append` | `{entry: {author, text, at}}` | 进 narration（`kind: 'chat'`） |
| `searching / matched / start` | 匹配会话内事件，含 `playerId/playerName` | 用于我方识别 |

**来源探测**：`detectSourceHost(url)`（import-parser.ts:50）从 match 记录级 `url` 提取 host（如 `realtime.riftatlas-workers.com`，宽容解析任意域名），写入 `meta.source`。模拟器网站如为其他域名也能识别并展示。

**观战判定**（三来源任一命中即 `perspective.isSpectator=true`，`localPlayerId` 置 null）：
1. `join_shell.playerId === 'spectator'` / `viewerRole === 'spectator'`（主来源）
2. `sessionDoc.viewer.role === 'spectator'` / `viewer.playerId === 'spectator'`（兜底，每次 shell 同步都有）
3. 记录级 `url` 含 `playerId=spectator`（兜底，`buildGame` URL 正则）

### 2.3 补丁操作全集（`KNOWN_OPS`，`replay-engine.ts:62-79`）

16 种：`zone_insert / zone_remove / zone_move / zone_reorder / patch_card_fields / unset_card_fields / set_player_fields / set_board_fields / unset_board_fields / set_room_fields / unset_room_fields / chain_insert / chain_remove / chain_replace / log_insert / log_remove`

未知 op 不阻断，计入 `ignoredOps` 统计并在导入时警告（`import-parser.ts:471-476`）。

### 2.4 规范化模型（Schema v3，`types.ts:158-171`）

```
RiftAtlasMatchRecord
├─ key: string                    // seriesId（无则 roomCode）
├─ meta: { seriesId, roomCode, format, startedAt, endedAt, durationMs, firstPlayerId, source }
│                                 // source: 来源域名（detectSourceHost 探测）
├─ perspective: { localPlayerId, isSpectator? } // 导出方视角（渲染时定我方/对方；观战导出 isSpectator=true 且 localPlayerId=null）
│                                 // 观战展示：列表/弹窗/播放页仍按玩家池顺序（players[0]/[1]）铺两名玩家全量信息，仅多「观战」角标
├─ players: Record<playerId, ReplayPlayer>
│    └─ ReplayPlayer: { id, name, legend, deck: Decklist, decklistRaw, battlefield }
├─ result: { winnerId, score }    // 系列级（winsByPlayerId 权威）
├─ games: RiftAtlasGame[]         // 按 gameNumber 升序
│    └─ RiftAtlasGame: { gameNumber, roomCode, winnerId, starterChooserPlayerId,
│                        score, battlefieldSelections, telemetry }
└─ telemetry: { totalEvents, snapshotCount, reconnectCount, parseFailures,
                hasReplayableData, sessions, matchmakingSession }

Decklist 六分区：legend / champion / mainDeck / battlefields / runes / sideboard
（分区名与服务端 payload 对齐，注意 battlefields/runes 是复数）
```

**要点**：卡图/名称/费用/战力**不持久化到记录**——渲染期直查本地库（`card-meta.ts`）；隐藏区卡用占位 id `__hidden_zone__:{pid}:{zone}:{index}`（`replay-engine.ts:196-206`）。

---

## 3. 导入流程逐步详解

### 阶段 ① 读取文件（`ReplayImportDropzone.svelte:19-54`）

- **Tauri**：`plugin-dialog open({filters: [JSON]})` → `db-file-service.readTextFile` → `invoke('read_text_file')`；dialog 失败回退 file input
- **Web**：`<input type="file">` 或拖拽 `File.text()`
- 成功回调 `onFile(text, fileName)`

### 阶段 ② 解析（`+page.svelte:131 onFile` → `import-parser.ts:396 parseRiftExport`）

错误四档（`ReplayImportError`，`types.ts:194-203`）：

| code | 触发点 | i18n |
|---|---|---|
| `not-json` | `JSON.parse` 失败（405-408） | `replay.parseNotJson` |
| `bad-shape` | 顶层非对象 / 缺 `matches`（409-414） | `replay.parseFailed` |
| `no-matches` | `matches` 为空（415-417） | `replay.noMatches` |
| `no-replay-data` | 对局信号校验为 0：统计 `room_shell_sync / authoritative_snapshot / authoritative_patch_commit`（449-495） | `replay.noReplayData` |

解析管道（宽容设计，不因单条脏数据整体失败）：

1. **session 化**（418-447）：`matches` → `ReplaySession[]`（`isMatchmaking` 按 URL `/matchmaking/` 判定）；缺 `events` 的记录跳过并进 `warnings`
2. **对局信号校验**（449-495）：文件必须含可识别的对局数据（三类信号任一），全无即抛 `no-replay-data`——用于拦截「模拟器只导出了大厅/菜单流量」的无效文件
3. **按 roomCode 分组**（498-516），roomless 独立成组
4. **buildGame**（738-847）：session 按 startedAt 排序 → `scanSessions` 收集快照玩家/匹配会话我方/queueFormat/**观战判定**（112-248：`join_shell` + `sessionDoc.viewer` 双来源，upsert 补全玩家缺失的传奇/英雄/卡组字段——**对手传奇从 `authoritative_snapshot.players[].board.legend` 补齐**）→ **来源探测** `detectSourceHost`（687，写入 `built.source`）+ URL `playerId=spectator` 观战兜底 → 我方识别（观战恒 null）→ `extractSeriesFields` 探测权威系列字段（267-324）→ 战场选择提取 → 玩家数据池
5. **比分预填**（554-603）：`buildReplay` 重建 → `finalState` 取双方 `board.score`；同时回填 `parseFailures / hasReplayableData / firstPlayerId`，产生 warning（payload 解析失败、只有快照无补丁、未知 op、只有匹配记录）
6. **series 聚合**（605-650）：有 `seriesId` 的 room 合并成一条系列记录；`buildSeriesRecord`（770-869）合并玩家池、由 `winsByPlayerId` 达 `seriesWinTarget` 者定系列胜者、`previousRoomCode` 链交叉校验（断裂仅 warning）
7. **排序**（653）：`startedAt` 升序

### 阶段 ③ 内存传递 + 暂存（`+page.svelte` → `replay-library-service.ts:223`）

解析成功后 `setReplayBundle(bundle)`（`stores/replay-import.svelte.ts:17-21`，同时清空 `boundDeckId`/`resultMarks`；页面刷新即失，查看器页靠它省一次磁盘读取）。

随后页面**每个 series 写一个暂存文件**到 `replays/tmp/{sanitize(key)}-{ts}.json`（`writeImportTmp`，pretty JSON；仅 Tauri），并打开 `CommonModal` 切换到**系列选择阶段**。弹窗内容按 `importStage` 三态切换（`+page.svelte:442-462`）：

- `'drop'`：选文件 dropzone（+ 错误文案）
- `'parsing'`：转圈 + `replay.importParsing`（⚠️ 用页面本地状态，**不要用 `setLoadStatus('loading')`**，见 §5.5 陷阱）
- `'select'`：`ReplayImportSelect` 系列勾选列表（默认全选，可全选/取消全选，展示传奇缩略图/逐局比分/时间/格式/来源徽标）

### 阶段 ④ 确认落盘（`+page.svelte:232 confirmImport` → `replay-library-service.ts:289`）

用户勾选后点「导入」：

- 逐 series 调 `saveSeriesFile(group, fileName)`：**每 series 一个真实文件** `replays/<uuid>.json`（pretty JSON）；
  - **按 `group.key` 去重**：库中已存在同 key 的 series → 复用其 id 替换更新并刷新 `importedAt`；命中旧版多 series 文件时仅替换同 key 组、保留同文件内其他组（防丢数据）
  - 更新 `replays/index.json`（importedAt 倒序）
- `cleanupImportTmp()` 清空 `replays/tmp/`（取消/关闭弹窗时也会清理）
- 全部写操作串行进 `writeChain`（服务模块 59 行）防止并发竞态
- **web 模式**：tmp/save 均返回 `null` → 页面直接造 `session-{ts}` 伪文件仅内存展示（`+page.svelte:255-265`）
- 完成后 `refresh()` 重读库 + toast 导入数量

### 阶段 ⑤ 列表（`+page.svelte`）

- `loadLibrary`（`replay-library-service.ts:123-171`）：读 index → 逐文件读 → **v1/v2→v3 迁移**（`migrateGroupToV3`，117-120，迁移后自动回写磁盘）→ 损坏文件进 `brokenIds`（页面可整份删除兜底，383-386）
- `mergedGroups`（48-59）：**跨文件按 `group.key` 去重**，库按导入时间倒序、先扫到的即最新
- 顶栏：空库时无导入按钮（页面内嵌 dropzone）；有内容时提供「导入」+「多选」（`ListChecks`）入口；多选态顶栏切换为 全选 / 删除({count}) / 取消（`+page.svelte:61-119`）
- 对局卡片 `ReplayGroupCard.svelte`：`perspective.localPlayerId` 定我方；传奇按卡号、战场按英文名在渲染期查本地库；`hasReplayableData=false` 置灰；多选模式显示勾选框、隐藏底部操作区

### 阶段 ⑥ 查看器（`routes/replay/[key]/+page.svelte:14-35`）

`peekReplayBundle()` 命中 → 直接用；否则 `loadLibrary` 找同 key（取最新文件的同名 room）；都找不到 `goto('/replay')`。

---

## 4. 查看器渲染链路（调试回放逻辑用）

```
ReplayViewer.svelte
├─ ① build = buildReplay({roomCode, sessions, selfId})        （行 97）
│     sessions 全部事件按 ts 合并排序 → 抽快照/补丁帧/解说
│     → 每帧回填 base 快照（replay-engine.ts:447-460）
├─ ② keyframes = collectKeyframes(build)                      （行 189）
│     O(总 ops) 增量推演，产出 turn/phase/score 关键帧 → 书签
├─ ③ gameState = stateAt(build, safeCurrent)  ← $derived      （行 135）
│     克隆 base 快照 + 重放 baseStart..index 的补丁
│     ⚠️ 大回放下每次取帧都重放整段 → 进度条拖动用 rAF 节流（行 298）
└─ ④ 分层渲染：
     ReplayBoard（单侧）→ ReplayBattlefield（中央三战场 + 比分横幅）
     → ReplayCard（单卡，artSrc='/blue.jpg' 兜底）
     → ReplayCardReader（悬停/点击详情，直查本地库）
     → ReplayNarration（log/chat/reconnect 解说列表）
```

**stateAt 的性能模型**（调试卡顿时先想这个）：`stateAt(build, i)` 是 O(从 baseStart 到 i 的 ops)，`build.frames.length` 大或 base 快照稀疏时逐帧播放很贵。`cloneState` 用 JSON 拷贝（`replay-engine.ts:180-182`）——**不能用 `structuredClone`**，Svelte `$state` 深代理会抛 `DataCloneError`。

**先手选择者写回**：播放页手动指定（`ReplayViewer.svelte:395-409`）→ `updateGameStarterChooser(fileId, key, gameNumber, playerId)`（`replay-library-service.ts:262-297`）直接改写磁盘 JSON；`fileId` 为 null（web/未落盘）时仅内存生效。

---

## 5. 调试指南

### 5.1 样本文件与基线数据

- 样本 A：`/home/TianYue/.dsh/uploads/rift-atlas_all_2026-08-17T06-38-40-766Z.json`
  - 基线：6 会话 = **2 局**（`EMSBW`、`5HMU3`，均 bo1）；5HMU3 重连 **2 次**；我方均为 **UMA**；预填比分 **EMSBW 4:8、5HMU3 7:8**；两局都有回放数据、无未知 op；来源均 `realtime.riftatlas-workers.com`
  - 传奇：我方 UMA = VEN-193S（Shen）/ OGN-259（Yasuo，来自 `room_shell_sync` 的 selfPlayer 卡组）；**对手 = UNL-199（LeBlanc）/ OGN-247（Kai'Sa，来自 `authoritative_snapshot` 的 board.legend 兜底，历史 bug 曾恒 null）**
  - 视角：`isSpectator=false`，`localPlayerId=plr_7d01af4c / plr_23e100f1`（join_shell 为 `viewerRole:'player'`）
- 样本 B：`/home/TianYue/.dsh/uploads/rift-atlas_all_2026-08-18T14-35-13-969Z.json`（两段式流程实测用）
  - 8 会话 = 5 房间 = **2 个系列**（`series_1331656b` = QLMKU/H9KSJ/ZU57D，`series_43678642` = PSUVG/8ZDTT，均 bo3）；信号统计 roomShellSync 27 / snapshot 18 / patchCommit 929；房间 URL 均带 `playerId=spectator`（观战视角，`isSpectator=true`、`localPlayerId=null`）；玩家 funnyanger vs ppap，传奇可从快照 board.legend 补齐（不再恒 null）

### 5.2 ⚠️ `replay:check` 脚本悬空（第一个要修的坑）

`package.json:12` 的 `replay:check` 仍指向 `scripts/m0-replay-check.ts`，但该文件已在 commit `e008d9c` 删除。恢复方法：

```bash
git show 26fbca9:scripts/m0-replay-check.ts > scripts/m0-replay-check.ts
pnpm replay:check
```

**注意**：脚本断言的是 **v2 时代字段**（`group.sessionCount / gameSessions / reconnectCount / selfPlayerId / queueFormat / finalScore`），在 Schema v3 下会直接炸。恢复到 v3 需改写断言：

| 旧（v2） | 新（v3） |
|---|---|
| `g.sessionCount` / `g.gameSessions` / `g.reconnectCount` | `g.games[0].telemetry.sessions.length` / `games[0].telemetry.sessions` / `games[0].telemetry.reconnectCount` |
| `g.selfPlayerId` / `g.selfName` / `g.opponentName` | `g.perspective.localPlayerId` / `g.players[<id>].name` |
| `g.queueFormat` | `g.meta.format` |
| `g.finalScore.my/opp` | 按 `g.result.score` + `perspective` 定位 |
| `buildReplay({roomCode: g.roomCode, sessions: g.sessions, ...})` | `buildReplay({roomCode: g.games[0].roomCode, sessions: g.games[0].telemetry.sessions, selfId: g.perspective.localPlayerId})` |

`applyOp` 单元测试部分（chain_replace / zone ops / unset_board_fields / 未知 op）与 v3 无关，可直接复用。

### 5.3 手动调试路径

| 目的 | 方式 |
|---|---|
| 全功能调试（落盘/卡图/删除确认） | `pnpm tauri dev` → 首页「更多」→「对局复盘」→ 拖入 JSON；库在 `$APPLOCALDATA/replays/`，可用 `ls ~/.local/share/com.<app>/replays/` 直接检查磁盘内容 |
| 解析/回放逻辑（无 Tauri） | `pnpm dev` 纯 Web：导入页能解析、查看器能播，但**无持久化、无卡图**（session-* 伪文件，刷新即失） |
| 纯函数层 | 恢复 5.2 的脚本，或在 devtools console 里手动 `parseRiftExport` + `buildReplay` + `stateAt`（三函数均从 `$lib/replay/*` 导出） |

### 5.4 断点 / 插桩建议位置

导入链路全程有 `[replay-import]` 前缀的 console 日志（会同时进应用日志文件 `$APPLOCALDATA/logs/app.log`），逐段输出解析/信号统计/分组/来源/聚合/暂存/落盘结果。

| 想查什么 | 在哪打点 |
|---|---|
| 导入失败 | `+page.svelte:131 onFile`（异常会在此被吞成 errorText） |
| 解析期各环节 | 直接看 `[replay-import]` 日志：session 化 → 信号统计 → 按房间分组 → 来源探测 → 构建一局 → series 聚合 → 最终 groups |
| 暂存/落盘 | `[replay-import] 暂存文件已写入 / 真实文件已写入 / index.json 已更新`（`replay-library-service.ts:223/289`） |
| 解析期 warning | `import-parser.ts` 各 `warnings.push`（561/563/596/601） |
| 某帧状态不对 | `replay-engine.ts:478 stateAt`（看 base 快照与补丁重放） |
| 帧数/边界不对 | `replay-engine.ts:403 isBoundary`（session 边界判定） |
| 未知 op | `replay-engine.ts:387 ignoredOps` 计数 |
| 卡图未命中 | `card-meta.ts:103 resolveCardMetas`（候选顺序：原卡号 → `*` 签名 → 基础 7 位） |
| 落盘失败 | `replay-library-service.ts:289 saveSeriesFile` / `59 writeChain` |
| 卡顿 | `ReplayViewer.svelte:298` 进度条 rAF 节流；观察 `stateAt` 重放长度 |

### 5.5 常见问题排查表

| 症状 | 原因 | 位置 |
|---|---|---|
| 「文件不是合法的 JSON」 | 导出的不是 Rift Atlas JSON / 文件被压缩过 | `import-parser.ts:405-408` |
| 「文件中没有对局记录」 | 文件合法但 `matches` 为空 | `import-parser.ts:415-417` |
| 「文件中未检测到可识别的对局数据」 | 三类对局信号（room_shell_sync/snapshot/patch_commit）计数为 0，多为纯大厅/菜单流量 | `import-parser.ts:449-495` |
| 导入后**没有弹窗**、列表仍为空 | ⚠️ 布局陷阱：`+layout.svelte:106-116` 用 `uiState.status` **整页切换**（loading/syncing 时卸载 AppShell）。导入流程**不得**用 `setLoadStatus('loading')` 做瞬时遮罩（会卸载页面、后续状态写进已销毁实例）。现用页面本地 `importStage='parsing'` 显示加载；若再犯此症状，检查是否有人重新引入 `setLoadStatus` | `+page.svelte:134`、`+layout.svelte` |
| 终端刷 `WebKit encountered an internal error`（`internallyFailedLoadTimerFired`） | WebKitGTK 已知无害噪音，来自**启动时 Supabase 后台请求失败**（离线/项目不可达）。导入链路只用 plugin-fs/plugin-sql/blob URL，**不产生此类日志** | 与导入无关 |
| 导入成功但卡片显示灰卡背 | 本地库无此卡（`is_custom/is_promo` 排除、语言非 SC）→ 走 `/blue.jpg` 占位；web 模式恒占位 | `card-meta.ts:109-112, 125-127` |
| 比分显示 - | `board.score` 在最终快照中缺失（对局未打完） | `import-parser.ts:554-603` |
| 对手传奇显示空/灰卡背 | 历史 bug：`scanSessions` 曾「重复即跳过」，对手先被 `room_shell_sync`（无卡组）记录、后到的 `authoritative_snapshot` 的 `board.legend` 被跳过。已改为 upsert（缺失才补）——对手传奇从快照 `board.legend` 兜底 | `import-parser.ts:146-248` |
| 观战导出仍标出「我方」 | 观战判定三来源（`join_shell` / `sessionDoc.viewer` / URL `playerId=spectator`）均未命中时回退到我方启发式。先查 `[replay-import] 视角识别` 日志；命中后 `perspective.isSpectator=true` 且 `localPlayerId=null` | `import-parser.ts:146-166, 753-766` |
| 观战记录列表只显示一名玩家 | 展示层曾把观战的「我方」置 null → 左栏空。已改为观战时按玩家池顺序（`players[0]/[1]`）铺两名玩家，传奇/战场/姓名/比分全量显示，仅多「观战」角标 | `ReplayImportSelect.svelte` / `ReplayGroupCard.svelte` / `ReplayViewer.svelte` |
| 显示「只有快照没有补丁帧」 | 记录只有 `authoritative_snapshot` 无 `patch_commit`（如纯观战/未开始） | `import-parser.ts:562-565` |
| 同 series 重复导入 | 按 `group.key` 去重：复用原 id 替换更新，不产生重复列表项 | `replay-library-service.ts:289 saveSeriesFile` |
| 列表出现重复 room | 不同文件 hash 不同但含同一 room（去重按文件 hash + group.key 两级，跨文件只按 key） | `+page.svelte:48-59` |
| 库文件读不出来 | 手动改过磁盘 JSON / 半截写入 → 进 `brokenIds`，页面可整份删除 | `replay-library-service.ts:154-157` |
| 重连后画面错乱 | 重连 session 的补丁 `baseSequence` 衔接问题（快照 seq 与补丁 seq 不匹配）→ 检查 `buildReplay:447-460` 的 base 回填 | `replay-engine.ts` |
| web 模式删了一局后列表还是旧的 | web 无持久化，删除只改内存 `files` | `+page.svelte:366-372` |

### 5.6 磁盘文件速查

```
$APPLOCALDATA/
└── replays/
    ├── index.json            // [{id, fileName, importedAt, hash}] 按 importedAt 倒序
    ├── tmp/                  // 导入暂存目录：{sanitize(key)}-{ts}.json（解析后→确认/取消时清理）
    └── <uuid>.json           // {id, fileName, importedAt, hash, version: 3, groups: [单 series]} pretty JSON
```

> 新流程每 series 一个文件；旧版多 series 文件仍可被 `loadLibrary` 读取（迁移/去重兼容）。

Linux 实际路径一般是 `~/.local/share/<bundle-id>/replays/`。想模拟损坏文件，直接改坏一个 `<uuid>.json` 再刷新导入页即可看到 `brokenIds` 兜底 UI。

---

## 6. 已删除脚本的断言清单（`git show 26fbca9:scripts/m0-replay-check.ts`）

恢复 + v3 改写后应覆盖的断言点：

1. **解析**：`rawMatchCount === 6`；`groups.length === 2`；两局存在（key = `EMSBW` / `5HMU3`）
2. **EMSBW**：2 会话 0 重连；我方 `plr_7d01af4c` / `UMA`；对手 `test`；bo1；对手卡组不可见（legend null）；我方 decklistRaw 含 `Legend:`；可回放
3. **5HMU3**：4 会话 3 游戏 2 重连；我方 `plr_23e100f1` / `UMA`；对手 `jodido`；bo1；可回放
4. **引擎**：`frames.length === 补丁数`；`narration` 重连条目数 === reconnectCount；`isSessionBoundary` 帧数 === reconnectCount；`finalState` 比分与预填一致；最终 phase `in_game`；首帧 2 名玩家；中间帧可重建；无未知 op
5. **applyOp 合成**：`chain_replace` 整体替换；`chain_insert/remove`；`unset_board_fields`；`zone_insert/reorder/move/remove`；`patch/unset_card_fields`；`set_player_fields` + `set/unset_room_fields`；未知 op 返回 false
6. **错误路径**：非法 JSON → `not-json`；空 matches → `no-matches`；无对局信号（纯大厅流量）→ `no-replay-data`；坏 payload 不抛错只进 warnings

---

## 7. 未实现项与设计文档差异（`docs/design/rift-atlas-replay-import.md`）

| 设计（v2.1） | 现状 | 说明 |
|---|---|---|
| §3/§4.1 导入不落库（临时解析） | ✅ 已超出：`$APPLOCALDATA/replays/` 本地文件库（v1→v3 迁移 + 去重） | 非 SQLite，纯文件 |
| 两段式导入（解析→选择→落盘） | ✅ 已实现：解析后暂存 `replays/tmp/`，弹窗勾选 series 后逐 series 写真实文件（`saveSeriesFile`）并清理暂存 | 每 series 一个文件、按 key 替换更新；`saveLibraryFile`（旧整包落盘）已弃用 |
| 来源检测 | ✅ 已超出：`detectSourceHost` 从 url 提取来源域名写入 `meta.source`，弹窗展示来源徽标 | 设计未涉及；拦截纯大厅流量用 `no-replay-data` 信号校验 |
| §4.2 复用 `match_records`，`source_replay_id = 'ra:{roomCode}:{startedAt}'` | ✅ 已实现（列名改为 `replay_key`，值为 `group.key`；**本地列不进云同步**） | 唯一索引 `idx_match_records_replay_key`；`extractMatches` 映射白名单不导出、`applyMatches` 显式列清单不触碰，跨设备同步安全 |
| §4.1 `replay_sessions` 表 | ❌ 未实现 | 回放数据只在 JSON 里 |
| §5.3 卡组绑定（DeckBindPanel） | ✅ 已实现（`ReplayInfoModal` 内嵌绑定选择，重叠率 `deck-overlap.ts` 共用） | 绑定 = 一条 `match_records` 行（`deck_id` NOT NULL FK）；解除绑定 = `deleteMatchByReplayKey` |
| §8 结果并入记录（`records-builder.ts` + `RecordImportModal`） | ⚠️ 部分实现 | 每小局 胜/负/平 经对局资料弹窗写入 `match_games`（未标记局不写行，避免计败）；无独立构建器 |
| §7 卡图渲染 | ✅ 已实现（渲染期直查本地库，不落库） | 与设计一致 |
| Schema 形态 | 已迭代到 v3（series 化）：v2 的 `ReplayGroup` 单局记录 → v3 `RiftAtlasMatchRecord`（`games[]`） | 磁盘迁移函数已内置（`loadLibrary` 自动跑） |

另注意：设计文档 §2 的「不落库」结论是当时的范围决策，非技术限制；当前实现选择持久化是因为导入解析成本高（`buildReplay` 全量重建），不重复解析。

---

## 8. 修改代码时的规范提醒

- **i18n**：新增用户可见文案必须同步加 `zh-CN.json` + `en.json`（`replay` 命名空间，zh 为母版，当前 185 键）
- **纯函数层原则**：`import-parser.ts` / `replay-engine.ts` 保持无 IO、无 `$lib/db` 依赖（`card-meta.ts` 是唯一接 db 的，且仅读）；新增解析逻辑放这里便于脚本复测
- **Svelte 5 runes**：组件里用 `$state/$derived`；`writable` 仅 store 型状态（跨页传递用了 `$state` 模块级变量，是既有模式）
- **不要用 `structuredClone` 拷状态**（`$state` Proxy 会抛错），用 JSON 拷贝（`replay-engine.ts:180-182`）
- **Tauri 权限**：新增 `plugin-fs`/`plugin-dialog` API 记得登记 `src-tauri/capabilities/default.json`，否则前端 `not allowed`；`replays/tmp/` 已被 `$APPLOCALDATA/**` 覆盖
- **禁止用 `setLoadStatus` 做交互中瞬时遮罩**：`+layout.svelte` 用 `uiState.status` 整页切换，loading/syncing 会卸载 AppShell（页面组件销毁、后续状态丢失）。导入/页面内 loading 一律用页面本地 `$state`
- **导入调试日志**：统一 `[replay-import]` 前缀 `console.log/error/warn`（进 `$APPLOCALDATA/logs/app.log`），覆盖解析/信号/来源/视角/分组/暂存/落盘各环节
- **玩家数据 upsert**：`scanSessions` 收集玩家一律「已存在只补缺失字段、不覆盖已有值」（对手传奇/卡组只能从后到的快照 board 兜底，`sections.legend` 优先于 `boardLegend`）
- **观战判定**：`join_shell`/`sessionDoc.viewer`/URL 三来源任一命中即观战（`perspective.isSpectator=true`、`localPlayerId=null`）；**不要**在观战导出里硬猜「我方」
- **对局资料（卡组绑定）**：`match_records.replay_key` 是**本地列**（唯一，不进云同步）；**绑定可选**——绑定经 `ReplayInfoModal` 走 `createMatch`/`updateMatch`；未绑定（含观战）时每小局结果/备注/视角写入复盘文件顶层的 `annotations[key]`（`readGroupAnnotation`/`saveGroupAnnotation`，随 json 走、不同步）；解除绑定/删除复盘经 `deleteMatchByReplayKey`（带墓碑会跨设备传播删除）。跨设备衔接靠**身份指纹**（`group_name`=roomCode + `played_at`=startedAt ISO）：导入时静默重链 `relinkReplayToSyncedMatch`、弹窗内 `findSyncedMatchForReplay` 兜底合并编辑；**不要**在无指纹命中的情况下用 `createMatch` 重复建记录（会在卡组统计里出现两条同局）
- 行号以当前 HEAD 为准，重构后以实际为准

---

## 9. 对局资料（卡组绑定）功能详解

### 9.1 数据模型

- `match_records.replay_key`：**本地列**（`schema.ts` DDL + `ensureColumn` 老库补列 + `idx_match_records_replay_key` 唯一索引）。**不进云同步**：`extractMatches` 的映射白名单不导出、`applyMatches` 的显式列清单不触碰，跨设备同步安全（其他设备只拿到 deck_id/note/结果，拿不到链接）。
- **绑定可选**：一条 `match_records` 行 = 一个绑定（`deck_id` 为 NOT NULL FK，**仅当用户选了卡组才建行**）。绑定后自动出现在 `/decks/[deckid]/records` 并参与卡组战绩统计。
- **未绑定（含观战）时，注解写入复盘文件顶层 `annotations[group.key]`**（`ReplayGroupAnnotation { myPlayerId, results, note, updatedAt }`，`replay-library-service.ts` 的 `readGroupAnnotation`/`saveGroupAnnotation`，随 json 走、不同步、跨设备复制文件即随行）。
- 每小局结果 → `match_games`：胜=`is_win=1/win_type='normal'`、负=`is_win=0/'normal'`、平=`win_type='draw'`；**未标记的小局不写行**（避免被统计成败场）。`is_first` 用 `starterChooserPlayerId` 推断。
- 备注 → `match_records.note`（绑定）/ 注解（未绑定）；`played_at` = `meta.startedAt` 的 ISO；`opp_legend_*` 用 `getCardAndPrintByPrintCode` 解析对手传奇的真实印刷信息（对手 = 当前视角下非「我方」的那位）。

### 9.2 交互流程

- 复盘卡片右上角 `Info` 按钮打开 `ReplayInfoModal`；有绑定记录时额外显示 `FileLock` 指示 + 主牌重叠徽标（`deckOverlapRatio`，`src/lib/replay/deck-overlap.ts` 纯函数，与 `DeckBindPanel` 共用）。
- **视角选择**：两位玩家各一个 chip（传奇头像 + 名字 + 我方/对方标签），默认取 `perspective.localPlayerId`（观战取左玩家）；切换视角会把已标记的 胜↔负 自动翻转（平局不变），保证语义跟随视角。
- **卡表折叠面板**：双方卡表各一个折叠块，**默认收起**；标题为 `[传奇卡图 中文名 展开箭头]`；展开后按分区（传奇/英雄/主牌/战场/符文/备牌）平铺卡牌，**仅 50px 卡图 + 右下角数量角标（×N）**，不显示卡名。
- **绑定**：`<select 卡组>` 仅列出「最新版本传奇命中两位玩家任一传奇」的卡组（`getAllDecksWithLegend` 返回全量卡组+最新版传奇信息，前端按 `baseCardCode` 归一比较）；选中卡组后出现 `<select 版本>`（`getDeckVersions`，默认最新 `versions[0]`）。**选卡组会自动把「我方」设为该卡组传奇匹配的那位玩家** → 分数行左=选中卡组传奇、右=未选的那位。无匹配卡组时提示 `deckSelectEmpty`。
- 保存：先写 json 注解（永远）；选卡组 → 有记录（本机链接或指纹命中）走 `updateMatch`（合并编辑），无记录走 `createMatch`（写入 `replay_key`）；无卡组但已有绑定记录 → `deleteMatchByReplayKey` 解绑（注解保留）。解除绑定按钮仅删记录、保留注解、弹窗不关闭。
- **从本局卡表导入卡组**（绑定区下方，仅 Tauri 且任一方有卡表时显示）：来源玩家下拉（默认跟随「我方」，手动改过后不再跟随）；**新建卡组**（名称输入，预填传奇名+日期）走 `createDeck` + `saveDeckAsNewVersion`；**覆盖为新版本**（目标下拉仅列候选卡组）走 `saveDeckAsNewVersion`。卡表→`DeckCardInput`：逐条 `cardCode` 经 `getCardAndPrintByPrintCode(baseCardCode(code))` 解析（`cardPrintId = selectedPrints ?? prints[0].id`、`printCode = card_no_extend`、`zone` 直接映射、`quantity = count`），本地库查不到的卡跳过并提示数量。完成后自动选中新卡组+新版本（视角跟随新卡组传奇），仍需点「保存」才写入对局记录。

### 9.3 跨设备衔接（身份指纹）

同一份复盘 json 在两个设备解析出的 `group_name`(=roomCode) 与 `played_at`(=startedAt ISO) 完全一致 → 作为指纹：

1. **导入时静默重链**：`confirmImport` 落盘后对每个 series 调 `relinkReplayToSyncedMatch`，指纹命中且该记录无本机链接时补上 `replay_key`（只改本地列、不新建行、不动 note/结果），卡片立即出现 FileLock。不命中则无事发生。
2. **弹窗内兜底**：`ReplayInfoModal` 加载时无 `replay_key` 链接则跑 `findSyncedMatchForReplay`，命中则预填卡组/结果/备注并提示「检测到其他设备同步的对局记录」，保存走 `updateMatch` 合并。适用于功能上线前已导入的老复盘。
3. 多条命中取 `updated_at` 最新一条。

**坑**：若跳过指纹检测直接 `createMatch`，会在卡组统计里出现两条同局且各自演进互不覆盖。删除复盘时若不联动 `deleteMatchByReplayKey`，会留下指向已删除复盘的孤儿记录。未绑定记录不同步（注解在本地 json），换设备需复制复盘文件。
