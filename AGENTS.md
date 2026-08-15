# AGENTS.md

> 本文档由源码考古生成（读取 package.json / Cargo.toml / tauri.conf.json / lib.rs / capabilities / src/lib/db / .github/workflows / 锁文件 / 插件 crate 源码等），
> 不含 docs/ 目录内容；与任何文档冲突时以源码为准。标注「未确认」的事项表示无法从仓库内代码验证。

## 项目速览

- **Rune Archive（符文档案）**：面向《符文战场》（Riftbound）TCG 的卡牌收藏 / 卡组管理桌面应用，同时支持 Android（`src-tauri/gen/android`，iOS 未在 CI 中构建）。
- 技术形态：**Tauri v2**（Rust 后端 + WebView 前端）+ **Svelte 5 / SvelteKit SPA**（`adapter-static` + `fallback: 'index.html'`，`+layout.ts` 设 `ssr = false`）+ **Vite 6** + TypeScript strict。
- 数据架构为 Local-first：内容数据（卡牌 / 卡图 / 规则 / 图标 / 系列）从 **Supabase** 按表拉取写入本地 **SQLite**（`tauri-plugin-sql`），离线读本地；玩家自有数据（卡组 / 收藏 / 心愿单 / 借还 / 联系人 / 购买清单 / 对局 / 储物柜 / 自定义打印 / 设置）通过 Bundle 文件或 Supabase BYO 做跨设备 LWW 合并同步。
- 功能模块：卡牌库浏览 / 搜索 / 筛选、收藏与闪卡（多语言）、卡组构建（Deck Code 编解码 / QR 导入导出 / 版本历史 / PDF 与图片导出）、规则书、对局记录、心愿单 / 借还 / 联系人 / 购买清单、储物柜、开包与结算链模拟器、TTS（Tabletop Simulator）TCP 通信、条码扫码导入、骰子 / 对局计分器、完整数据包备份。
- 核心入口：前端 `src/routes/+layout.svelte`（启动初始化：建库 / 内容同步检查 / 备份提醒 / 自动云同步）；Rust 侧 `src-tauri/src/lib.rs`（插件注册 + 10 个 command，以 `generate_handler!` 为准）；数据层统一入口 `src/lib/db/index.ts`。
- 版本 0.8.5（`package.json` / `Cargo.toml` / `tauri.conf.json` 一致）；当前分支 `enhance/integrate-tauri`，远程默认分支 `main`（origin `https://github.com/choowx2002/fuwendangan.git`）。

## 技术栈

| 层 | 技术 | 版本 / 说明 |
| --- | --- | --- |
| 前端框架 | Svelte 5 | ^5.0.0，runes 语法（`$state` / `$props` / `$derived`） |
| 元框架 | SvelteKit | ^2.9.0，SPA 模式（adapter-static fallback index.html，`ssr=false`） |
| 构建 | Vite | ^6.0.3，端口 1420 `strictPort: true`（`vite.config.js`） |
| 语言 | TypeScript | ~5.6.2，`strict: true`，`allowJs/checkJs` |
| 桌面框架 | Tauri | v2（schema `/config/2`，`tauri = "2"`，CLI `@tauri-apps/cli@^2.11.4`），Rust edition 2021 |
| 包管理 | pnpm | 锁文件 `pnpm-lock.yaml`（lockfileVersion 9 → **需 pnpm ≥ 9**）；`pnpm-workspace.yaml` 仅含 allowBuilds（core-js / es5-ext / esbuild），非 monorepo；**版本未锁定**（package.json 无 `packageManager` 字段） |
| 远程数据 | Supabase | `@supabase/supabase-js ^2.108.2`，凭证在本地 `.env.local`（gitignored） |
| 本地数据库 | SQLite | `tauri-plugin-sql ~2.4.0`（sqlx 连接池），库名 `sqlite:tcg_cards.db`（`src/lib/db/config/constants.ts`），落盘于 **`$APPCONFIG`**（见「如何运行」） |
| 语言 | svelte-i18n | ^4.0.1，`src/locales/zh-CN.json` + `en.json`（各 1654 行）；`systemLocale()` 现恒返回 zh-CN（navigator 探测被注释，`src/lib/i18n.ts`） |
| 其他关键依赖 | `@lucide/svelte`（图标）、`@theinternetfolks/snowflake`（ID）、`@thisux/sveltednd`（拖拽）、`@piltoverarchive/riftbound-deck-codes`（Deck Code）、`jspdf` / `qrcode` / `jsqr`（PDF / QR）、`@choochmeque/tauri-plugin-sharekit-api 0.4.0-rc.5`（分享文件）、`@tauri-apps/plugin-barcode-scanner`（仅移动端） | |
| Rust 依赖（额外） | `tauri-plugin-prevent-default 5.0.2`（特例版本号）、`tauri-plugin-sharekit 0.4.0-rc.5`、`tauri-plugin-deep-link 2`、`rusqlite 0.32`（bundled，备份校验用）、`zip 2`、`base64 0.22` | `src-tauri/Cargo.toml` |
| CI | GitHub Actions | 仅 `.github/workflows/release.yml`：tag `v*` 或手动触发；Windows NSIS / Linux all / Android（APK+AAB）；Node 20、Rust stable、Java 17、NDK 26.1.10909125。**只做发布构建，不跑任何静态检查** |

## 目录结构

```
fuwendangan/
├── package.json / pnpm-lock.yaml / pnpm-workspace.yaml   # 前端清单与锁文件
├── vite.config.js          # Vite 配置（端口 1420、忽略 src-tauri 监听、TAURI_DEV_HOST）
├── svelte.config.js        # adapter-static fallback（SPA）
├── tsconfig.json           # strict，extends .svelte-kit/tsconfig.json（$lib 别名由 SvelteKit 生成）
├── prettier.config.js      # 无分号、单引号、printWidth 100、prettier-plugin-svelte
├── .prettierignore         # 排除 node_modules / build / .svelte-kit / target / pnpm-lock.yaml 等（未排除 docs/ 与 AGENTS.md）
├── .env.example            # VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
├── .github/workflows/release.yml  # 唯一 CI：桌面 + Android 发布构建
├── src/                    # 前端源码
│   ├── app.html / app.css  # HTML 壳 / 全局样式
│   ├── assets/fonts/       # 字体资源（已入库）
│   ├── locales/            # zh-CN.json / en.json（svelte-i18n）
│   ├── routes/             # SvelteKit 路由（SPA）：/ cards collection(+history/loans/missing/
│   │                       #   wishlist/purchase-lists) decks(+builder,+[deckid]/records) locker
│   │                       #   rules scanner settings simulator(chainSimulator/packOpener) tools(dice/gameCounter)
│   │   └── +layout.svelte  # 根布局：数据库初始化 / 同步 / 备份提醒入口
│   └── lib/
│       ├── db/             # 数据层核心（统一经 index.ts 导出）
│       │   ├── config/     # schema.ts（全部表 DDL）/ constants.ts / languages.ts / collection-rules.ts
│       │   ├── repository/ # 22 个仓储（以目录为准）：database / card / print / rules / icon / filter /
│       │   │               #   version / stats / maintenance / collection(+history,+snapshot) / language /
│       │   │               #   series / locker / deck / contact / loan / wishlist / purchase-list /
│       │   │               #   match-record / sync
│       │   ├── service/    # sync-service（内容同步）/ remote-api（Supabase 拉取）/ search / filter /
│       │   │               #   completion-modes / user-sync（玩家数据同步）
│       │   ├── env.ts      # isTauri（检测 __TAURI_INTERNALS__）/ isWeb
│       │   ├── helper.ts   # 行映射 / 序列化（mapRowToCard 等）
│       │   ├── types.ts    # 全量业务类型（783 行）
│       │   └── index.ts    # 统一导出入口（类型 + 仓储 + 服务 + 工具）
│       ├── cards/          # 卡牌工具（config/constants、effect/print/cost-curve/options/variant/deckSerializer）
│       ├── collection/     # 收藏相关 CSV 导出导入（collection / full-collection / loan / purchase / wishlist）
│       ├── components/     # 可复用组件（cards / collection / decks / layout(AppShell) / locker / simulator / ui）
│       ├── csv/            # csv-utils.ts
│       ├── decks/          # deck-code / deck-import(QR) / deck-export / deck-validator / version-diff / zone / format 等
│       ├── locker/         # locker-csv.ts
│       ├── services/       # tts-communication / db-file / image-cache / card-image-download /
│       │                   #   card-image-zip-import / data-pack(备份) / deck-image / locker-csv /
│       │                   #   log-service / pack-service / proxy-export / backup-reminder / rules
│       ├── simulator/      # chain.ts（结算链）
│       ├── stores/         # settings.ts(plugin-store 持久化) / ui-store.svelte.ts($state) / network.svelte.ts /
│       │                   #   tts / tools / qr-scan / pinned-decks / deck-import / rules
│       └── utils/          # longpress / network / os / route-config / time-helper / confirm
├── src-tauri/              # Rust 后端
│   ├── Cargo.toml / Cargo.lock / build.rs   # Cargo.lock 已入库
│   ├── tauri.conf.json     # devUrl http://localhost:1420 / frontendDist ../build / beforeDevCommand pnpm dev
│   ├── capabilities/       # default.json（桌面权限）/ mobile.json（barcode-scanner）
│   ├── resources/external/ # 打包附带外部资源（当前为空目录）
│   ├── gen/                # 生成物：android 工程 + schemas（含手写的 MainActivity.kt / SAFPlugin.kt，见「高风险」）
│   └── src/
│       ├── main.rs         # 入口，windows_subsystem="windows"（勿删）
│       └── lib.rs          # 插件注册 + 10 个 command（以 generate_handler! 为准）+ SAF 插件
├── static/                 # favicon / logo / 稀有度与符文 SVG / 卡牌类型 SVG
├── build/                  # 前端构建产物（frontendDist，gitignored）
└── docs/                   # ⚠️ 按约定忽略：不读、不引用、不作为事实来源
```

## 核心架构

### 分层与数据流

```
路由页面 (src/routes) ──► stores ($lib/stores) / services ($lib/services)
        │                                   │
        ▼                                   ▼
统一入口 $lib/db/index.ts ──► service 层（sync/search/filter/user-sync）
        │                                   │
        ▼                                   ▼
repository 层（SQL 语句，一律 db.select/db.execute + ? 占位符）
        │                                   │
        ▼                                   ▼
tauri-plugin-sql（sqlx 连接池）──► 本地 SQLite：$APPCONFIG/tcg_cards.db
        ▲
Rust commands（src-tauri/src/lib.rs）：文件读写 / ZIP 解包 / SQLite 备份校验 / TTS TCP
```

- **内容数据流（同步）**：`+layout.svelte` onMount → `initializeDatabase()`（`src/lib/db/service/sync-service.ts`）→ 对比云端 / 本地 `version` 表每行 `updated_at` → 只重下更新的表（整表全量替换，无逐行 diff）→ 下载全部进内存后写库：`PRAGMA foreign_keys = OFF` → 先清后插（`clearAllCards → clearAllPrints → saveCards → saveCardPrints → 附属表`）→ `repointDeckCardReferences()` 重链卡组引用 → `cleanupOrphans()` / `updateFilterOptions()` 条件后处理 → 最后按表 upsert 本地 version 行 → `finally` 恢复外键。崩溃中断时本地 version 不动，下次启动自动重试。
- **玩家数据流（同步）**：`src/lib/db/service/user-sync/` —— 提取 11 类实体（decks/collection/wishlist/loans/contacts/purchaseLists/matches/lockers/customPrints/settings/tombstones）→ `buildSyncWritePlan()` 做 **LWW 合并**（同键比 `updated_at`，相等时 deviceId 字典序大者胜）+ **墓碑收敛**（墓碑新于实体则删除，实体新于墓碑则复活）→ `applySyncPlan()` 在 `withTransaction()` 内按依赖序写回。传输两种：手动 Bundle JSON（`bundle.ts` / `engine.ts`）与 Supabase BYO（`supabase-transport.ts`：单行 `user_sync_bundle(user_id, device_id, updated_at, data jsonb)` + RLS，全量 pull/push，校验和相同跳过上行）。
- **搜索/筛选**：`search-service.ts`（`searchCards` / `searchCardVariants`）+ `filter-service.ts`（重建 `filter_options` 单行表）。

### 关键抽象

- **数据库单例 + 全局串行队列**（`repository/database.ts`）：`getDatabase()` 共享 Promise 缓存，避免重复打开连接池；`select/execute` 被包装进 promise 队列，保证任何时刻只有一个 db 操作（sqlx 多连接池下 `BEGIN/COMMIT` 跨语句事务不可靠，移动端实测报 `cannot commit - no transaction is active`，因此**全项目禁用跨语句事务**）。`withTransaction()` 名义保留事务名，实为在单个串行槽内用原始方法（`__rawSelect/__rawExecute`）执行一批写，避免队列重入死锁。
- **Schema 即代码**（`config/schema.ts`）：`TABLE_DEFINITIONS` 含全部 `CREATE TABLE IF NOT EXISTS` + 索引 + `DROP`；新表建表与老库补列走同一路径，`ensureColumn()` 负责为老库加列；另有 4 个一次性语义迁移（`migrateVersionSemantics` 清理旧 version 行、`backfillPrintCardNo` 回填 card_no 快照、`migrateLegacyWishlistRows` 心愿单语义迁移、`migrateAnyLangToSc` 移除 `*` 语言），均在读保护（存在遗留行）下才写库。
- **统一导出**：所有类型 / 仓储 / 服务 / 工具经 `src/lib/db/index.ts` 导出，页面与组件只从 `$lib/db` 导入。
- **设置持久化**：`stores/settings.ts` 的 `persistentWritable()` 基于 `tauri-plugin-store`（`settings.json`，落盘 `$APPDATA`）；用户可同步白名单键（`rulesTheme/playerName/locale/defaultLanguage/darkMode` 等）修改时写 `sync_meta` 游标参与云同步。
- **Rust command 契约**：`Result<T, String>` 返回、`#[tauri::command(async)]` + `spawn_blocking` 处理阻塞 I/O、`window.emit("tts-message", …)` 向前端推事件；前端 `invoke` 一律从 `@tauri-apps/api/core` 导入（`tts-communication-service.ts` / `db-file-service.ts`）。
- **AI / LLM 相关机制**：无。本项目不含 Agent / prompt / LLM / RAG / 模型供应商代码（依赖清单与源码中均未发现）。

### 同步契约（务必遵守）

- **内容同步范围**：仅 5 张表 —— `cards` / `prints` / `icons` / `rules` / `series`（云端表名分别为 `cards_base` / `card_prints` / `card_icons` / `rules` / `series`，见 `remote-api.ts`）；云端 `version` 表每张同步表一行（`name` = 表标识，`updated_at` = 发布时间）。
- **发布纪律**：任何同步表数据增删改后必须刷新该表云端 version 行；新增卡牌须同时刷 `cards` 与 `prints` 两行，否则客户端不更新。⚠️ 云端表的发布/刷新流程不在本仓库内（无脚本），属**未确认**环节。
- **自定义打印保留**：`clearAllCards` / `deleteCardsExcept` / `deletePrintsExcept` 均保留 `is_custom=1` 自定义打印及其引用的基础卡；`clearCardData()`（`repository/maintenance.ts`）按「先清卡图、再清卡基」顺序执行。
- **card_no 快照**：`card_prints.card_no` 是 `cards_base.card_no` 的稳定快照（云端同步填充 / 自定义打印写入 / 老库 `backfillPrintCardNo` 回填），用于 card_id 失效后按卡号重链。

### 最关键的 10 个文件

1. `src/lib/db/config/schema.ts` — 全部表结构
2. `src/lib/db/repository/database.ts` — 连接单例 / 串行队列 / 迁移
3. `src/lib/db/service/sync-service.ts` — 内容同步流程
4. `src/lib/db/service/user-sync/engine.ts` — LWW 合并引擎
5. `src/lib/db/index.ts` — 统一导出边界
6. `src/lib/db/service/remote-api.ts` — Supabase 拉取（含云端表名）
7. `src-tauri/src/lib.rs` — 全部 Rust command 与插件注册
8. `src-tauri/capabilities/default.json` — 权限边界
9. `src/routes/+layout.svelte` — 启动初始化
10. `src/lib/stores/settings.ts` — 持久化设置

## 扩展点与流程

### 新增内容同步表（5 步，缺一不可）

1. `src/lib/db/config/schema.ts` 加 `TABLE_DEFINITIONS` 条目；
2. `src/lib/db/config/constants.ts` 的 `TABLES` 注册表名；
3. `repository/database.ts` 的 `initializeTables()` 加入建表语句（并同步 `TABLE_DEFINITIONS.DROP` 清单）；
4. `service/sync-service.ts` 的 `SYNC_TABLE_NAMES` 加入表标识，`remote-api.ts` 加对应 `fetchAllX()`；
5. 云端建表 + 数据发布 + **刷新该表云端 `version` 行**（发布流程在仓库外，需人工确认）。

### 新增玩家同步实体（`user-sync` 扩展点，参照 `entities/decks.ts` 模板）

1. `entities/<type>.ts` 实现 `extractX / mergeX / applyX` 三函数（LWW + 墓碑语义）；
2. `engine.ts`：import 实体、`buildSyncWritePlan()` 加 merge 调用、`SyncWritePlan` / `ApplyResult` 加字段、`ALL_TOMBSTONE_TYPES` 登记（settings 无墓碑，除外）；
3. `types.ts` 的 `SyncEntityType` 与 bundle 容器同步扩展；
4. `schema.ts` 中 `sync_tombstones.entity_type` 注释同步；
5. 本地硬删路径必须写墓碑（`sync-repository.ts` 的 `addTombstone`），否则删除无法跨设备传播。

### 新增路由

- `src/routes/**` 建 `+page.svelte`（SPA 无 SSR，无需服务端代码）；
- 如需顶部返回按钮，在 `src/lib/utils/route-config.ts` 登记 `backTo`（`src/routes/cards/+page.svelte` 的返回逻辑读该表）；
- 用户可见文案加 `src/locales/zh-CN.json` 与 `en.json`。

### 新增 Tauri command

- `src-tauri/src/lib.rs` 写函数（snake_case、`Result<T, String>`、阻塞操作 `#[tauri::command(async)]` + `spawn_blocking` + 超时）；
- 在 `generate_handler!` 注册；
- 前端从 `@tauri-apps/api/core` 的 `invoke` 调用，参数名与 Rust 形参一致（camelCase 自动转换）；
- 如需新权限/新域名，在 `capabilities/default.json` 登记，否则前端报 `not allowed`。

## 如何运行

前置：Node ≥ 20（CI 用 20，依据 release.yml；package.json 无 engines 字段）、pnpm ≥ 9（lockfileVersion 9 的锁文件要求）、Rust stable（`rustup`）、Tauri v2 系统依赖（Linux 需 `libwebkit2gtk-4.1-dev` 等，见 release.yml 的 apt 列表）。本地 `.env.local` 需含：

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

（文件被 gitignore，clone 后不存在，按 `.env.example` 自建；缺 key 时内容同步与网络探测不可用。）

```bash
pnpm install                # 安装前端依赖（依据 package.json）
pnpm tauri dev              # 桌面开发：beforeDevCommand 自动跑 pnpm dev（Vite 1420）→ 启动窗口（依据 tauri.conf.json）
pnpm dev                    # ⚠️ 仅前端 Web 模式：无 Tauri 环境（无 invoke / 无本地库），数据页查询会抛错，
                            #    仅适合静态样式调试；全仓库仅 decks/[deckid] 的导出下载有 isWeb 分支
pnpm build                  # 前端构建到 build/（依据 svelte.config.js adapter-static；tauri build 前自动执行）
pnpm preview                # 本地预览 build/ 产物（package.json）
pnpm tauri build            # 完整桌面构建（前端 + Rust 打包）
pnpm tauri:build:linux      # Linux 专用：NO_STRIP=true tauri build（package.json，规避 strip 问题）
cd src-tauri && cargo check # Rust 侧检查（改动 lib.rs 后必跑；Cargo.toml/Cargo.lock 均入库）
```

**Android 本地开发前置**（依据 `.github/workflows/release.yml` android job）：

```bash
# 1. Rust targets（CI 同款 4 个）
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
# 2. Android SDK + NDK（CI 用 NDK 26.1.10909125），并设置 ANDROID_HOME / NDK_HOME / ANDROID_NDK_HOME
sdkmanager --install "ndk;26.1.10909125"
# 3. 安装 tauri-cli（CI 用 cargo install tauri-cli --version "^2" --locked）
cargo install tauri-cli --version "^2" --locked
# 4. 构建
cargo tauri android build   # 发布签名需 keystore secrets（见 CI）
cargo tauri android dev     # 推测：真机/模拟器开发模式（标准 tauri-cli 子命令，仓库内无脚本依据）
```

- **发布**：打 `v*` tag 推送到 GitHub 触发 `.github/workflows/release.yml`（也可 workflow_dispatch 手动指定 tag），产物：Windows NSIS 安装包、Linux 全格式、Android APK/AAB。
- **数据落盘位置**（Tauri 环境，依据插件 crate 源码验证）：
  - `$APPCONFIG/tcg_cards.db` — SQLite 主库（`tauri-plugin-sql` 把 `sqlite:` 路径解析到 app config dir，插件源码 `wrapper.rs`；Linux 例 `~/.config/com.tian-yue.fuwendangan/`）
  - `$APPDATA/settings.json`、`$APPDATA/session.json` — plugin-store 持久化设置与 BYO 登录会话（`tauri-plugin-store` 解析到 `BaseDirectory::AppData`，插件源码 `store.rs`；会话为明文，见 `vault.ts`）
  - `$APPLOCALDATA/cardImages/` — 卡图缓存；`$APPLOCALDATA/logs/app.log` — 错误日志（`db-file-service.ts` / `log-service.ts` 显式传 `BaseDirectory.AppLocalData`）

## 测试与验证

- **无任何测试框架 / 测试脚本 / 测试文件**（已核实：package.json 无 test script；全仓库无 `*.test.*` / `*.spec.*`；无 vitest / playwright / eslint 配置）。不要寻找或声称存在测试命令。
- **CI 无检查兜底**：`release.yml` 仅做发布构建，**不跑** `pnpm check` / `cargo check` / 测试；项目**无 pre-commit hook**（无 husky/lint-staged 配置）。自检义务全在本地：改动合入前必须本地跑通对应检查。
- 前端静态检查：`pnpm check`（`svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`；`pnpm check:watch` 可监听）。
- Rust 检查：`cd src-tauri && cargo check`（或 `cargo clippy`，非强制）。
- 格式化：`pnpm format`（prettier --write .）/ `pnpm format:check`（注意：`.prettierignore` 未排除 `docs/` 与 `AGENTS.md`，`pnpm format` 会顺带重排它们；只想格式化源码时显式传路径）。
- **修改后验证路径**：前端改动 → `pnpm check` 通过 + 手动 `pnpm tauri dev` 冒烟；Rust 改动 → `cargo check` + 实际调用对应 command 冒烟；同步/迁移改动 → 在**真实数据副本**上验证（旧库升级路径由 `initializeTables` 的迁移逻辑覆盖，务必保留一份旧库做回归）。

## 配置与环境变量

| 配置 / 变量 | 位置 | 说明与缺失影响 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local`（gitignored；`.env.example` 为模板） | `remote-api.ts` 的 `import.meta.env` 读取；**构建期注入**（Vite 约定），值在 dev/build 时打入产物，发布包无运行时读取逻辑；缺失 → `createClient(undefined)` 报错，首次同步失败；`network.svelte.ts` 探测降级为 `navigator.onLine` |
| `TAURI_DEV_HOST` | 环境变量（可选） | `vite.config.js`：远程真机/设备调试时设置 HMR host（端口 1421） |
| 内容同步来源 | 云端 Supabase 项目 | 表：`version` / `cards_base` / `card_prints` / `card_icons` / `rules` / `series`；库内无建表/发布脚本（未确认发布方式） |
| 玩家云同步 | 设置页填写 URL + anon key | 用户自建 Supabase 项目；建表 SQL 由 `buildSupabaseCreateTableSql()` 生成；会话存 `$APPDATA/session.json`（明文）；免费版闲置 7 天暂停后 URL 会变 |
| Tauri 权限 | `src-tauri/capabilities/default.json` | 每个 API 调用都需权限；fs scope 仅 `$APPCACHE` / `$APPLOCALDATA` / `$RESOURCE/resources/external`；`http:allow-fetch` 含 `https://**`（过宽） |
| 应用窗口 | `src-tauri/tauri.conf.json` | 单窗口 main，900×600，`csp: null`；Android 侧由 `gen/android` 维护 |
| 运行时设置 | `$APPDATA/settings.json`（plugin-store） | 键见 `stores/settings.ts`；含备份提醒间隔、BYO URL/key、autoSync 开关等 |
| TTS 端口 | 硬编码 `lib.rs` | 39999 发送 / 39998 接收，外部 Tabletop Simulator 约定，勿改 |

## 开发规范

1. **Svelte 5 runes**：新组件用 `$state` / `$props` / `$derived`（`$state` 仓库如 `ui-store.svelte.ts`、`network.svelte.ts`），避免旧式 `$:` 响应式；旧式 `writable` 仅用于 store 型状态（`settings.ts` 等）。
2. **数据访问边界**：SQL 只出现在 `src/lib/db/repository/` 与 `src/lib/db/service/`；组件/页面只从 `$lib/db`（`index.ts`）导入，不直接 import 内部模块（`settings.ts` 中 `sync-repository` 的直接导入是少数例外）；业务逻辑放 `$lib/services/`，全局状态放 `$lib/stores/`。
3. **SQL 参数**：一律 `?` 占位符防注入（`version-repository.ts` 的 `$1/$2` 是现存特例，新代码不要模仿）。
4. **Rust command**：snake_case 命名；`Result<T, String>`；阻塞操作 `#[tauri::command(async)]` + `tauri::async_runtime::spawn_blocking` + 超时（参考 `check_tts_connections` 3 秒超时）；禁止在主线程阻塞；禁止新引入 `unwrap()` 处理可能失败的 I/O（`send_to_tts` 有一处遗留 `unwrap()`）。
5. **Tauri v2 专用**：`invoke` 从 `@tauri-apps/api/core` 导入；事件用 `@tauri-apps/api/event` 的 `listen`；禁止 v1 路径（`@tauri-apps/api/tauri`、`window.__TAURI__`）；环境判断用 `src/lib/db/env.ts`（v2 检测 `__TAURI_INTERNALS__`）。**新增插件必须三处登记**：`Cargo.toml`（Rust crate + `init()` 注册）、`package.json`（`@tauri-apps/plugin-xxx@^2`）、`capabilities/*.json`（权限，否则前端报 not allowed）。
6. **文件 API**：路径用 `@tauri-apps/api/path`，读写用 `@tauri-apps/plugin-fs` 并显式传 `baseDir`（常用 `BaseDirectory.AppLocalData`）；大文件/跨平台走自定义 command（`copy_file` 等，Android 自动走 SAF content:// URI）。
7. **数据库事务纪律**：**禁止** `BEGIN`/`COMMIT`/`PRAGMA defer_foreign_keys` 跨语句事务；批量写走 `withTransaction()`；不要在串行队列之外并发访问 db（`database.ts` 注释即规范）。
8. **i18n**：用户可见文案加进 `src/locales/zh-CN.json` 与 `en.json`（键一一对应），页面用 `$t`（svelte-i18n）；`console.log` 调试代码提交前清理。
9. **格式化**：prettier（无分号、单引号、printWidth 100、`prettier-plugin-svelte`），提交前跑 `pnpm format`。
10. **迁移纪律**：老库升级走 `ensureColumn` / 一次性迁移函数（读保护才写库）；不要在 `initializeTables` 之外随手改表结构；新表必须同时加入 `schema.ts` 的 `TABLE_DEFINITIONS`、`config/constants.ts` 的 `TABLES`、`initializeTables` 建表清单，并评估 `DROP` 清单与云端同步范围。
11. **路由登记**：新增路由页面后，如需顶部返回按钮，须在 `src/lib/utils/route-config.ts` 登记 `backTo`（`src/routes/cards/+page.svelte` 的返回逻辑读该表）。
12. **提交与分支**：仓库无统一提交信息规范（git log 中英文混杂）、无 PR 模板（未确认）；发布由 tag `v*` 触发 CI（依据 release.yml），各分支（main/dev/stage/version-1/enhance/integrate-tauri）的发布语义未确认。

## 常见坑

1. **Vite 端口被占用**：`vite.config.js` 设了 `strictPort: true`，1420 被占则 `pnpm tauri dev` 直接失败；释放端口或同步修改 `tauri.conf.json` 的 `devUrl`（改端口必须两处一致）。
2. **前端报 `not allowed`**：Tauri v2 每个 API 调用都查 `capabilities/default.json`；新增插件/方法后先检查权限是否登记，再查代码。
3. **fs scope**：fs 操作受 `fs:scope` 限制，当前仅 `$APPCACHE` / `$APPLOCALDATA` / `$RESOURCE/resources/external`；访问其他目录前先扩展 scope，并显式传 `baseDir`（不传默认相对路径易出错）。
4. **HTTP 白名单过宽**：`http:allow-fetch` 含 `https://**`；新增请求域名注意与权限范围一致（如需收窄，改动此处）。
5. **CI 无兜底**：`release.yml` 只构建发布；`pnpm check` / `cargo check` 是本地自检的唯一防线，没有 pre-commit hook 会替你挡。
6. **`pnpm format` 会触碰 `docs/` 与 `AGENTS.md`**：`.prettierignore` 未排除它们；不想动文档时用 `pnpm format:check` 或显式传源码路径。
7. **首次同步依赖网络**：本地库无 version 行时启动触发全量同步（5 张表全部重下）；离线/弱网跳过同步、用本地数据，失败提示错误 toast 而非卡在加载态。

## 高风险区域

| 区域 | 风险原因 |
| --- | --- |
| `src/lib/db/config/schema.ts` + `repository/database.ts` | 所有表结构与启动迁移。`CREATE TABLE IF NOT EXISTS` 不会为老库补列；误改迁移逻辑可能破坏存量用户数据（无测试兜底）。 |
| `src/lib/db/service/sync-service.ts` | 内容同步按表全量替换；先清后插期间外键关闭；漏刷云端 version 行、打乱清理顺序会丢数据或损坏引用（`deck_cards` 引用、自定义打印保留逻辑）。 |
| `src/lib/db/service/user-sync/engine.ts` 及 entities/ | LWW + 墓碑合并引擎；写回顺序有严格依赖（自定义打印 → 卡组 → 收藏 → 联系人 → 借还 → …），改错会外键失败或数据覆盖。 |
| `src/lib/db/repository/deck-repository.ts` 的 `repointDeckCardReferences` | 内容同步后的卡组引用重链与删除，直接影响用户卡组完整性。 |
| `src-tauri/capabilities/default.json` | 权限边界；`http:allow-fetch` 的 `https://**` 已过宽，新增域名注意收窄；fs scope 只覆盖 3 个目录。 |
| `src-tauri/src/lib.rs` | 全部 command 与插件注册；TTS 端口 39998/39999 是外部约定勿改；Android SAF 分支（`content://`）改动需真机验证；`prevent-default` 5.x 版本特例。 |
| `src-tauri/src/main.rs` | `windows_subsystem = "windows"` 行删除会导致 release 模式弹控制台窗口（文件注释明确 DON'T REMOVE）。 |
| `src-tauri/gen/android/` | 生成目录但含**手写 Kotlin**（`MainActivity.kt`、`SAFPlugin.kt`，与 `lib.rs` 的 saf 插件配对）；`cargo tauri android init` 不会覆盖已存在目录，但整体重建有丢失风险；CI 依赖 keystore secrets（`ANDROID_KEYSTORE_BASE64` 等）。 |
| `.env.local` / `$APPDATA/settings.json` / `$APPDATA/session.json` | 密钥与会话；`.env.local` 必须保持 gitignored；BYO 会话为明文存储（`vault.ts` 已注明因 Android 交叉编译放弃 Stronghold 加密）。 |
| `.github/workflows/release.yml` | 发布通道。注意 android job 在仓库根目录跑 `npm ci`，但根目录**没有 package-lock.json**（只有 pnpm-lock.yaml）——该步骤可能实际失败（未确认，若 Android 发布异常先查这里）。 |
| `src/routes/+layout.svelte` | 启动初始化错误会卡 LoadingModal；`uiState.status` 与同步状态的联动（loading → syncing → success/error）不要破坏。 |

## Agent 修改指南

**动手前先读**（按需组合）：

- 任何改动：`package.json`（脚本/依赖）、`src/lib/db/index.ts`（导出边界）、`prettier.config.js`。
- 数据库相关：`src/lib/db/config/schema.ts` → `repository/database.ts` → 对应 `repository/*` / `service/*`。
- 同步相关：`service/sync-service.ts`、`service/user-sync/engine.ts`、`repository/deck-repository.ts`（repoint）。
- Tauri API / 权限相关：`src-tauri/capabilities/default.json`、`src-tauri/src/lib.rs`、`vite.config.js`。
- 启动流程：`src/routes/+layout.svelte`、`src/lib/stores/ui-store.svelte.ts`。

**改什么去哪个目录**：

- 卡牌数据 / 查询 / 筛选 → `src/lib/db/repository/` + `service/search-service.ts`、`filter-service.ts`。
- 新业务功能（收藏/卡组/对局/储物柜…）→ 先加 repository（SQL），在 `index.ts` 导出，页面在 `src/routes/**`，组件在 `src/lib/components/**`。
- 设置项 → `src/lib/stores/settings.ts`（`persistentWritable`），涉及云同步的设置键记得接 `markSettingChanged`。
- 文件 / TTS / 平台能力 → `src-tauri/src/lib.rs`（新 command 必须在 `generate_handler!` 注册）+ 对应 `$lib/services/` 调用方 + capabilities。
- 文案 → `src/locales/zh-CN.json` + `en.json`。
- 新增路由 / 新增同步表 / 新增同步实体 / 新增 command → 见「扩展点与流程」的 checklist。

**新功能流程**：schema/仓储 → service → `index.ts` 导出 → 页面/组件 → 文案 → `pnpm check` →（Rust 侧）`cargo check` → 冒烟验证。

**Bug 定位**：先看 `$APPLOCALDATA/logs/app.log`（`log-service.ts` 包装 console 落盘）；源码中 `[DB]` / `[SYNC]` / `[Layout]` 前缀的 `console.error` 会输出真实错误与 string 化错误（移动端排查用）；启动初始化链路从 `+layout.svelte` 的 `init()` 追起。

**必须运行的命令**：前端 `pnpm check`；Rust `cargo check`（在 `src-tauri/`）；格式化 `pnpm format`（或至少 `pnpm format:check`）。

**不要直接改**：`src-tauri/gen/schemas/**`（生成物）、`.svelte-kit/**`、`build/`、`node_modules/`、`Cargo.lock`/`pnpm-lock.yaml`（除非有意升级依赖）、`docs/`（约定不读不改）。`src-tauri/gen/android` 内除手写的 `MainActivity.kt` / `SAFPlugin.kt` 外视为生成物。

**禁止操作**：

- 提交 `.env.local` 或任何密钥；打印/输出密钥值。
- 使用 Tauri v1 API（`@tauri-apps/api/tauri`、`window.__TAURI__`）或 v1 配置字段。
- 在 `capabilities` 之外新增窗口权限而不登记；新窗口必须登记（当前仅 `main`）。
- 使用 `BEGIN`/`COMMIT`/`PRAGMA defer_foreign_keys` 跨语句事务；在串行队列外并发访问 db。
- 修改 TTS 端口 39998/39999；删除 `main.rs` 的 `windows_subsystem` 行；新增 `unwrap()`。
- 随手改 `schema.ts` 表结构而不评估老库迁移、同步范围与 `DROP` 清单。
- 运行 `resetDatabase()` / `TABLE_DEFINITIONS.DROP`（真实数据会全清；该函数仅供测试语义）。
- 在未确认云端发布流程前"发布卡牌数据"（云端 version 行刷新不在仓库内）。

**未知事项确认清单**（遇到不确定时问这些）：

- 云端 Supabase 内容数据的发布 / version 行刷新由谁执行？（仓库内无脚本）
- Android 发布（release.yml 的 `npm ci` 步骤）历史上是否成功过？
- iOS 是否在支持范围内？（CI 无 iOS job）
- 各分支（main/dev/stage/version-1/enhance/integrate-tauri）的发布语义是什么？
- `.env.local` 的实际值是否已配置（不要向 Agent 输出值，仅确认存在性）。
- 是否需要锁定 pnpm 版本（加 `packageManager` 字段）或 Node engines？

## 未确认问题

1. **云端 Supabase 发布流程**：`version` 表行刷新、`cards_base` 等表的数据发布方式与执行者不在仓库内（仅能从 `remote-api.ts` 反推表名与 `version` 契约）。
2. **Android CI 的 `npm ci`**：release.yml android job 在根目录跑 `npm ci`，但根目录无 `package-lock.json` —— 该步骤是否实际失败未知（可能从未成功跑通或存在隐式锁文件来源）。
3. **deep-link 使用情况**：`tauri-plugin-deep-link` 已注册（`lib.rs` + capabilities），但前端未发现 `onOpenUrl` / `getCurrent` 调用（`loans` 页的 `contactDeepLink` 只是 mailto/社交链接构造，与插件无关）——插件可能仅为占位/预留。
4. **iOS 支持**：`Cargo.toml` 有 ios target 依赖（barcode-scanner），但 CI 只构建 Android；iOS 工程未在仓库中确认。
5. **`systemLocale()`** 中 navigator 探测代码被注释，恒返回 zh-CN —— 是有意固定默认语言还是遗留，无法从代码确认。
6. **`.gitignore` 首尾各有一个 ``` 围栏行**（第 1、77 行），会被 git 当作字面忽略模式处理，疑似误粘贴 markdown 围栏；实际影响未知（其余规则均生效）。
7. **Windows 签名**：release.yml 无代码签名步骤（NSIS 未签名），是否为预期未知。
8. **`prevent-default` 插件版本 5.0.2** 与多数 Tauri v2 插件版本号体系不同（`Cargo.toml` 注释未说明原因），升级需谨慎。
9. **提交与分支规范**：仓库无提交信息规范、无 PR 模板；各分支发布语义无法从代码确认。
