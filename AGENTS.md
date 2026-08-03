# AGENTS.md — Rune Archive（符文档案）

## 项目简介

Rune Archive（符文档案）是一款基于 **Tauri v2** 的桌面端（兼移动端）卡牌卡组管理应用，为《符文战场》玩家提供卡牌浏览、卡组构建、规则查询与 TTS（Tabletop Simulator）对战导入等功能。

数据架构为 Hybrid 模式：远程数据从 **Supabase** 拉取，通过 Tauri 的 SQL 插件写入本地 **SQLite**，离线时直接查询本地库；图片通过 Tauri 的 fs/http 插件缓存到应用本地目录。

## 技术栈

| 层次       | 技术                                          | 版本         | 说明                                                  |
| ---------- | --------------------------------------------- | ------------ | ----------------------------------------------------- |
| 前端框架   | Svelte 5                                      | ^5.0.0       | 使用 runes 语法（`$state`、`$props`）                 |
| 元框架     | SvelteKit                                     | ^2.9.0       | SPA 模式，`adapter-static` + `fallback: 'index.html'` |
| 构建工具   | Vite                                          | ^6.0.3       | 开发端口固定 `1420`，`strictPort: true`               |
| 语言       | TypeScript                                    | ~5.6.2       | `strict: true`                                        |
| 桌面框架   | Tauri                                         | v2           | Rust 后端 + WebView 前端                              |
| 后端语言   | Rust                                          | edition 2021 | 仅 4 个自定义 command，极简                           |
| 包管理     | pnpm                                          | -            | 使用 `pnpm-lock.yaml`                                 |
| 远程数据   | Supabase                                      | ^2.108.2     | 凭证在 `.env.local`                                   |
| 本地数据库 | SQLite（`tauri-plugin-sql`）                  | v2           |                                                       |
| 其他       | lucide-svelte / snowflake / svelte-dnd-action | -            | 图标 / 雪花ID / 拖拽                                  |

## 目录结构说明

```
fuwendangan/
├── src/                        # 前端源代码 (SvelteKit)
│   ├── app.html                # HTML 模板
│   ├── app.css                 # 全局样式（CSS 变量设计系统）
│   ├── lib/
│   │   ├── components/         # 可复用组件（AppShell / LoadingModal 等）
│   │   ├── cards/              # 卡牌工具函数（含 deckSerializer）
│   │   ├── db/                 # 数据库模块（核心）
│   │   │   ├── config/         # 表结构 / 常量
│   │   │   ├── repository/     # 仓储层 CRUD（database/card/print/deck/rules/filter/version/icon）
│   │   │   ├── service/        # sync-service / remote-api（Supabase 拉取）
│   │   │   ├── env.ts          # isTauri / isWeb 环境判断
│   │   │   └── index.ts        # 统一导出入口
│   │   ├── decks/              # 卡组相关
│   │   ├── services/           # 业务服务（TTS 通信 / 图片缓存 / 卡图下载 / OS 检测等）
│   │   ├── stores/             # Svelte stores（ui / settings / rules / ttsState）
│   │   └── types.ts
│   ├── routes/                 # SvelteKit 路由（SPA）
│   │   ├── +layout.svelte      # 根布局：数据库初始化入口
│   │   ├── +page.svelte        # 首页
│   │   ├── decks/              # 卡组管理
│   │   ├── cards/              # 单卡浏览
│   │   ├── rules/              # 规则查询
│   │   └── settings/           # 设置页
│   └── assets/
├── src-tauri/                  # Rust 后端
│   ├── tauri.conf.json         # Tauri v2 配置
│   ├── Cargo.toml              # Rust 依赖
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json        # Tauri v2 权限配置（唯一窗口 main）
│   ├── resources/external/     # 打包附带的外部资源
│   └── src/
│       ├── main.rs             # 入口，仅调用 lib::run()
│       └── lib.rs              # 插件注册 + 4 个 command
├── static/                     # 静态资源（favicon / logo 等）
├── build/                      # 前端构建产物（frontendDist）
├── package.json
├── vite.config.js              # 端口 1420、HMR 1421、忽略 src-tauri 监听
├── svelte.config.js            # adapter-static + fallback index.html
└── tsconfig.json
```

## 启动方式

开发模式：

```bash
pnpm install
pnpm tauri dev
```

- 内部流程：Tauri CLI 执行 `beforeDevCommand: "pnpm dev"`（Vite 端口 1420）→ WebView 加载 `http://localhost:1420`
- 首次启动会通过 Supabase 同步卡片数据到本地 SQLite

生产构建：

```bash
pnpm tauri build
```

- 前端先执行 `pnpm build`（输出到 `build/`），再编译 Rust

其他脚本：`pnpm check`（svelte-check）、`pnpm format`（prettier）。

## 代码规范

1. **前端**：
   - Svelte 5 组件使用 runes 语法（`$state` / `$props` / `$derived`），尽量不引入旧版 `$:` 响应式写法。
   - 数据层统一从 `$lib/db`（index.ts 统一导出）导入仓储/服务函数，不要绕过统一入口直接访问内部模块。
   - 业务逻辑放在 `$lib/services/`，组件内尽量只做 UI 绑定。
   - 全局状态放入 `$lib/stores/`。
   - 不写与 Tauri 无关的注释；`console.log` 用于调试需在提交前清理。
2. **Rust**：
   - Command 命名使用 snake_case（如 `send_to_tts`）。
   - Command 返回值建议使用 `Result<T, String>` 以便前端统一捕获错误。
   - 需要等待阻塞操作时使用 `#[tauri::command(async)]` + `tauri::async_runtime::spawn_blocking`。
3. **数据库访问**：本地数据一律通过 `@tauri-apps/plugin-sql`（`db.select` / `db.execute`），SQL 参数使用 `?` 占位符避免注入。

## 禁止事项

1. **禁止混用 Tauri v1 与 v2 API**（详见「Tauri 版本要求」）。
2. 禁止在前端直接访问 `window.__TAURI__`；环境判断用 `src/lib/db/env.ts` 中的 `isTauri` / `isWeb`。
3. 禁止在 `capabilities/default.json` 之外创建新窗口权限而不配置对应权限；新窗口需在此文件登记。
4. 禁止把 `.env.local` 中的密钥提交到 git。
5. 禁止在代码中写死 `127.0.0.1:39998/39999` 之外的 TCP 地址而不加注释说明。
6. 禁止用 `unwrap()` 处理可能失败的 I/O（如 TCP 读写）；用 `?` / `map_err` 返回 `Result`。
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

## 前端调用规范

1. **`invoke` 统一从 `@tauri-apps/api/core` 导入**（当前唯一文件是 `src/lib/services/tts-communication-service.ts`）。
2. **事件监听**从 `@tauri-apps/api/event` 导入 `listen`；Rust 端用 `window.emit("事件名", payload)` 推送。
3. 文件系统 / 路径：
   - 路径 API 用 `@tauri-apps/api/path`（`join` / `appDataDir` / `appLocalDataDir` / `resolveResource`）。
   - 文件读写用 `@tauri-apps/plugin-fs`，并显式传 `baseDir`（常用 `BaseDirectory.AppLocalData`），否则默认走相对路径易出错。
4. 网络请求：跨域请求使用 `@tauri-apps/plugin-http` 的 `fetch`（需在 capabilities 中允许目标域名）。
5. 新增自定义 command 后，前端调用方必须与 Rust 端参数名（camelCase 由 Rust snake_case 自动转换）保持一致。
6. 对话框 / 通知 / 剪贴板 / 打开外部链接分别用对应插件：`plugin-dialog` / `plugin-notification` / `plugin-clipboard-manager` / `plugin-opener`，不要用 `window.open` 或浏览器原生弹窗替代（在 Tauri 环境不生效）。

## Rust command 编写规范

1. 所有 command 写在 `src-tauri/src/lib.rs`，并通过 `tauri::generate_handler![...]` 注册。
2. 签名示例（推荐模式）：

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

3. 需要向前端推送事件时，在参数中加入 `window: tauri::Window`，调用 `window.emit("event-name", payload)`。
4. 涉及 TCP / 文件 / 网络等可能阻塞的操作，一律使用 `spawn_blocking` 并加超时，禁止在主线程阻塞。
5. 新增 command 后同步更新前端调用点及本文件「已有 command 列表」注释。

## 常见坑

1. **Vite 端口被占用**：`vite.config.js` 设了 `strictPort: true`，1420 被占则 `pnpm tauri dev` 直接失败，需先释放端口或临时改端口（改端口需同步 `tauri.conf.json` 的 `devUrl`）。
2. **前端请求被权限拦截**：Tauri v2 每个 API 调用都需要 `capabilities/default.json` 中有对应权限。新增插件/方法后若前端报「not allowed」，先检查权限配置。
3. **HTTP 跨域白名单**：`http:allow-fetch` 中当前有 `https://**`（过宽），新增请求域名注意与权限范围一致。
4. **fs 作用域（scope）**：fs 操作受 `fs:scope` 限制，当前仅允许 `$APPCACHE` / `$APPLOCALDATA` / `$RESOURCE/resources/external`。访问其他目录前先扩展 scope。
5. **`.env.local` 存在仓库中**：内含 Supabase publishable key（公开可接受），但 URL 变更需同步所有开发者。
6. **`prevent-default` 插件版本为 5.x**（`Cargo.toml`），与多数 Tauri v2 插件版本号不同，属特例；若行为异常优先核对插件文档，不要盲目升/降版本。
7. **TTS TCP 通信**：端口 39999（发送）/ 39998（接收）是外部 Tabletop Simulator 约定，别改动；连接失败是正常现象（TTS 未运行时），前端需优雅降级。
8. **首次同步依赖网络**：`initializeDatabase` 在 `+layout.svelte` onMount 中触发，会弹 `ask()` 询问是否同步；离线/弱网时可能表现为启动卡在加载态。

## 提交代码前检查清单

- [ ] 运行 `pnpm check`（svelte-check）无类型错误。
- [ ] 运行 `pnpm format` 或 `pnpm format:check` 通过 prettier。
- [ ] `cargo check`（在 `src-tauri/` 下）通过，无 warning 遗留。
- [ ] 未混入 Tauri v1 API（`@tauri-apps/api/tauri`、`window.__TAURI__`）。
- [ ] 新增的 Tauri 插件在 Cargo.toml、package.json、capabilities 三处都已登记。
- [ ] 新增权限已写入 `src-tauri/capabilities/default.json`。
- [ ] 无残留调试代码（如首页 test 按钮、被注释的 import、`console.log`）。
- [ ] 未提交 `.env.local` 及任何密钥。
- [ ] 前端 invoke 参数名与 Rust command 形参一致。
- [ ] 涉及文件的 API 调用都显式传了 `baseDir`。
