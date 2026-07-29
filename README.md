# 符文档案 · Rune Archive

> 《符文战场》（Riftbound: League of Legends Trading Card Game）卡牌资料、卡组构筑与规则查询工具。

**符文档案**是一款基于 **Tauri 2 + SvelteKit 5 + TypeScript + SQLite** 构建的桌面应用，为 Riftbound 玩家提供本地化的卡牌数据库、卡组构筑、规则查询以及数据同步功能。

应用采用 **Local-first** 的数据架构：卡牌与规则数据同步至本地 SQLite 数据库后，日常查询和卡组编辑无需持续依赖远程数据库。

---

## Features

### Card Database

- 浏览 Riftbound 卡牌资料
- 卡牌名称、效果、类型等信息查询
- 卡牌搜索
- 卡牌筛选与排序
- 支持不同 Card Print / 卡图版本
- 卡图本地缓存
- 批量下载卡图
- 缓存管理

### Deck Builder

提供完整的卡组构筑界面：

- Legend
- Champion
- Main Deck
- Battlefields
- Runes
- Sideboard

支持：

- 拖拽调整卡牌
- 卡牌数量管理
- 卡组合法性检查
- 卡组保存
- 卡组复制
- 卡组版本管理
- 卡组导入 / 导出
- Deck Code 相关功能

卡组编辑器会根据不同区域的规则限制自动检查卡组状态，例如：

```text
Legend       1
Champion     1
Main Deck   39
Battlefields 3
Runes       12
Sideboard    8
```

---

### Rules

内置规则文档浏览功能。

支持：

- 规则文档列表
- 章节浏览
- 规则章节路由
- 本地规则数据存储

---

### Data Synchronization

应用支持远程数据与本地数据库同步。

远程数据由 Supabase 提供，本地使用 SQLite 保存。

同步内容包括：

- Cards
- Card Prints
- Card Icons
- Rules
- Version information

基本同步流程：

```text
Supabase
   │
   │ Check Version
   ▼
Local Version
   │
   ├── Up to date
   │
   └── New data available
             │
             ▼
       User confirms
             │
             ▼
        Download data
             │
             ▼
         SQLite
```

这样可以减少应用运行时对远程服务的依赖，并提升卡牌搜索与浏览速度。

---

### Local Image Cache

卡图支持本地缓存。

应用可以：

- 自动缓存卡图
- 检查缺失卡图
- 批量下载卡图
- 查看缓存信息
- 清理卡图缓存

这使得已经缓存的卡牌在后续使用时无需重复下载。

---

### Responsive Interface

界面针对不同设备进行了适配。

支持：

- Desktop
- Mobile
- Touch device

卡组编辑器会根据设备类型自动调整布局与拖拽交互方式。

---

## 🛠️ Tech Stack

### Frontend

| Technology                                                            | Purpose               |
| --------------------------------------------------------------------- | --------------------- |
| [SvelteKit](https://kit.svelte.dev/)                                  | Application framework |
| [Svelte 5](https://svelte.dev/)                                       | UI                    |
| [TypeScript](https://www.typescriptlang.org/)                         | Programming language  |
| [Vite](https://vite.dev/)                                             | Build tool            |
| [Lucide Svelte](https://lucide.dev/)                                  | Icons                 |
| [svelte-dnd-action](https://github.com/isaacHagoel/svelte-dnd-action) | Drag & Drop           |

### Desktop

| Technology                    | Purpose                         |
| ----------------------------- | ------------------------------- |
| [Tauri 2](https://tauri.app/) | Desktop application framework   |
| Rust                          | Native backend                  |
| Tauri SQL Plugin              | SQLite                          |
| Tauri FS Plugin               | File system                     |
| Tauri HTTP Plugin             | HTTP requests                   |
| Tauri Store Plugin            | Persistent application settings |
| Tauri Clipboard Plugin        | Clipboard                       |
| Tauri Dialog Plugin           | Native dialogs                  |

### Data

| Technology              | Purpose            |
| ----------------------- | ------------------ |
| SQLite                  | Local database     |
| Supabase                | Remote data source |
| `@supabase/supabase-js` | Supabase client    |

---

## Architecture

符文档案采用前端 + Native Backend + Local Database + Remote Data Source 的架构。

```text
┌──────────────────────────────────────────────┐
│                  SvelteKit UI                │
│                                              │
│  Cards │ Decks │ Deck Builder │ Rules │      │
│        │        │              │ Settings    │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│               Service Layer                  │
│                                              │
│ Search │ Sync │ Image Cache │ TTS │ Network │
└───────────────────┬──────────────────────────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
┌──────────────────┐  ┌──────────────────────┐
│   Local SQLite   │  │       Supabase       │
│                  │  │                      │
│ Cards            │  │ Remote Cards         │
│ Prints           │  │ Remote Prints        │
│ Icons            │  │ Rules                │
│ Rules            │  │ Version              │
│ Decks            │  │                      │
└──────────────────┘  └──────────────────────┘
```

### Local-first

应用运行时主要读取本地 SQLite。

远程 Supabase 数据主要用于：

- 初次初始化
- 数据更新
- 版本检查
- 数据同步

因此卡牌搜索、规则查询以及卡组操作可以尽量避免网络延迟。

---

## Project Structure

```text
fuwendangan/
├── src/
│   ├── lib/
│   │   ├── cards/
│   │   │   ├── config/
│   │   │   └── utils/
│   │   │
│   │   ├── components/
│   │   │   └── cards/
│   │   │
│   │   ├── db/
│   │   │   ├── repository/
│   │   │   ├── service/
│   │   │   ├── config/
│   │   │   └── types.ts
│   │   │
│   │   ├── decks/
│   │   ├── services/
│   │   └── stores/
│   │
│   └── routes/
│       ├── cards/
│       ├── decks/
│       │   ├── [deckid]/
│       │   └── builder/
│       ├── rules/
│       │   └── [slug]/
│       └── settings/
│
├── src-tauri/
│   ├── src/
│   ├── capabilities/
│   ├── icons/
│   ├── resources/
│   └── tauri.conf.json
│
├── static/
├── package.json
└── README.md
```

---

## Development

### Requirements

建议使用以下环境：

- Node.js
- pnpm
- Rust
- Tauri CLI
- Android Studio（如果进行 Android 开发）

### Install

Clone repository:

```bash
git clone <repository-url>
cd fuwendangan
```

Install dependencies:

```bash
pnpm install
```

---

### Development

Run the SvelteKit web application:

```bash
pnpm dev
```

Run the Tauri application:

```bash
pnpm tauri dev
```

---

### Type Check

```bash
pnpm check
```

---

### Format

Format the source code:

```bash
pnpm format
```

Check formatting:

```bash
pnpm format:check
```

---

## 📦 Build

Build the frontend:

```bash
pnpm build
```

Build the Tauri application:

```bash
pnpm tauri build
```

The generated application bundles will be placed under:

```text
src-tauri/target/release/
```

The exact output format depends on the target platform.

---

## Configuration

The application uses Supabase as its remote data source.

Create the required environment variables:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

These variables are used by the remote API layer to retrieve:

- Card data
- Card print data
- Icon data
- Rules
- Version information

> Do not commit private credentials or service-role keys to the repository.

---

## Database

The application uses SQLite for local persistence.

The local database contains data related to:

- Cards
- Card Prints
- Icons
- Rules
- Decks
- Deck Versions
- Filters
- Application version information

The remote Supabase database acts as the source for synchronized card and rules data.

---

## TTS Integration

符文档案包含 TTS（Tabletop Simulator）相关通信功能，用于支持卡牌数据与 Tabletop Simulator 相关工作流。

---

## Version

Current version:

```text
0.8.0
```

---

## Disclaimer

符文档案是一个非官方的第三方社区项目。

Riftbound、League of Legends 以及相关卡牌、角色、图像和其他知识产权归其各自的版权所有者所有。

本项目不隶属于、也不代表 Riot Games 或相关官方组织。

---

## License

This project is licensed under the MIT License.

See the `LICENSE` file for details.
