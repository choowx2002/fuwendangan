# AGENTS.md

符文档案（Rune Archive）：Riftbound TCG 的卡牌收藏/卡组管理桌面应用。Tauri 2（Rust）+ SvelteKit 5 SPA（adapter-static，`ssr=false`）+ SQLite + Supabase。Local-first：内容数据从 Supabase 按表同步进本地 SQLite，日常读写全走本地库。

## 命令

```bash
pnpm install          # pnpm ≥ 9（lockfileVersion 9）
pnpm tauri dev        # 桌面开发（自动起 Vite 1420 端口）
pnpm dev              # ⚠️ 纯 Web 模式：无 Tauri 环境（无 invoke/本地库），数据页会报错，只适合样式调试
pnpm check            # 前端类型检查（svelte-check）
pnpm format / format:check
pnpm tauri build      # 完整桌面打包
pnpm tauri:build:linux  # Linux 专用（NO_STRIP=true）
cd src-tauri && cargo check   # 改动 lib.rs 后必跑
```

- **无测试框架**，无 test script，无 pre-commit hook；CI（`.github/workflows/release.yml`）只做发布构建（tag `v*` 触发），不跑任何检查。自检全靠 `pnpm check` + `cargo check`。
- `.env.local`（gitignored，模板 `.env.example`）需 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`，构建期注入；缺失则首次内容同步失败。

## 架构要点

- **数据层唯一入口 `src/lib/db/index.ts`**：页面/组件只从 `$lib/db` 导入；SQL 只出现在 `src/lib/db/repository/` 与 `service/`，一律 `?` 占位符。
- **数据库单例 + 全局串行队列**（`repository/database.ts`）：tauri-plugin-sql 底层是 sqlx 多连接池，跨语句 `BEGIN/COMMIT` 事务不可靠（移动端实测报错）。**全项目禁用跨语句事务**；批量写用 `withTransaction()`（实为串行槽内的批量执行）；不得绕过串行队列并发访问 db。
- **Schema 即代码**：`config/schema.ts` 的 `TABLE_DEFINITIONS` 是全部表 DDL；新表必须同时登记 `schema.ts`、`config/constants.ts` 的 `TABLES`、`initializeTables()` 建表清单。老库升级用 `ensureColumn()` 补列 + 一次性迁移函数（读保护才写库）。**不要**随手改表结构/运行 `resetDatabase()`（清空真实数据）。
- **内容同步**（`service/sync-service.ts`）：仅 5 张同步表 `cards/prints/icons/rules/series`（云端表 `cards_base/card_prints/card_icons/rules/series`）；每表一行云端 `version`（`updated_at` 对比）；整表先清后插，保留 `is_custom=1` 自定义打印；`deck_cards` 引用经 `repointDeckCardReferences()` 重链。
- **玩家数据云同步**（`service/user-sync/`）：LWW 合并（同键比 `updated_at`）+ 墓碑；本地硬删必须写墓碑（`addTombstone`），否则删除无法跨设备传播。
- **Rust command**（`src-tauri/src/lib.rs`）：snake_case、`Result<T, String>`、阻塞 I/O 用 `#[tauri::command(async)]` + `spawn_blocking`；新 command 必须在 `generate_handler!` 注册；前端 `invoke` 一律从 `@tauri-apps/api/core` 导入（禁 v1 路径）。TTS 端口 39998/39999 是外部约定，勿改。
- **Tauri 权限**：新插件/新 API 必须登记 `src-tauri/capabilities/default.json`，否则前端报 `not allowed`；fs scope 仅 `$APPCACHE` / `$APPLOCALDATA` / `$RESOURCE/resources/external`。
- 启动初始化在 `src/routes/+layout.svelte`（建库/同步/备份提醒）；错误日志在 `$APPLOCALDATA/logs/app.log`（`log-service.ts`）。

## 规范

- **Svelte 5 runes**（`$state`/`$props`/`$derived`）；`writable` 仅用于 store 型状态。
- **i18n**：用户可见文案加 `src/locales/zh-CN.json` + `en.json`（键一一对应），默认 zh-CN。
- **格式化**：prettier 无分号、单引号、printWidth 100。注意 `.prettierignore` 未排除 `AGENTS.md`，`pnpm format` 会重排它。
- 新路由如需顶部返回按钮，在 `src/lib/utils/route-config.ts` 登记 `backTo`。
- 环境判断用 `src/lib/db/env.ts`（`isTauri` 检测 `__TAURI_INTERNALS__`）。

## 常见坑

- Vite `strictPort: true`，1420 被占则 `pnpm tauri dev` 直接失败（改端口须同时改 `tauri.conf.json` 的 `devUrl`）。
- `src-tauri/gen/android/` 内 `MainActivity.kt` / `SAFPlugin.kt` 是**手写**代码（与 `lib.rs` 的 saf 插件配对），其余为生成物；`gen/schemas/**`、`.svelte-kit/`、`build/` 是生成物勿改。
- 不要提交 `.env.local` / 密钥；BYO 会话明文存 `$APPDATA/session.json`。
- `main.rs` 的 `windows_subsystem = "windows"` 行勿删。
- 云端数据发布/version 行刷新流程不在仓库内（无脚本），无法本地验证。