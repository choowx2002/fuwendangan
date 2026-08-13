# AGENTS.md — Rune Archive（符文档案）

## 项目简介

Rune Archive（符文档案）是一款基于 **Tauri v2** 的桌面端（兼移动端）卡牌卡组管理应用，为《符文战场》玩家提供卡牌浏览、卡组构建、收藏管理、规则查询、对局记录与 TTS（Tabletop Simulator）通信等功能。

数据架构为 Local-first：远程数据从 **Supabase** 拉取，通过 Tauri 的 SQL 插件写入本地 **SQLite**，离线时直接查询本地库；图片通过 Tauri 的 fs/http 插件缓存到应用本地目录。

## 技术栈

| 层次       | 技术                                                                                          | 版本     | 说明                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| 前端框架   | Svelte 5                                                                                      | ^5.0.0   | 使用 runes 语法（`$state` / `$props` / `$derived`）                                    |
| 元框架     | SvelteKit                                                                                     | ^2.9.0   | SPA 模式（`adapter-static` + `fallback: 'index.html'`，`+layout.ts` 设 `ssr = false`） |
| 构建工具   | Vite                                                                                          | ^6.0.3   | 开发端口固定 `1420`，`strictPort: true`                                                |
| 语言       | TypeScript                                                                                    | ~5.6.2   | `strict: true`                                                                         |
| 桌面框架   | Tauri                                                                                         | v2       | Rust 后端 + WebView 前端，lib.rs 含 8 个自定义 command                                 |
| 包管理     | pnpm                                                                                          | -        | `pnpm-lock.yaml` / `pnpm-workspace.yaml`（仅 allowBuilds）                             |
| 远程数据   | Supabase                                                                                      | ^2.108.2 | 凭证在本地 `.env.local`（gitignored，非仓库文件）                                      |
| 本地数据库 | SQLite（`tauri-plugin-sql`）                                                                  | v2       | 表结构在 `src/lib/db/config/schema.ts`                                                 |
| 其他       | lucide-svelte / snowflake / svelte-dnd-action / @piltoverarchive/riftbound-deck-codes / jspdf | -        | 图标 / 雪花ID / 拖拽 / Deck Code 编解码 / PDF 导出                                     |

## 目录结构说明

```
fuwendangan/
├── src/                        # 前端源代码 (SvelteKit)
│   ├── lib/
│   │   ├── components/         # 可复用组件（AppShell / LoadingModal / collection 等）
│   │   ├── cards/              # 卡牌工具函数（config / utils）
│   │   ├── collection/         # 收藏（卡图卡牌收集）相关逻辑
│   │   ├── db/                 # 数据库模块（核心，统一从 index.ts 导出）
│   │   │   ├── config/         # 表结构 schema.ts / 常量 / 语言码 / 收藏规则
│   │   │   ├── repository/     # 仓储层 CRUD：database / card / print / deck / rules /
│   │   │   │                   #   filter / version / icon / collection / language / series / match-record / maintenance / stats
│   │   │   ├── service/        # sync-service / remote-api / search-service / filter-service / completion-modes
│   │   │   ├── env.ts          # isTauri / isWeb 环境判断
│   │   │   ├── helper.ts       # 行映射 / 序列化等工具
│   │   │   └── index.ts        # 统一导出入口（所有类型 + 仓储 + 服务 + 工具）
│   │   ├── decks/              # 卡组（deck-code / 校验 / 导出 / 版本 diff / zone）
│   │   ├── services/           # 业务服务（TTS 通信 / 图片缓存 / 卡图下载 / 文件 IO）
│   │   ├── stores/             # Svelte stores（settings / rules / tts / tools / ui-store.svelte.ts）
│   │   └── utils/              # longpress / network / os / route-config / time-helper
│   ├── routes/                 # SvelteKit 路由（SPA）：cards / decks(+builder,+[deckid]) / rules / settings / collection / tools
│   │   └── +layout.svelte      # 根布局：数据库初始化入口
│   └── app.css                 # 全局样式（CSS 变量设计系统）
├── src-tauri/                  # Rust 后端
│   ├── tauri.conf.json         # Tauri v2 配置（devUrl 1420 / frontendDist ../build）
│   ├── capabilities/
│   │   └── default.json        # Tauri v2 权限配置（唯一窗口 main）
│   ├── resources/external/     # 打包附带的外部资源
│   └── src/
│       ├── main.rs             # 入口，仅调用 lib::run()
│       └── lib.rs              # 插件注册 + 8 个 command + Android SAF 插件
├── static/                     # 静态资源（favicon / logo 等）
└── build/                      # 前端构建产物（frontendDist）
```

## 启动方式

```bash
pnpm install
pnpm tauri dev        # beforeDevCommand: pnpm dev（Vite 1420）→ WebView 加载 http://localhost:1420
pnpm tauri build      # 先 pnpm build（输出到 build/），再编译 Rust
pnpm tauri:build:linux   # Linux 专用构建：NO_STRIP=true tauri build
```

其他脚本：`pnpm check`（`svelte-kit sync` + svelte-check）、`pnpm format` / `format:check`（prettier）。
**无测试框架/脚本**；改动后验证方式 = `pnpm check` +（Rust 侧）`cargo check`。

数据初始化：`+layout.svelte` onMount 中，本地库无版本记录时静默触发 `initializeDatabase()`（不弹询问框）；settings 页也可手动重新同步。同步失败时显示错误 toast，`uiState.status` 不会停留在 loading。

## 数据库 schema 演进（重要）

- 新装库启动时由 `src/lib/db/repository/database.ts` 的 `initializeTables()` 按 `config/schema.ts` 建全表 + 索引，无存量迁移逻辑。改表结构直接改 `config/schema.ts`（注意新库与老库走同一建表路径，`CREATE TABLE IF NOT EXISTS` 不会为已存在的库补列）。
- `version` 表有一次性语义迁移：`migrateVersionSemantics()` 会删除 name 不属于同步表标识（cards/prints/icons/rules/series）的旧行，仅当行内容与云端不符时。

## 数据同步契约（Sync DB）

- **同步范围**：仅云端 `version` 表登记的 5 张同步表 —— `cards_base` / `card_prints` / `icons` / `rules` / `series`。Collection、Deck、Match Record、玩家资料等本地数据**不参与同步**。
- **同步模型**：按表 timestamp 同步。云端 `version` 表每张同步表一行（`name` = 表标识，唯一；`updated_at` = 该表数据最后发布时间），发布数据更新时对对应行做 upsert。客户端本地 `version` 表镜像同样结构，按 `name` upsert。
- **同步流程**：比较每张表 local/remote 的 `updated_at`，只重下更新的表（整表全量替换，不做逐行 diff）。写入阶段先 `PRAGMA foreign_keys = OFF`，按「先清后插」顺序执行（clearAllCards → clearAllPrints → saveCards → saveCardPrints → 各附属表），`repointDeckCardReferences()` 重链卡组引用、`cleanupOrphans()` / `updateFilterOptions()` 条件后处理，最后按表写本地 version 行，并在 `finally` 恢复 `PRAGMA foreign_keys = ON`；崩溃中断则本地 version 不动，下次启动自动重试。
- **外键已开启**：`@tauri-apps/plugin-sql` 经 sqlx 默认执行 `PRAGMA foreign_keys = ON`（`maintenance.ts` 里"未开启外键"的旧注释已修正）。同步**不用**跨语句事务/BEGIN/COMMIT（插件底层是 sqlx 多连接池，跨语句事务不可靠且会锁库），改为写阶段临时关闭外键、结束时恢复；恢复前 repoint 保证卡组引用全部合法。
- **发布纪律**：任何同步表有增/改/删，必须刷新该表对应的云端 version 行（`UPDATE version SET updated_at = now() WHERE name = 'xxx'`）；**新增卡牌必须同时刷新 `cards` 与 `prints` 两行**。漏刷会导致该表不更新。
- **自定义打印保留**：`deleteCardsExcept()` / `deletePrintsExcept()` 都会保留 `is_custom=1` 自定义打印及其引用的基础卡；用户自建打印及其引用卡永不丢失。
- **card_no 快照**：`card_prints.card_no` 存 `cards_base.card_no`（唯一）的稳定快照。云端打印同步时用 cards 填充，自定义打印创建时写入；老库启动时由 `backfillPrintCardNo()` 回填。
- **条件后处理**：仅当 `cards` 或 `prints` 变化时才执行 `repointDeckCardReferences()` 与 `cleanupOrphans()`；仅当 `cards` 变化时才重建 `filter_options`。`repointDeckCardReferences()` 按同步后存活打印重链卡组引用，并删除已下架且无法按 print_code 映射的 `deck_cards` 行（保证恢复外键后有效）。

## 代码规范

1. **前端**：
   - Svelte 5 组件使用 runes 语法（`$state` / `$props` / `$derived`），尽量不引入旧版 `$:` 响应式写法。
   - 数据层统一从 `$lib/db`（index.ts 统一导出）导入仓储/服务函数，不要绕过统一入口直接访问内部模块。
   - 业务逻辑放在 `$lib/services/`，组件内尽量只做 UI 绑定；全局状态放入 `$lib/stores/`。
   - 不写与 Tauri 无关的注释；`console.log` 用于调试需在提交前清理。
2. **Rust**：
   - Command 命名使用 snake_case（如 `send_to_tts`）。
   - Command 返回值使用 `Result<T, String>` 以便前端统一捕获错误。
   - 阻塞操作使用 `#[tauri::command(async)]` + `tauri::async_runtime::spawn_blocking`（TCP 检查已有 3 秒超时示例）。
3. **数据库访问**：本地数据一律通过 `@tauri-apps/plugin-sql`（`db.select` / `db.execute`），SQL 参数使用 `?` 占位符避免注入。

## 禁止事项

1. **禁止混用 Tauri v1 与 v2 API**（详见「Tauri 版本要求」）。
2. 禁止在前端直接访问 `window.__TAURI__`；环境判断用 `src/lib/db/env.ts` 中的 `isTauri` / `isWeb`。
3. 禁止在 `capabilities/default.json` 之外创建新窗口权限而不配置对应权限；新窗口需在此文件登记。
4. 禁止把 `.env.local` 中的密钥提交到 git（该文件已被 gitignore）。
5. 禁止在代码中写死 `127.0.0.1:39998/39999` 之外的 TCP 地址而不加注释说明。
6. 禁止用 `unwrap()` 处理可能失败的 I/O；用 `?` / `map_err` 返回 `Result`。（注意 `send_to_tts` 中遗留一处 `unwrap()`，新代码不要再引入。）
7. 禁止删除 `main.rs` 中 `windows_subsystem = "windows"` 这一行（防止 release 模式弹出多余控制台窗口）。

## Tauri 版本要求

本项目为 **Tauri v2**（`tauri.conf.json` schema 为 `/config/2`，`Cargo.toml` 依赖 `tauri = "2"`，CLI 为 `@tauri-apps/cli@2`）。

1. **后续开发优先使用 Tauri v2 API**。
2. **不要混用 Tauri v1 API**。具体禁止项：
   - 禁止 `import { invoke } from '@tauri-apps/api/tauri'`（v1 路径），应使用 `@tauri-apps/api/core`。
   - 禁止使用 `window.__TAURI__`。
   - 禁止在 `tauri.conf.json` 使用旧版 `build.distDir` / `build.devPath` 等 v1 配置字段。
3. 新增插件必须同时满足：
   - Rust 侧：`Cargo.toml` 添加 v2 版本插件并注册（`tauri_plugin_xxx::init()`）。
   - JS 侧：`package.json` 添加对应 `@tauri-apps/plugin-xxx@^2`。
   - 权限侧：在 `src-tauri/capabilities/default.json` 声明所需权限，否则前端调用会报权限错误。
4. lib.rs 已注册插件：sql / fs / http / dialog / notification / clipboard-manager / opener / os / store / prevent-default / saf（Android 专用 SAF，桌面端为空插件）。新增插件需在三处（Cargo.toml / package.json / capabilities）登记。

## Rust command 编写规范

1. 所有 command 写在 `src-tauri/src/lib.rs`，并通过 `tauri::generate_handler![...]` 注册。
2. 现有 command 列表（10 个）：`greet`（遗留，前端无调用）、`send_to_tts`、`check_tts_connections`、`start_tts_listener`、`copy_file`、`write_text_file`、`read_text_file`、`read_image_file`、`validate_sqlite_file`（备份恢复前校验）、`list_zip_entries` / `extract_zip_images`（卡图 ZIP 导入）。
3. 签名示例（推荐模式）：

```rust
#[tauri::command]
fn my_command(arg: String) -> Result<String, String> {
    // 错误用 Err(String) 返回，前端 invoke 会 reject
}

#[tauri::command(async)]
async fn async_command() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // 阻塞操作放这里
    })
    .await
    .map_err(|e| e.to_string())
}
```

4. 需要向前端推送事件时，在参数中加入 `window: tauri::Window`，调用 `window.emit("event-name", payload)`（示例：`start_tts_listener` → `tts-message`）。
5. 涉及 TCP / 文件 / 网络等可能阻塞的操作，一律使用 `spawn_blocking` 并加超时，禁止在主线程阻塞。

## 前端调用规范

1. **`invoke` 统一从 `@tauri-apps/api/core` 导入**（当前调用方：`src/lib/services/tts-communication-service.ts`、`src/lib/services/db-file-service.ts`）。
2. **事件监听**从 `@tauri-apps/api/event` 导入 `listen`；Rust 端用 `window.emit("事件名", payload)` 推送。
3. 文件系统 / 路径：
   - 路径 API 用 `@tauri-apps/api/path`（`join` / `appDataDir` / `appLocalDataDir` / `resolveResource`）。
   - 文件读写用 `@tauri-apps/plugin-fs`，并显式传 `baseDir`（常用 `BaseDirectory.AppLocalData`），否则默认走相对路径易出错。
   - 大文件 / 跨平台复制导入导出走 `copy_file` / `write_text_file` / `read_text_file` / `read_image_file` command（Android 上自动走 SAF content:// URI）。
4. 网络请求：跨域请求使用 `@tauri-apps/plugin-http` 的 `fetch`（需在 capabilities 中允许目标域名）。
5. 新增自定义 command 后，前端调用方必须与 Rust 端参数名（camelCase 由 Rust snake_case 自动转换）保持一致。
6. 对话框 / 通知 / 剪贴板 / 打开外部链接分别用对应插件：`plugin-dialog` / `plugin-notification` / `plugin-clipboard-manager` / `plugin-opener`，不要用 `window.open` 或浏览器原生弹窗替代（在 Tauri 环境不生效）。

## 常见坑

1. **Vite 端口被占用**：`vite.config.js` 设了 `strictPort: true`，1420 被占则 `pnpm tauri dev` 直接失败，需先释放端口或临时改端口（改端口需同步 `tauri.conf.json` 的 `devUrl`）。
2. **前端请求被权限拦截**：Tauri v2 每个 API 调用都需要 `capabilities/default.json` 中有对应权限。新增插件/方法后若前端报「not allowed」，先检查权限配置。
3. **HTTP 跨域白名单**：`http:allow-fetch` 中当前有 `https://**`（过宽），新增请求域名注意与权限范围一致。
4. **fs 作用域（scope）**：fs 操作受 `fs:scope` 限制，当前仅允许 `$APPCACHE` / `$APPLOCALDATA` / `$RESOURCE/resources/external`。访问其他目录前先扩展 scope。
5. **`.env.local` 是本地文件**（已被 gitignore，clone 后不存在）：需按 README 自行创建 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`（publishable key 公开可接受），URL 变更需同步所有开发者。
6. **`prevent-default` 插件版本为 5.x**（`Cargo.toml`），与多数 Tauri v2 插件版本号不同，属特例；若行为异常优先核对插件文档，不要盲目升/降版本。
7. **TTS TCP 通信**：端口 39999（发送）/ 39998（接收）是外部 Tabletop Simulator 约定，别改动；连接失败是正常现象（TTS 未运行时），前端需优雅降级。
8. **首次同步依赖网络**：本地库无版本时启动会触发全量同步（5 张表全部重下）；离线/弱网时跳过同步、使用本地数据，失败时提示错误 toast 而非卡在加载态。仓库无 CI、无测试脚本，不要找跑测试的命令。
9. **事务必须依赖 `database.ts` 的串行化**：`@tauri-apps/plugin-sql` 底层是 sqlx 连接池（默认最多 10 连接，插件未暴露池配置），跨多次 `db.execute` 的 `BEGIN`/`COMMIT`/`PRAGMA defer_foreign_keys` 可能落在不同连接而报「database is locked」或失效。`database.ts` 已对 `select`/`execute` 做全局串行（单连接）；不要绕过它自行开事务，也不要在串行队列之外并发访问 db。
10. **Linux 开发**：`lib.rs` 已设 `WEBKIT_DISABLE_DMABUF_RENDERER=1`（规避 WebKitGTK 渲染问题）；Linux 打包脚本为 `pnpm tauri:build:linux`（`NO_STRIP=true`，规避 strip 问题）。

## 提交代码前检查清单

- [ ] 前端改动：可运行 `pnpm check`。
- [ ] Rust 改动：可运行 `cargo check`。
- [ ] 仅在失败时输出关键错误，不要粘贴完整日志。
- [ ] 未混入 Tauri v1 API（`@tauri-apps/api/tauri`、`window.__TAURI__`）。
- [ ] 新增的 Tauri 插件在 Cargo.toml、package.json、capabilities 三处都已登记。
- [ ] 新增权限已写入 `src-tauri/capabilities/default.json`。
- [ ] 无残留调试代码（如首页 test 按钮、被注释的 import、`console.log`）。
- [ ] 未提交 `.env.local` 及任何密钥。
- [ ] 前端 invoke 参数名与 Rust command 形参一致。
- [ ] 涉及文件的 API 调用都显式传了 `baseDir`。
