# fuwendangan

一个基于 Tauri + SvelteKit + TypeScript 构建的桌面应用程序。

## 技术栈

- **前端框架**: [SvelteKit](https://kit.svelte.dev/) v5
- **UI 库**: [Lucide Svelte](https://lucide.dev/) 图标库
- **桌面框架**: [Tauri](https://tauri.app/) v2
- **构建工具**: [Vite](https://vitejs.dev/) v6
- **数据库**: SQLite (通过 @tauri-apps/plugin-sql)
- **语言**: TypeScript

## 功能特性

- 📦 卡片管理系统
- 💾 本地 SQLite 数据库存储
- 🔌 Tauri 插件支持：
  - 文件系统访问 (@tauri-apps/plugin-fs)
  - HTTP 请求 (@tauri-apps/plugin-http)
  - 应用打开器 (@tauri-apps/plugin-opener)
  - SQL 数据库 (@tauri-apps/plugin-sql)

## 项目结构

```
fuwendangan/
├── src/                    # 前端源代码
│   ├── lib/               # 可复用模块
│   │   ├── cards/         # 卡片相关组件和逻辑
│   │   ├── components/    # 通用组件
│   │   ├── db/            # 数据库配置、服务和类型
│   │   └── services/      # 业务服务层
│   ├── routes/            # SvelteKit 路由
│   │   ├── +page.svelte   # 首页
│   │   └── cards/         # 卡片管理页面
│   ├── app.css            # 全局样式
│   └── app.html           # HTML 模板
├── src-tauri/             # Tauri 后端 Rust 代码
│   ├── src/               # Rust 源代码
│   ├── capabilities/      # Tauri 权限配置
│   ├── icons/             # 应用图标
│   └── tauri.conf.json    # Tauri 配置文件
├── static/                # 静态资源
└── package.json           # 项目依赖和脚本
```

## 开发环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) (推荐) 或 npm
- [Rust](https://www.rust-lang.org/tools/install) >= 1.70
- [VS Code](https://code.visualstudio.com/) (推荐编辑器)

## 推荐的 IDE 配置

使用 [VS Code](https://code.visualstudio.com/) 并安装以下扩展：

- [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 安装与运行

### 1. 安装依赖

```bash
pnpm install
```

### 2. 开发模式

启动开发服务器（前端 + Tauri）：

```bash
pnpm tauri dev
```

或者仅运行前端开发服务器：

```bash
pnpm dev
```

### 3. 构建生产版本

```bash
pnpm tauri build
```

构建产物将输出到 `src-tauri/target/release/` 目录。

## 可用脚本

| 命令                | 描述                    |
| ------------------- | ----------------------- |
| `pnpm dev`          | 启动 Vite 开发服务器    |
| `pnpm build`        | 构建前端应用            |
| `pnpm preview`      | 预览构建结果            |
| `pnpm tauri`        | Tauri CLI 命令          |
| `pnpm tauri dev`    | 开发模式运行 Tauri 应用 |
| `pnpm tauri build`  | 构建生产版 Tauri 应用   |
| `pnpm check`        | 类型检查                |
| `pnpm format`       | 格式化代码              |
| `pnpm format:check` | 检查代码格式            |

## 许可证

MIT License
