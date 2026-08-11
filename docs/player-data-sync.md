# 玩家数据同步设计文档（Rune Archive）

> 状态：设计定稿，待实施
> 同步范围决策日期：2026-08-11

## 1. 背景与目标

当前数据架构为 Local-first：内容数据（卡牌/卡图/图标/规则/系列）从开发者自有 Supabase 实例单向拉取到本地 SQLite；所有玩家自有数据（收藏、卡组、对局记录、自定义打印、玩家资料）仅存在于本地，跨设备只能手动备份整个 db 文件或 JSON 导入导出。

本文档设计玩家自有数据的**双向、多设备同步**能力，采用**可插拔传输层**，支持两种后端：

- **Supabase（玩家自带实例，BYO）**：玩家注册自己的 Supabase 项目，在设置页填入 URL + anon key。与开发者的内容分发实例完全分离、互不干涉。
- **Git 私有仓库**：玩家配置私有仓库（GitHub / Gitee / GitLab / 自建 Gitea 等）HTTPS URL + token，通过 Rust `git2` 集成，实体级 JSON dump 提交，天然获得全历史版本与回滚。

## 2. 同步范围（已确认）

| 类别 | 本地表 | 同步粒度 |
|---|---|---|
| 卡组 | `decks` / `deck_versions` / `deck_cards` | 按 deck 实体（含版本快照） |
| 收藏 | `collection` / `collection_langs` / `custom_languages` / `collection_history` / `collection_history_items` / `collection_stats_snapshots` | 行级 |
| 对局记录 | `match_records` / `match_games` | 行级 |
| 自定义打印 | `card_prints`（`is_custom=1`）+ 引用的自定义基础卡 | 实体级 |
| 玩家资料/设置 | settings.json（plugin-store） | JSON blob |

**明确不纳入同步**（本地派生/可重建）：`filter_options`（重下 cards 后自动重建）、`version`（内容同步游标）。同步配置本身（玩家自己的 Supabase URL/key、Git 仓库 URL/token）**不随 settings 同步**，每设备独立配置。

**排除项说明**：内容表 `cards_base` / `card_prints`（非自定义部分） / `icons` / `rules` / `series` / `version` 已由现有内容同步机制覆盖，不在本方案范围。

## 3. 总体架构

```
┌─────────────────────────────────────────────────┐
│                   本地 SQLite                     │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ 内容表(5张) │ │ 玩家数据表   │ │ user_sync_*  │  │
│  │            │ │ (11张+settings)│ │ 新表(游标/墓碑)│  │
│  └────────────┘ └────────────┘ └──────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │ 公共同步引擎 engine.ts
             （实体提取 / LWW 合并 / 墓碑应用，传输无关）
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
 supabase-transport.ts            git-transport.ts
   （Web + 桌面通用）               （仅桌面，Rust git2）
        │                              │
┌───────┴─────────┐          ┌─────────┴──────────┐
│ 玩家自己的 Supabase │          │ 私有 Git 仓库        │
│ URL + anon key    │          │ URL + token        │
└─────────────────┘          └────────────────────┘
```

### 3.1 双实例隔离

- **内容实例（开发者）**：托管 `version` / `cards_base` / `card_prints` / `icons` / `rules` / `series`，仅只读。现状不变。
- **用户数据实例（玩家 BYO）**：托管全部 `user_*` 表 + `user_tombstones`。玩家在设置页填入自己注册的 Supabase URL + anon key（仅存本机）。
- 未配置用户数据实例时，用户数据同步禁用，设置页提示配置。

## 4. 本地改动

### 4.1 新增表（`src/lib/db/config/schema.ts`）

```sql
-- 同步游标：每张用户表一行，记录上次拉取/推送时间
CREATE TABLE IF NOT EXISTS user_sync_state (
  table_name TEXT PRIMARY KEY,
  last_pull_at TEXT,
  last_push_at TEXT
);

-- 墓碑：删除跨设备传播（本地现有表结构零改动）
CREATE TABLE IF NOT EXISTS user_sync_tombstones (
  id TEXT PRIMARY KEY,              -- snowflake
  entity_type TEXT NOT NULL,        -- deck / collection / collection_lang / match / custom_print ...
  entity_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
```

### 4.2 缺失 `updated_at` 的表补列（复用现有 `ensureColumn` 迁移）

`deck_versions` / `deck_cards` / `match_games` 等缺 `updated_at`，用现有 `ensureColumn` 模式迁移补列；append-only 表（history / snapshots）按 `created_at` 增量。

### 4.3 新增代码目录 `src/lib/db/service/user-sync/`

| 文件 | 职责 |
|---|---|
| `engine.ts` | 实体提取、LWW 合并、墓碑应用（传输无关核心） |
| `state.ts` | `user_sync_state` 读写 |
| `supabase-transport.ts` | 玩家 Supabase 实例的 pull/push 适配器 |
| `git-transport.ts` | Git 仓库适配器（调用 Rust command） |
| `index.ts` | 编排：pull / push 流程、触发时机 |

## 5. 传输一：Supabase（玩家自带实例）

### 5.1 建表脚本

内置 SQL 模板（14 张 user 表 + `user_tombstones`），设置页「复制建表 SQL」按钮一键复制，玩家在自己项目的 SQL Editor 执行。

统一模式：**本地表全列 + `user_id` 列，主键 `(user_id, id)`**。

```sql
create table public.user_decks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  name text not null, description text, format text, cover_image text,
  tags text, is_favorite integer, created_at text, updated_at text,
  primary key (user_id, id)
);
```

需建表清单：`user_decks`、`user_deck_versions`、`user_deck_cards`、`user_collection`、`user_collection_langs`、`user_custom_languages`、`user_collection_history`、`user_collection_history_items`、`user_collection_stats_snapshots`、`user_match_records`、`user_match_games`、`user_custom_cards`、`user_custom_prints`、`user_settings`（`key, value JSONB`）、`user_tombstones`。

### 5.2 权限模型（无账号体系）

- 用 anon key 直连，脚本默认**宽松权限**（RLS 不启用或 permissive 策略），符合「互不干涉、低摩擦」定位。
- 风险提示（设置页展示）：anon key 公开，他人拿到 key 可读写该实例；个人低敏感数据可接受。
- 脚本附注释版 RLS 策略（`user_id = auth.uid()`），在意安全的玩家可自行开启 Auth + RLS（远期可加登录支持）。

### 5.3 同步语义

- **Pull**：内容同步完成后执行。按 `updated_at > last_pull_at` 增量拉取 + 墓碑；行级 upsert（`onConflict: 'user_id,id'`，幂等）；FK OFF 窗口内按引用序写入（decks→versions→cards、collection→langs），结束后 `cleanupOrphans()` + `repointDeckCardReferences()`。
- **Push**：`updated_at > last_push_at` 批量 upsert + 墓碑上行。**无需显式标脏** —— SQL 增量条件天然实现。
- **触发时机**：启动联网后自动 pull；应用退出前（Tauri CloseRequested / Web beforeunload）兜底 push；设置页提供手动同步按钮。
- **冲突策略**：行级 **LWW（last-write-wins，`updated_at` 后写胜出）**。snowflake id 全局唯一 → 无 id 冲突；deck 用版本快照天然免冲突。
- **删除传播**：本地删除 → 写墓碑（含 `deleted_at`）→ 上行墓碑 → 其他设备 pull 时删除本地行。

## 6. 传输二：Git 私有仓库（本期同步实现）

### 6.1 Rust 侧（`src-tauri`）

- `Cargo.toml` 增加 `git2` crate（libgit2 自包含，免外部 git 依赖，桌面 + Android 均可编译）。
- `lib.rs` 新增 command（均 `spawn_blocking` + 超时）：
  - `git_ping_remote`：验证仓库 URL + token 可访问。
  - `git_sync`：执行 `fetch → 读远端 dump → merge → 写合并结果 → commit → push`；push 被拒则 fetch 重试 ≤3 次。
- 凭据：HTTPS token 模式（不实现 SSH），token 仅存本地设置。

### 6.2 仓库格式

- 子目录 `rune-archive-sync/` 下**实体级 JSON**（JSON 带 schema 版本头）：
  - `decks/<id>.json`（deck 元数据 + 全部版本 + 卡牌）
  - `collection.json`（收藏行级数据）
  - `matches/<id>.json`
  - `custom-prints/<id>.json`（自定义打印 + 引用的自定义基础卡）
  - `settings.json`（玩家资料/设置）
  - `tombstones.json`（墓碑）
- **不提交二进制 SQLite**（无法 diff/合并）。

### 6.3 合并语义

fetch 后**先读远端文件 → 行级 LWW 合并 → 写回合并结果 → commit → push**（非简单文件覆盖，与 Supabase 传输相同的数据语义）。Git 全历史天然获得版本回滚。

### 6.4 限制

仅桌面端可用；Web 模式自动隐藏该选项。

## 7. 实施阶段

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| 1. 基建 | schema 新表 + `engine.ts` + `state.ts` + 设置页同步区块（provider 选择/表单/状态/手动同步按钮） | 设置页可配置同步方式；`pnpm check` 通过 |
| 2. Supabase 传输 | 建表 SQL 模板与复制按钮 + `supabase-transport` + 收藏 6 表全流程 | 两台设备经同一玩家实例双向同步收藏；LWW 与墓碑删除传播验证通过 |
| 3. Git 传输 | `git2` + Rust command + `git-transport` + 卡组 3 表 + 对局 2 表 | 测试私有仓库验证 pull/merge/push 与 push 冲突重试 |
| 4. 收尾 | 自定义打印（`CUSTOM-<snowflake>` 前缀防冲突）+ settings 同步（不含同步配置本身）+ 触发策略打磨 + Web 模式验证 | 全范围双向同步可用 |

## 8. 关键设计决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 用户数据实例归属 | 玩家自带 Supabase（BYO），与开发者内容实例隔离 | 互不干涉；玩家数据自持 |
| 登录方式 | 无账号体系，anon key 直连 + 宽松权限 | 低摩擦；脚本附可选 RLS 注释，远期可加 Auth |
| 删除传播 | 墓碑软删（新增 `user_sync_tombstones`） | 本地表零改动，删除跨设备传播 |
| 冲突策略 | 行级 LWW（`updated_at` 后写胜出） | 个人应用可接受；snowflake 无 id 冲突 |
| 增量标记 | 无需显式 dirty flag，SQL `updated_at > 游标` | 零侵入，无钩子 |
| Git 方案 | 本期与 Supabase 同步实现 | 提供免云自托管备选 + 免费全历史 |
| 同步配置本身 | 不同步，每设备独立配置 | URL/key/token 属本机凭据 |

## 9. 风险与注意事项

- **anon key 公开性**：玩家数据实例可被拿到 key 的第三方读写；设置页需提示，脚本提供可选 RLS。
- **设备时钟偏差**：LWW 依赖客户端 `updated_at`，极端时钟偏差可能导致旧数据覆盖新数据（个人应用可接受，不做服务器时钟校准）。
- **Git push 竞态**：多设备同时 push 通过 fetch + merge + 重试收敛。
- **Android 编译体积**：`git2`/libgit2 增加打包体积与编译时间。
- **自定义打印引用**：自定义卡 `card_no` 用 `CUSTOM-<snowflake>` 前缀，避免与官方卡号冲突；pull 后写入本地 `cards_base`/`card_prints` 并标 `is_custom=1`（现有保留逻辑自动保护）。

## 10. 验证方式

- 前端：`pnpm check`；Rust：`cargo check`。
- 手动验证：两台设备（或桌面 + Web）使用同一玩家实例，双向编辑收藏/卡组/对局，验证 LWW 与墓碑删除传播；Git 传输用测试私有仓库验证 push 冲突重试。
- 仓库无 CI、无测试脚本，不做自动化测试。
