# 玩家数据同步设计文档（Rune Archive）· v2 重构

> 状态：设计定稿，待实施
> 版本：v2（2026-08-13 重构，替代 v1 的 Supabase+Git 双传输并重定范围与合并模型）
> 背景：`docs/missing-features.md` 曾将多设备同步暂列范围外；本文档重新纳入，按「手动 Bundle 为基线、Git 为连续同步、Supabase 远期可选」重构。

---

## 1. 背景与问题（v1 回顾）

当前数据架构 Local-first：内容数据（cards/prints/icons/rules/series）由开发者 Supabase 单向同步到本地 SQLite；玩家自有数据（收藏、卡组、借还、心愿单、购买清单、卡柜、对局、自定义打印、设置）仅存本机，跨设备只能手动备份 .db 或 CSV/JSON 导入导出。

v1 方案（`docs/player-data-sync.md` 旧版）的主要问题：

| 问题 | 说明 |
| --- | --- |
| 表面过大 | 每类数据镜像 14+ 张 user_ 表，建表与维护成本高 |
| 同步范围过宽 | 收藏历史、快照、自定义语言等低价值/可重建数据也纳入 |
| 增量依赖不成立 | 按 `updated_at > 游标` 增量要求每行每次变更都 bump updated_at，部分路径不保证 |
| 安全默认差 | anon key 直连 + 宽松权限为默认，公钥泄露即数据可读写 |
| 双传输语义重复 | Supabase 与 Git 都要实现 LWW/墓碑，工程量翻倍 |
| 引用键不稳 | deck_cards 同步依赖 `card_prints.id`，内容重同步后 id 会变（已有 `print_code`/`card_no` 稳定快照可复用） |

v2 目标：**更小范围、更稳引用、更实用传输、更少重复实现**。

## 2. 设计原则

1. **实体优先**：以业务实体为同步单位（卡组、收藏行、借还、心愿、清单、卡柜、对局、自定义打印），而非表镜像。
2. **稳定键引用**：凡引用内容库的表一律用稳定键（`card_no` / `card_no_extend` / `print_code`），pull 后经 `repointDeckCardReferences()` 重链本地打印 id。
3. **单一合并引擎**：LWW + 设备决胜 + 删除墓碑，传输层只做「取回一组实体 + 推出一组实体」，语义统一。
4. **传输分级**：手动 Bundle（零基建，基线）→ Git 私有仓库（连续，桌面）→ Supabase BYO（远期，可选）。
5. **同步配置永不随包**：URL / key / token / 仓库地址只在本机，避免凭据泄露。
6. **与内容同步衔接**：玩家数据同步只在内容同步成功之后执行；失效引用由 `cleanupOrphans()` 兜底清理。
7. **不侵入现有事务模型**：写回一律走 `database.ts` 的 `withTransaction()`（串行单连接），不开跨语句裸事务。

## 3. 同步范围（v2 缩减后）

### 3.1 纳入同步

| 实体 | 本地表 | 稳定键 | 冲突规则 | 删除 |
| --- | --- | --- | --- | --- |
| 卡组 | `decks` + `deck_versions` + `deck_cards` | `decks.id` | 实体级 LWW（decks.updated_at） | 墓碑 `deck` |
| 收藏 | `collection` + `collection_langs` | `(card_no, card_no_extend, language_code)` | 行级 LWW | 墓碑 `collection` |
| 心愿单 | `wishlist_items` | `id`（UNIQUE 卡×语言×工艺） | 行级 LWW | 墓碑 `wishlist` |
| 借还 | `card_loans` | `id` | 行级 LWW | 墓碑 `loan` |
| 联系人 | `contacts` | `id` | 行级 LWW | 墓碑 `contact` |
| 购买清单 | `purchase_lists` + `purchase_list_items` | `purchase_lists.id`（条目键 `(list_id, card_no, card_no_extend, language_pref, finish_pref)`） | 实体 LWW（头 updated_at）+ 条目行级 LWW | 墓碑 `purchase_list` |
| 对局记录 | `match_records` + `match_games` | `match_records.id` | 实体级 LWW | 墓碑 `match` |
| 卡柜 | `lockers` + `locker_sections` + `locker_cards` | `lockers.id` | 实体级 LWW | 墓碑 `locker` |
| 自定义打印/卡 | `card_prints`（`is_custom=1`）+ `cards_base`（`card_no` 以 `CUSTOM-` 前缀） | `card_prints.id` / `cards_base.id` | 实体级 LWW | 墓碑 `custom_print` |
| 设置（白名单） | settings.json（plugin-store） | 键 | 按键 LWW | — |

### 3.2 不纳入同步（可重建 / 本地派生 / 低价值）

- `collection_history` / `collection_history_items` / `collection_stats_snapshots`：本地操作记录与进度快照，导出数据包已覆盖，不做跨设备合并。
- `custom_languages`：本地语言配置，每设备独立。
- `filter_options` / `version`：内容同步的派生与游标。
- 同步配置本身（Sync Bundle 不携带 URL / key / token / 仓库地址）。

## 4. 稳定引用约定（内容表）

| 引用方 | 使用稳定键 | pull 后处理 |
| --- | --- | --- |
| `deck_cards` | `print_code`（若空则回退 `card_no`+`card_no_extend`） | `repointDeckCardReferences()` 按 print_code 重链到本地存活打印，无法映射的行删除 |
| `collection` / `collection_langs` | `card_no` / `card_no_extend` | `cleanupOrphans()` 清理已下架印刷 |
| `wishlist_items` / `card_loans` / `purchase_list_items` | `card_no` / `card_no_extend` 快照 | 卡已下架时保留行（`LEFT JOIN` 卡名为 NULL），不自动删除 |
| 自定义卡 | `CUSTOM-<snowflake>` 前缀 `card_no` | 与官方卡号永不冲突；`is_custom=1` 受现有内容同步保留逻辑保护 |

## 5. 本地改动

### 5.1 新增表（`src/lib/db/config/schema.ts`）

```sql
-- 同步元数据：单行 key/value（设备 id、上次同步时间、上次成功 bundle 校验和等）
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 墓碑：删除跨设备传播（本地硬删时写入）
CREATE TABLE IF NOT EXISTS sync_tombstones (
  id TEXT PRIMARY KEY,             -- snowflake
  entity_type TEXT NOT NULL,       -- deck / collection / wishlist / loan / contact /
                                   -- purchase_list / match / locker / custom_print / setting
  entity_key TEXT NOT NULL,        -- 实体稳定键（同 §3.1）
  updated_at TEXT NOT NULL,        -- 删除时间（与实体行 LWW 同源）
  UNIQUE(entity_type, entity_key)
);
```

### 5.2 变更点（配合稳定增量）

- 对纳入同步的表的**硬删路径**补写墓碑：`deleteDeck` / `deleteMatch` / `deleteLocker`(+sections/cards 级联按 locker 实体一条) / `deleteWishlistItem` / `deleteLoan` / `deleteContact` / `deletePurchaseList`(+items 级联) / `deleteCustomPrint` / 收藏批量删除（按变体写墓碑）。
- 审计并确保纳入表的每次变更都 bump `updated_at`（`collection`/`collection_langs`/`decks`/`wishlist_items`/`card_loans`/`contacts`/`purchase_lists`/`purchase_list_items`/`match_records`/`lockers`/`locker_sections`/`locker_cards` 均已具备；`deck_versions`/`deck_cards`/`match_games` 用父实体 `updated_at` 增量，不单独要求）。
- settings 白名单键在写入时同样 bump 其本地同步时间（存 sync_meta 按键游标）。

### 5.3 新增代码目录 `src/lib/db/service/user-sync/`

| 文件 | 职责 |
| --- | --- |
| `engine.ts` | 实体提取、行级 LWW 合并（含 deviceId 决胜）、墓碑应用（传输无关核心） |
| `state.ts` | `sync_meta` / `sync_tombstones` 读写、push 游标维护 |
| `bundle.ts` | Sync Bundle 的序列化/反序列化 + 校验和（传输 A） |
| `git-transport.ts` | Git 仓库适配器（调 Rust command，传输 B） |
| `index.ts` | 编排 pull/push/merge/写回、触发时机、与内容同步衔接 |

## 6. 统一同步格式（Sync Bundle）

单文件 JSON，带 schema 版本头；Git 传输把同一结构拆为 `<entity>.json` + `tombstones.json` 存于仓库 `rune-archive-sync/` 目录。

```jsonc
{
  "schema": "rune-archive-player-sync",
  "version": 2,
  "device": { "id": "<snowflake>", "name": "<playerName>" },
  "generatedAt": "2026-08-13T12:00:00.000Z",
  "entities": {
    "decks":        [ { "id": "...", "name": "...", "versions": [ ... ], "cards": [ ... ], "updated_at": "..." } ],
    "collection":   [ { "card_no": "...", "card_no_extend": "...", "langs": [ { "language_code": "SC", "normal_qty": 2, "foil_qty": 0, "updated_at": "..." } ], "updated_at": "..." } ],
    "wishlist":     [ { "id": "...", "card_no": "...", "card_no_extend": "...", "language_code": "SC", "finish": "any", "qty_wanted": 1, "priority": 3, "status": "active", "updated_at": "..." } ],
    "loans":        [ { "id": "...", "direction": "out", "contact_id": "...", "card_no": "...", "card_no_extend": "...", "qty": 1, "loaned_at": "...", "due_at": "...", "status": "active", "updated_at": "..." } ],
    "contacts":     [ { "id": "...", "name": "...", "wechat": "...", "note": "...", "updated_at": "..." } ],
    "purchaseLists":[ { "id": "...", "name": "...", "deck_id": "...", "status": "open", "items": [ ... ], "updated_at": "..." } ],
    "matches":      [ { "id": "...", "deck_id": "...", "games": [ ... ], "updated_at": "..." } ],
    "lockers":      [ { "id": "...", "name": "...", "sections": [ { "id": "...", "cards": [ ... ] } ], "updated_at": "..." } ],
    "customPrints": [ { "print": { "id": "...", "card_no": "CUSTOM-...", "card_no_extend": "...", "language": "SC", "img_cdn": "local://custom-...", "tts_cdn": null }, "baseCard": { "id": "...", "card_no": "CUSTOM-...", ... } } ],
    "settings":     { "playerName": "...", "defaultLanguage": "SC", "locale": "zh-CN", "darkMode": false, "rulesTheme": "parchment" }
  },
  "tombstones": [ { "entity_type": "deck", "entity_key": "...", "updated_at": "..." } ]
}
```

要点：
- 卡组/购买清单/卡柜/对局以「实体聚合」为行（含子表），子表不单独出同步行 → 单实体原子合并，天然免版本碎片。
- 收藏/心愿/借还/联系人以「行」为单位（量大、跨设备交错编辑多）。
- 自定义打印以「print + 引用的 CUSTOM 基础卡」成对打包。

## 7. 合并引擎（engine.ts）

输入：本地实体集 + 远端实体集（bundle 或 Git 仓库文件）。输出：合并后的写回计划。

```
合并规则（每个同步行）：
  同键比较 updated_at：
    - 远端 > 本地 → 采用远端
    - 本地 > 远端 → 保留本地
    - 相等 → 按 deviceId 字典序，大者胜（确定性决胜，避免震荡）
  删除：
    - 墓碑.updated_at > 实体行.updated_at → 删除本地行
    - 实体行.updated_at > 墓碑.updated_at → 复活（忽略墓碑）
写回顺序（withTransaction 内，FK OFF 窗口，引用序）：
  tombstones → decks(→versions→cards) → collection(→langs) → contacts → loans
  → wishlist → purchaseLists(→items) → matches(→games) → lockers(→sections→cards)
  → customPrints(→cards_base/card_prints) → settings
结束后：
  repointDeckCardReferences()   // 按 print_code 重链卡组引用
  cleanupOrphans()              // 清理已下架印刷的收藏/失效引用
  captureCollectionSnapshot()   // 保持进度快照口径一致
  finally 恢复 PRAGMA foreign_keys = ON
```

- 冲突被覆盖的本地行若被其他本地实体引用（如收藏被清单引用），走 `cleanupOrphans()` / 保留快照语义兜底，不主动级联删除用户显式数据。
- 所有 db 访问统一走 `getDatabase()` + `withTransaction()`（串行槽），与全局串行队列一致。

## 8. 传输层

### 8.1 传输 A：手动 Sync Bundle（基线，本期实现）

- 设置页 → 本地数据库区新增「导出同步包 / 导入同步包」。
- 复用现有数据包/备份交互（`data-pack-service` / `saveTextFile` / 恢复前校验模式）。
- 导出：engine 提取全部同步实体 → bundle JSON（含校验和）→ 用户选目录保存。
- 导入：校验 schema 版本与校验和 → 与本地合并 → 写回（§7 流程）→ 成功后更新 last_sync 游标。
- 能力：换机/离线迁移；与「一键完整数据包」互补（bundle 聚焦玩家数据，数据包含内容库副本）。
- 传输无关：Web / 桌面通用。

### 8.2 传输 B：Git 私有仓库（连续同步，桌面）

- `Cargo.toml` 加 `git2`（libgit2 自包含）；command（`spawn_blocking` + 超时）：
  - `git_ping_remote(url, token)`：连通性验证。
  - `git_sync(url, token, localDir)`：`fetch → 读 rune-archive-sync/*.json → merge（§7 引擎，输入=本地+远端文件）→ 写合并结果 → commit → push`；push 被拒则 fetch+重试 ≤3 次。
- 仓库目录 `rune-archive-sync/`：`decks.json` / `collection.json` / `wishlist.json` / `loans.json` / `contacts.json` / `purchase-lists.json` / `matches.json` / `lockers.json` / `custom-prints.json` / `settings.json` / `tombstones.json`。
- 凭据：HTTPS token 模式（不实现 SSH），token 仅存本机设置。
- 触发：启动联网后自动 pull；退出前（Tauri `CloseRequested`）兜底 push；设置页手动按钮。
- 限制：仅桌面；Web 隐藏。

### 8.3 传输 C：Supabase BYO（远期/可选）

- 保留但降级为「可选进阶」：每实体一张 `user_<entity>` 表（含 `user_id` 列，`PRIMARY KEY(user_id, id)`）+ `user_tombstones`，设置页「复制建表 SQL」。
- 权限默认收紧为可选 RLS（`auth.uid()`），不再把「anon key + 宽松权限」作为默认，弱化 v1 的安全洞。
- 本期不实现，仅保留接口占位（`supabase-transport.ts` 空壳 + 建表 SQL 模板）。

## 9. 同步流程与触发

```
内容同步（5 张表）成功
        │
        ▼
玩家数据同步（bundle 或 Git）
  pull：远端实体集 + 墓碑 → 合并引擎 → withTransaction 写回 → 更新 last_sync 游标
  push：本地 updated_at > push 游标 的实体/行 + 新增墓碑 → 封装为 payload 上行 → 更新游标
```

- 触发时机：
  - 手动 Bundle：用户点击导出/导入（唯一入口）。
  - Git 模式：启动联网后自动 pull；退出前兜底 push；设置页手动「立即同步」。
- 幂等：bundle/文件行级 upsert 按稳定键，重复导入不产生重复行（与现有 CSV 回导、购买清单 upsert 同模式）。
- 与内容同步互斥：玩家数据同步不应与内容同步并发（复用 `withTransaction` 串行槽，天然串行）。

## 10. 安全与隐私

- 同步包含联系人（微信/QQ/电话）等私密信息：导入导出均需用户主动操作，设置页提示「妥善保管，勿外传」。
- Git token / Supabase URL+key / 仓库地址：仅存本机（plugin-store），**绝不进入 bundle / 仓库文件**。
- 远期可加 bundle 口令加密（AES，口令不落盘），本期不做。
- 无账号体系：单机单用户；跨设备假定同一使用者。

## 11. 实施阶段

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| 1. 基建 | `sync_meta`/`sync_tombstones` 建表 + `state.ts` + `engine.ts`（实体提取/合并/墓碑）+ 硬删路径补墓碑 + 设置页同步区块（导出/导入 Bundle UI） | `pnpm check` 通过；导出/导入 Bundle 收藏与卡组双向正确 |
| 2. Bundle 全量 | 覆盖全部实体（§3.1）+ 自定义打印 + settings 白名单 + 校验和/版本校验 + 导入前备份提示 | 两设备互导 Bundle，LWW 与墓碑删除传播验证通过 |
| 3. Git 传输 | `git2` + `git_sync`/`git_ping_remote` + `git-transport.ts` + 触发策略 | 测试私有仓库 pull/merge/push 与 push 冲突重试通过 |
| 4. 收尾 | 退出前自动 push / 启动 pull 打磨 + Web 模式验证 + `supabase-transport.ts` 空壳与建表 SQL | 全范围可用；`cargo check` 通过 |

## 12. 关键设计决策记录

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 同步范围 | 只同步高价值业务实体；历史/快照/自定义语言不同步 | 减面、减量、减冲突；可重建数据用数据包覆盖 |
| 传输分级 | Bundle 基线 → Git 连续 → Supabase 远期 | 零基建先落地；Git 免云自托管 + 全历史；Supabase 为可选进阶 |
| 卡组/清单/卡柜/对局 | 实体聚合同步（含子表） | 单实体原子合并，避免子表碎片化与版本漂移 |
| 收藏/心愿/借还/联系人 | 行级同步 | 量大且跨设备交错编辑多，行级 LWW 更精细 |
| 冲突策略 | LWW（updated_at）+ deviceId 决胜 | 个人应用可接受；snowflake 无 id 冲突；决胜规则确定性 |
| 删除传播 | 本地硬删 + `sync_tombstones` 墓碑 | 不依赖软删改造全部表；复活语义按时间戳 |
| 内容引用 | 稳定键（card_no / print_code），pull 后重链 | 内容重同步换 id 不破坏玩家数据 |
| 增量标记 | 行 `updated_at > 游标`（需审计确保各表 bump） | 零显式脏标记；实施阶段审计补齐 |
| 安全 | 同步配置永不随包；Supabase 默认收紧 RLS | 避免 v1 的 anon key 公开洞 |
| 事务 | 一律 `withTransaction()`（串行单连接） | 与全局串行队列一致，避免跨语句锁库 |

## 13. 风险与注意事项

- **设备时钟偏差**：LWW 依赖客户端 `updated_at`，极端偏差可能旧盖新。缓解：deviceId 决胜只解决相等时间，不解决时钟错乱；可在 bundle 头带 `generatedAt` 提示，长期可加混合逻辑时钟。
- **`updated_at` 覆盖审计**：若某条写入路径未 bump `updated_at`，增量 push 会漏同步。实施阶段逐表审计（现有写入均走 `now()`，风险低）。
- **内容库过期**：远端 bundle 携带的 `card_no` 可能已下架；pull 后 `cleanupOrphans()` 会删对应收藏行，属预期行为，但设置页需在导入时提示「将以本地最新内容库为准」。
- **Git push 竞态**：多设备同时 push 经 fetch+merge+重试收敛；`git2` 增加打包体积与编译时间（仅桌面）。
- **自定义打印图片**：`img_cdn = local://custom-<token>` 对应的图片文件在设备本地；bundle 只同步元数据，**图片文件不跨设备**。如需要，纳入数据包（整库）方案另传图片目录。
- **大 Bundle**：收藏全量导出可能较大；可后续加「按实体选择导出」缩小体积。

## 14. 验证方式

- 前端 `pnpm check`；Rust `cargo check`（阶段 3 起）。
- 手动：两台设备（或桌面 + Web）经 Bundle / Git 双向编辑收藏、卡组、借还、清单、卡柜，验证 LWW、deviceId 决胜与墓碑删除传播；导入含已下架卡的 bundle 验证 `cleanupOrphans()` 行为。
- 仓库无 CI、无测试脚本，不做自动化测试。
