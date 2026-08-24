# 《Tauri 项目 Web 化适应与改造方案》

> **项目**：符文档案（Rune Archive）· Riftbound TCG 卡牌收藏/卡组管理
> **现状**：Tauri 2（Rust）+ SvelteKit 5 SPA（adapter-static，`ssr=false`）+ SQLite（tauri-plugin-sql）+ Supabase；Local-first，数据层唯一入口 `src/lib/db/`
> **目标**：**不改变核心业务逻辑**，将项目"适应"为纯 Web 应用，部署到 **Cloudflare Pages**
> **约束**：桌面端继续维护 —— 采用**单代码库、双运行目标**（`isTauri` / `isWeb` 环境判别 + 平台适配层）

---

## 0. 现状盘点：Tauri 耦合面清单（基于仓库实测）

| 层 | 主要文件 | 依赖的 Tauri API | 作用 | Web 端现状 / 缺口 |
|---|---|---|---|---|
| 数据层 | `src/lib/db/repository/database.ts` | `@tauri-apps/plugin-sql`（`Database.load`） | 全项目唯一数据库入口（单例 + 串行队列 + 迁移） | **最大耦合点**，Web 下 `invoke` 直接抛错 |
| 服务层 | `image-cache-service.ts` | `plugin-fs`、`api/path`、`api/core`（convertFileSrc）、`plugin-http` | 卡图缓存目录读写、asset:// 取图 | 无本地目录概念，需整体换底 |
| 服务层 | `db-file-service.ts` | `invoke` × 4（copy/write/read/read_image）、`plugin-fs` | 数据库备份/恢复、文本与图片导出 | 需改走文件选择器 / 下载 / OPFS |
| 服务层 | `card-image-zip-import.ts` | `invoke`（list_zip_entries / extract_zip_images） | 卡图 ZIP 批量导入 | 需 fflate 纯 JS 平替 |
| 服务层 | `tts-communication-service.ts` | `invoke`（check/send/start_tts_listener）、`api/event` | 本地 TTS 桌面程序（TCP 39998/39999） | **浏览器无 TCP socket，只能降级禁用** |
| 服务层 | `replay-library-service.ts` | `plugin-fs` | 复盘录像库（replays/ 目录） | 需 OPFS/IndexedDB 平替 |
| 服务层 | `log-service.ts` | `plugin-fs` | 错误日志落盘 | **已有**内存 buffer 降级，落盘已按 `isTauri` 门控 |
| 服务层 | `backup-reminder.ts` | —（`isTauri` 门控跳过） | 备份提醒 | Web 端需改为"导出/云同步提醒" |
| 服务层 | `data-pack-service.ts` | `invoke`（copy_file 等）、`api/path` | 完整数据包导出 | Web 端当前直接 throw，需改为多文件下载 / ZIP |
| 服务层 | `card-image-download-service.ts` | `plugin-notification` | 下载完成通知 | Web Notifications API 平替 |
| 服务层 | `deck-image-service.ts` | `plugin-fs`（writeImageToPath） | 卡组图片保存 | 需下载/保存文件平替 |
| 云同步 | `user-sync/vault.ts` | `plugin-store`（session.json） | Supabase BYO 会话持久化 | **已有** `isTauri` 门控（Web 返回 null → 无法恢复会话），需改 localStorage |
| 云同步 | `supabase-transport.ts` | `plugin-http`（fetch） | 云同步 HTTP | 原生 fetch 即可（Supabase 默认开 CORS） |
| 工具 | `utils/open-window.ts` | `api/webviewWindow` | 多窗口 | **已有**降级（页内全屏 goto） |
| 工具 | `utils/os.ts` | `plugin-os` | 移动端判定 | 需 `navigator.userAgentData` 平替 |
| 工具 | `utils/confirm.ts` | 应用内弹窗 | 确认弹窗 | **已有** `window.confirm` 降级 |
| 状态 | `stores/network.svelte.ts` | `plugin-http` | 联网探测 | **已有** `isTauri ? tauriFetch : globalThis.fetch` |
| 服务 | `services/filter-bridge.ts` | `api/event`（emit/listen）、webviewWindow | 跨窗口筛选同步 | **已有** BroadcastChannel 降级 |
| 页面 | `routes/sync`、`settings`、`decks/[deckid]`、`loans`、`purchase-lists/[listId]`、`rules/[slug]`、`components/decks/ImportDeckModal.svelte` | `plugin-clipboard-manager`、`plugin-opener`、`plugin-dialog`（save）、`sharekit` | 剪贴板 / 打开外链 / 导出保存 / 分享 | 部分已有 `navigator.clipboard` 兜底；dialog save 需下载兜底 |
| 其他 | `src-tauri/src/lib.rs` | 10 个自研 command | TTS、文件、ZIP、SQLite 校验 | 见第 2 节路径分析 |

**结论先行**：本项目是典型的 **TS-heavy（业务全在 TypeScript 前端）、Rust-thin（仅 10 个薄命令 + SQLite 运行时）** 架构。这意味着 Web 化不需要"重写业务"，只需要 **1 个平台适配层 + 1 个数据层换底**，业务代码（repository/service/页面）可做到零改动或近零改动。

---

## 1. 前端解耦与 Tauri API 替代方案（核心）

### 1.1 剥离总原则：三层收敛

1. **平台层**：新建 `src/lib/platform/`，所有 `@tauri-apps/*` 的 import **静态收敛到此目录**（其余文件一律禁止顶层静态 import Tauri API，改为动态 import 或经平台层调用），输出统一 `PlatformAdapter`。
2. **数据层**：`src/lib/db/repository/database.ts` 的 `Database.load()` 换成 `platform.db.open()`，`select/execute/close` 契约与串行队列原样保留 —— 这是"业务逻辑不变"的根基。
3. **服务层**：逐个把 Tauri 调用替换为 `platform.*` 调用；纯浏览器能力（clipboard 等）直接双实现。

### 1.2 Tauri API 逐项平替对照表

| Tauri API（现状） | Web 平替方案 | 说明 |
|---|---|---|
| `plugin-sql`（`Database.load('sqlite:tcg_cards.db')`） | **sqlite-wasm（OPFS）** 首选 / **sql.js + IndexedDB** 备选 | 真正的 SQLite，现有 DDL、`ensureColumn` 迁移、占位符 SQL **全部原样复用**；详见 1.4 |
| `invoke('read_text_file' / 'write_text_file' / 'copy_file')` | `<input type="file">` 读用户文件；`showSaveFilePicker`（Chromium）/ `<a download>` 落盘；OPFS 读写应用私有文件 | File System Access API 需 HTTPS（Cloudflare 默认满足）；非 Chromium 自动降级下载 |
| `invoke('validate_sqlite_file')` | **sqlite-wasm 内存打开**，跑同样的表存在性检查 + `PRAGMA quick_check` | 逻辑 1:1 复刻，甚至不用改 SQL |
| `invoke('list_zip_entries' / 'extract_zip_images')` | **fflate**（`unzipSync`，纯 JS，~8KB）解压到内存 → 按需写入 OPFS | 匹配/计划逻辑（`planCardImageZipImport`）零改动，只换底层解压与写入 |
| `invoke('read_image_file')` | `<input type="file" accept="image/*">` 或 `showOpenFilePicker` 读 ArrayBuffer → dataURL | 自定义卡图上传场景 |
| `invoke('check_tts_connections' / 'send_to_tts' / 'start_tts_listener')` | **无平替**（浏览器禁止裸 TCP socket） | 降级：TTS 入口整体隐藏/禁用，替代交互见第 4 节 |
| `plugin-fs`（AppLocalData 卡图缓存/日志/replays） | **OPFS**（应用私有文件）或 **IndexedDB**（存 Blob）；卡图优先走浏览器 HTTP 缓存 + Cache Storage | 无"路径"概念，全部改为相对路径逻辑名 |
| `api/path`（appLocalDataDir/join/resolveResource） | 平台层内部消化：Tauri 实现保留，Web 实现返回逻辑相对路径 | 上层不再感知路径 |
| `api/core` `convertFileSrc`（asset://） | `URL.createObjectURL(blob)` / `blob:` / 直接 CDN URL | 已有多处 blob 先例 |
| `plugin-dialog`（save） | `showSaveFilePicker` + `<a download>` 兜底（封装为 `platform.fs.saveTextFile/saveBytesFile`） | 3 处调用（collection-export / locker-csv / ownership-export）统一收敛 |
| `plugin-notification` | **Web Notifications API**（`Notification.requestPermission`，需 HTTPS） | 桌面下载完成通知可平移 |
| `plugin-os`（platform） | `navigator.userAgentData.platform` / `navigator.platform` | 仅 `isMobile()` 一处 |
| `plugin-http`（fetch） | 原生 `fetch` | **注意 CORS**：Supabase 默认放行；第三方卡图 CDN 若无 CORS 头需 Cloudflare Worker 代理（见 3.3） |
| `plugin-store`（session.json） | **localStorage**（`ra:supabase-session`） | 风险等级与桌面明文 JSON 相当；XSS 面说明见第 4 节 |
| `plugin-clipboard-manager` | `navigator.clipboard.writeText`；图片 `write([ClipboardItem])`（Chromium 系） | 部分页面已有兜底，统一收敛到 `platform.clipboard` |
| `plugin-opener`（openUrl） | `window.open(url, '_blank', 'noopener')` | — |
| `sharekit`（shareFile） | **Web Share API**（`navigator.share({ files })`，需 HTTPS + 移动端/Chromium） | 不支持时降级为"下载文件 + 复制链接" |
| `api/webviewWindow`（多窗口） | 已有降级：页内全屏路由（goto）；`window.open` 仅作辅助 | `openSecondary` 返回 `{ok:false}` 后自动走页内全屏，**无需改调用方** |
| `api/event`（跨窗口事件） | BroadcastChannel（filter-bridge **已实现**）；同页内事件总线 | 多标签页场景补充（见 4.3） |
| `tauri-plugin-deep-link` | Web 无自定义协议；但 URL 本身即"深链"（分享链接直达路由） | — |

### 1.3 适配器模式（Adapter Pattern）：`PlatformAdapter` 代码骨架

```ts
// ============ src/lib/platform/types.ts ============
/** 平台能力清单：Web 端缺失的能力在此显式登记，供 UI 门控（见第 4 节） */
export type PlatformCapability =
  | 'fs-user-file'        // 用户文件读写（桌面全支持 / Web 需授权或降级下载）
  | 'fs-app-private'      // 应用私有文件（AppLocalData / OPFS）
  | 'db'                 // 本地 SQLite
  | 'notify'             // 通知
  | 'clipboard'          // 剪贴板
  | 'tts'                // 本地 TTS（Web 恒 false）
  | 'multiwindow'        // 多窗口（Web 恒 false，走页内全屏）
  | 'share'              // 系统分享
  | 'open-external'      // 打开外链

export interface SqlBackend {
  select<T = unknown>(query: string, bindValues?: unknown[]): Promise<T>
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>
  close(): Promise<void>
}

export interface TtsStatus { connected: boolean; sendPort: boolean; receivePort: boolean; details: unknown }

export interface PlatformAdapter {
  readonly kind: 'tauri' | 'web'
  has(cap: PlatformCapability): boolean

  db: {
    open(name: string): Promise<SqlBackend>
    /** 整库导出为字节（Web 端「导出数据库备份」= 下载此字节；桌面端 = 拷贝 db 文件） */
    exportSnapshot(): Promise<Uint8Array>
    /** 校验一个备份文件（.db），复用 Rust 版表检查 + quick_check 的 SQL */
    validateBackup(bytes: Uint8Array): Promise<{ ok: boolean; reason?: string }>
    /** 从备份文件整体恢复 */
    importSnapshot(bytes: Uint8Array): Promise<void>
  }

  fs: {
    /** 打开系统文件选择器（Tauri：plugin-dialog open / Web：input[type=file] 或 showOpenFilePicker） */
    pickFiles(opts: { accept?: string; multiple?: boolean }): Promise<File[]>
    saveTextFile(opts: { defaultName: string; content: string; mime?: string }): Promise<boolean>
    saveBytesFile(opts: { defaultName: string; bytes: Uint8Array; mime?: string }): Promise<boolean>
    // —— 应用私有文件（相对路径，无绝对路径概念）——
    readAppFile(rel: string): Promise<Uint8Array | null>
    writeAppFile(rel: string, data: Uint8Array): Promise<void>
    deleteAppFile(rel: string): Promise<void>
    listAppDir(rel: string): Promise<string[]>
  }

  tts: { check(manual: boolean): Promise<TtsStatus>; send(message: string): Promise<string>; startListener(): Promise<boolean> }
  notify: { ensurePermission(): Promise<boolean>; send(title: string, body: string): void }
  clipboard: { writeText(text: string): Promise<void>; writeImage(blob: Blob): Promise<boolean> }
  os: { isMobile(): Promise<boolean> }
  openExternal(url: string): Promise<void>
  shareFile(file: File, title?: string): Promise<boolean>
  openWindow(route: string, opts: Record<string, unknown>): Promise<{ ok: boolean }>
  events: { on<T>(channel: string, cb: (payload: T) => void): () => void; emit<T>(channel: string, payload: T): void }
}
```

```ts
// ============ src/lib/platform/web/index.ts（Web 实现，核心片段） ============
import type { PlatformAdapter, SqlBackend } from '../types'
import { openSqliteWasm } from './db-sqlite-wasm'   // 见 1.4
import { openSqlJs } from './db-sqljs'              // 备选

export const webAdapter: PlatformAdapter = {
  kind: 'web',
  has: (cap) => cap !== 'tts' && cap !== 'multiwindow',  // Web 恒缺这两项

  db: {
    async open(name) { return openSqliteWasm(name) },   // 或 openSqlJs(name)
    async exportSnapshot() { return exportDbBytes() },
    async validateBackup(bytes) { return validateSqliteBytes(bytes) },  // 1:1 复刻 Rust 逻辑
    async importSnapshot(bytes) { return importDbBytes(bytes) },
  },

  fs: {
    // —— 文件选择器：优先 File System Access API，非 Chromium 降级 input ——
    async pickFiles({ accept = '', multiple = false } = {}) {
      if ('showOpenFilePicker' in window) {
        try {
          const handles = await (window as any).showOpenFilePicker({
            multiple, types: accept ? [{ description: accept, accept: { '*/*': accept.split(',') } }] : undefined,
          })
          return Promise.all(handles.map((h: any) => h.getFile()))
        } catch { /* 用户取消 → 返回空数组 */ return [] }
      }
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'; input.accept = accept; input.multiple = multiple
        input.onchange = () => resolve([...(input.files ?? [])])
        input.click()
      })
    },

    // —— 保存文本：showSaveFilePicker → 写入；否则 a[download] 兜底 ——
    async saveTextFile({ defaultName, content, mime = 'text/plain' }) {
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: defaultName,
            types: [{ description: defaultName, accept: { [mime]: [defaultName.split('.').pop() ?? 'txt'] } }],
          })
          const w = await handle.createWritable()
          await w.write(content); await w.close()
          return true
        } catch { return false }
      }
      return triggerDownload(new Blob([content], { type: mime }), defaultName)
    },

    // —— 应用私有文件：OPFS 相对路径读写（无路径穿越风险，天然沙箱） ——
    async readAppFile(rel) {
      const root = await navigator.storage.getDirectory()
      const fh = await root.getFileHandle(rel, { create: false }).catch(() => null)
      if (!fh) return null
      return new Uint8Array(await (await fh.getFile()).arrayBuffer())
    },
    async writeAppFile(rel, data) {
      const root = await navigator.storage.getDirectory()
      const fh = await root.getFileHandle(rel, { create: true })
      const w = await fh.createWritable()
      await w.write(data); await w.close()
    },
    // …deleteAppFile / listAppDir 类似（listAppDir 用 root.getDirectoryHandle + entries()）
  },

  tts: {
    async check() { return { connected: false, sendPort: false, receivePort: false, details: 'web: tts unavailable' } },
    async send() { throw new Error('TTS 仅桌面端可用') },
    async startListener() { return false },
  },

  notify: {
    async ensurePermission() {
      if (!('Notification' in window)) return false
      if (Notification.permission === 'granted') return true
      return (await Notification.requestPermission()) === 'granted'
    },
    send(title, body) { new Notification(title, { body }) },
  },

  clipboard: {
    async writeText(text) { await navigator.clipboard.writeText(text) },
    async writeImage(blob) {
      if (!navigator.clipboard?.write) return false
      try { await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); return true }
      catch { return false }
    },
  },

  os: { async isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) } },
  async openExternal(url) { window.open(url, '_blank', 'noopener') },
  async shareFile(file, title) {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title, files: [file] }); return true } catch { return false }
    }
    return false
  },
  async openWindow(route) { /* Web：无多窗口，返回失败 → 调用方走页内全屏（现有逻辑已支持） */ return { ok: false } },
  events: {
    on(channel, cb) {
      const bc = new BroadcastChannel(channel)
      bc.onmessage = (e) => cb(e.data)
      return () => bc.close()
    },
    emit(channel, payload) { new BroadcastChannel(channel).postMessage(payload) },
  },
}
```

```ts
// ============ src/lib/platform/tauri/index.ts（Tauri 实现 = 现状的薄封装，骨架） ============
import type { PlatformAdapter, SqlBackend } from '../types'
// 仅此目录允许静态 import @tauri-apps/*
import { invoke } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'

export const tauriAdapter: PlatformAdapter = {
  kind: 'tauri',
  has: () => true,
  db: {
    async open(name) { return (await Database.load(name)) as unknown as SqlBackend },  // 原样
    async exportSnapshot() { /* 拷贝 appConfigDir 下的 tcg_cards.db（复用现有 copy_file） */ },
    async validateBackup(bytes) { /* 写临时文件 → invoke('validate_sqlite_file')，或直接复用现有 db-file-service */ },
    async importSnapshot(bytes) { /* 写临时文件 → 现有恢复流程 */ },
  },
  fs: {
    async pickFiles(opts) { /* plugin-dialog open() → 读为 File */ },
    async saveTextFile(opts) { /* plugin-dialog save() → writeTextFile */ },
    // …其余原样透传现有实现
  },
  // tts / notify / clipboard / os / openExternal / shareFile / openWindow / events
  //   → 全部透传现有代码（invoke / plugin-notification / clipboard-manager / sharekit / webviewWindow / event）
}
```

```ts
// ============ src/lib/platform/index.ts（工厂：环境判别即服务注入） ============
import { isTauri } from '$lib/db/env'
import type { PlatformAdapter } from './types'

// 动态 import：Web 构建时 tauri 分支代码不进主 bundle（分包）
export const platform: PlatformAdapter = isTauri
  ? (await import('./tauri')).tauriAdapter
  : (await import('./web')).webAdapter

export type { PlatformAdapter, SqlBackend, PlatformCapability, TtsStatus } from './types'
```

```ts
// ============ 使用示例：database.ts 换底（业务零改动的关键 diff） ============
// 改前：
//   import Database from '@tauri-apps/plugin-sql'
//   const db = await Database.load(DB_NAME)          // DB_NAME = 'sqlite:tcg_cards.db'
// 改后：
import { platform } from '$lib/platform'

export async function getDatabase(): Promise<SqlBackend> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await platform.db.open(DB_NAME)     // 契约不变：select/execute/close
      await db.execute('PRAGMA busy_timeout = 5000')
      await initializeTables(db)                     // DDL / ensureColumn / 迁移：一行不改
      serializeDatabase(db)                          // 串行队列：原样保留（Web 端同样需要）
      return db
    })().catch(...)
  }
  return dbPromise
}
```

> 收益：`repository/*` 20 个文件、`service/*` 同步/搜索/过滤器逻辑、全部页面组件 —— **零改动**。串行队列、`withTransaction`（批量写）、幂等 upsert、失败自愈设计全部保留 —— 这与 sql.js/sqlite-wasm 的单线程模型天然契合。

### 1.4 数据层选型：SQLite 的 Web 落点（本方案最关键决策）

两套方案都能**原样复用**现有全部 DDL、迁移与 SQL（都是真 SQLite）：

| 维度 | 方案甲：sqlite-wasm（OPFS） | 方案乙：sql.js + IndexedDB |
|---|---|---|
| 运行时 | 官方 SQLite 编译的 WASM，Worker 异步执行，不阻塞 UI | 同步 API（`db.exec` 阻塞主线程；本项目数据量为千行级，单查询毫秒级，可接受） |
| 持久化 | OPFS 文件（`file:db?vfs=opfs`） | 每次变更后防抖 `db.export()` → IndexedDB（崩溃最多丢最近 1~2 秒写，与"幂等自愈"设计兼容） |
| 部署要求 | **需要 COOP/COEP 跨源隔离头**（OPFS sync handle）→ 影响第三方资源加载（见 3.3 与风险） | 无任何特殊头，全浏览器（含 Safari/隐私模式）兼容 |
| 数据一致性 | 变更即时落盘 | 防抖落盘，理论窗口略大 |
| 维护状态 | 官方长期维护（@sqlite.org/sqlite-wasm） | 稳定但维护缓慢 |
| 体积（gzip 增量） | ~450KB（wasm + worker） | ~600KB（wasm + js） |
| 推荐度 | **首选**（若接受 COI 配置与 CDN 兼容性工作） | **稳妥备选**（零配置、零风险，适合"先上线后优化"） |

```ts
// ============ src/lib/platform/web/db-sqlite-wasm.ts（骨架，方案甲） ============
import { createWorker } from '@sqlite.org/sqlite-wasm'   // static/ 放 wasm 产物

let worker: Awaited<ReturnType<typeof createWorker>> | null = null

async function open(name: string) {
  const url = new URL('/wasm/sqlite3.wasm', location.origin)
  worker = await createWorker({ locateFile: () => url.href })
  // OPFS 持久化库文件；文件名沿用 tcg_cards.db 逻辑名
  await worker('open', { filename: `file:${name.replace(/^sqlite:/, '')}?vfs=opfs` })
  return {
    async select<T = unknown>(query: string, bindValues: unknown[] = []) {
      const r = await worker!('exec', { sql: query, bind: bindValues, rowMode: 'object', returnValue: 'resultRows' })
      return (r.result?.resultRows ?? []) as T
    },
    async execute(query: string, bindValues: unknown[] = []) {
      const r = await worker!('exec', { sql: query, bind: bindValues })
      return { rowsAffected: r.result?.rowsAffected ?? 0 }
    },
    async close() { await worker!('close'); worker = null },
  }
}

/** Web 端校验 .db 备份：与 Rust validate_sqlite_file 完全同 SQL */
export async function validateSqliteBytes(bytes: Uint8Array): Promise<{ ok: boolean; reason?: string }> {
  // 用 oo1.DB 内存打开 + deserialize(bytes)，然后执行与原 Rust 相同的：
  //   SELECT name FROM sqlite_master WHERE type='table' AND name IN (5 张关键表)
  //   PRAGMA quick_check
  // 返回 { ok: true } 或 { ok: false, reason }
}
```

```ts
// ============ src/lib/platform/web/db-sqljs.ts（骨架，方案乙） ============
import initSqlJs, { type Database as SqlJsDb } from 'sql.js'

const IDB_KEY = 'ra:db:sqljs'
let sql: Awaited<ReturnType<typeof initSqlJs>> | null = null
let db: SqlJsDb | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

async function loadPersisted(): Promise<Uint8Array | null> {
  // IndexedDB 读取上次 export 的字节（无则 null → 新库）
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(async () => {
    const bytes = db!.export()                       // 整库序列化
    await idbPut(IDB_KEY, bytes)                     // 防抖 1500ms 写回 IndexedDB
  }, 1500)
}

export async function openSqlJs(_name: string) {
  if (!sql) sql = await initSqlJs({ locateFile: (f) => `/wasm/${f}` })
  db = new sql.Database(await loadPersisted())
  return {
    async select<T = unknown>(query: string, bindValues: unknown[] = []) {
      const stmt = db!.prepare(query)                // 占位符 ? 语义一致
      stmt.bind(bindValues)
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()
      return rows as T
    },
    async execute(query: string, bindValues: unknown[] = []) {
      db!.run(query, bindValues)
      schedulePersist()
      return { rowsAffected: db!.getRowsModified() }
    },
    async close() { schedulePersist() },
  }
}
```

> **推荐**：里程碑 1 先用**方案乙（sql.js + IndexedDB）**打通全链路（零部署前置条件），里程碑 2 再评估切换方案甲（COI 头 + CDN CORP 兼容性验证通过后切，接口不变，切换成本 = 一个文件）。两方案下「导出数据库备份」= `db.export()` 字节下载；**桌面版备份的 `.db` 文件可直接在 Web 版导入**（反之亦然），换机链路完整保留。

### 1.5 关键服务改造点（逐个，含已有降级复用）

| 服务 | 改造动作 |
|---|---|
| `vault.ts` | `isTauri` 分支改为：Tauri → `plugin-store`（原样）；Web → `localStorage['ra:supabase-session']`（set/get/clear 三函数，10 行） |
| `image-cache-service.ts` | 静态 import 全部移除；`loadImageFromAppFolder` 的 Web 分支改为：内存 Map → Cache Storage（`caches.open('card-images')`）→ 原生 fetch 下载 → blob URL；`convertFileSrc` 分支只在 Tauri 分支保留 |
| `db-file-service.ts` | `copyFile/writeTextFile/readTextFile` 改经 `platform.fs`（Tauri 分支原样 invoke，Web 分支见 1.3）；`readImageFileAsDataUrl` Web 分支 = `platform.fs.pickFiles` |
| `card-image-zip-import.ts` | `listZipEntries`/`extract_zip_images` 换 fflate：`unzipSync(await file.arrayBuffer())` → `entries` Map → `platform.fs.writeAppFile('cardImages/' + dest, bytes)`；匹配/计划逻辑不动；移除 `if (!isTauri) throw` |
| `tts-communication-service.ts` | 顶层静态 import invoke/listen 改为动态 import 并包在 `platform.has('tts')` 门控内；`detectTTSServer` Web 分支直接返回 `connected:false`（UI 据此隐藏 TTS 面板） |
| `log-service.ts` | 已门控，无需改；Web 端 `getLogText()` 已返回内存 buffer |
| `backup-reminder.ts` | `if (!isTauri) return` 改为 Web 分支：提醒文案换成"网页版数据存于浏览器，建议开启云同步或定期导出备份" |
| `data-pack-service.ts` | Web 分支：`exportSnapshot()` 字节 + CSV + JSON + 说明 → `fflate.zipSync` 打成一个包下载（或逐个 `saveBytesFile`） |
| `os.ts` | 换 `platform.os.isMobile()` |
| 3 处 `plugin-dialog` save | 统一 `platform.fs.saveTextFile`（各导出模块只改 1 行） |
| `replay-library-service.ts` | `BaseDirectory.AppLocalData` 相对路径换 `platform.fs.readAppFile/writeAppFile`（Tauri 分支保留原调用） |
| 页面级 clipboard/opener/sharekit | 换 `platform.clipboard` / `platform.openExternal` / `platform.shareFile`（多数页面已有 `navigator.clipboard` 兜底代码可删冗余） |

---

## 2. Rust 后端的"适应"路径选择

先厘清一个事实：**本项目的核心业务逻辑不在 Rust**。`lib.rs` 的 10 个 command 全部是"薄系统能力壳"：TTS TCP（3 个）、文件复制/读写（4 个）、ZIP 解包（2 个）、SQLite 备份校验（1 个）；真正的业务（收藏、卡组、同步、LWW 合并、搜索）全在 TS。因此两条路径的评估要回答的是：**"这 10 个壳"值得用什么方式带到 Web？**

### 2.1 路径 A：Wasm 化（把 Rust 逻辑编译为 WASM 跑在浏览器）

```bash
# 前置：把可复用逻辑抽成独立 crate（不依赖 tauri），再编译 wasm
cargo new crates/rune-core --lib
cargo add wasm-bindgen -p rune-core
rustup target add wasm32-unknown-unknown
wasm-pack build crates/rune-core --target web --out-dir ../../src/lib/wasm
```

```rust
// crates/rune-core/src/lib.rs（骨架：可 Wasm 化的只有纯计算逻辑）
use wasm_bindgen::prelude::*;

/// ZIP 条目枚举（替代 list_zip_entries）——可移植
#[wasm_bindgen]
pub fn zip_entries(bytes: &[u8]) -> Result<JsValue, JsError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| JsError::new(&e.to_string()))?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let e = archive.by_index(i).map_err(|e| JsError::new(&e.to_string()))?;
        out.push(serde_json::json!({ "name": e.name(), "size": e.size(), "is_dir": e.is_dir() }));
    }
    Ok(serde_wasm_bindgen::to_value(&out)?)
}

/// SQLite 备份校验（替代 validate_sqlite_file）——理论可移植，见下方注意
#[wasm_bindgen]
pub fn validate_sqlite(bytes: &[u8]) -> Result<JsValue, JsError> {
    // rusqlite 的 bundled 编译到 wasm32-unknown-unknown 有已知工程问题
    // （sqlite3-src 需要 wasm 补丁）；实践上直接用官方 sqlite-wasm 更省事。
    // 若坚持：rusqlite + Connection::open_in_memory() + deserialize bytes...
}
```

**优点**：
- 性能好（Rust→wasm 接近原生），纯计算逻辑（ZIP 解压、校验）确实能跑；
- 无服务器成本，隐私留在浏览器。

**缺点（对本项目是致命的）**：
- **10 个 command 里 8 个不可移植**：`send_to_tts/check_tts_connections/start_tts_listener` 依赖 `std::net::TcpStream`（wasm 无 TCP，除非绕道 WebSocket + 本机代理，违背"纯 Web"目标）；`copy_file/write_text_file/read_text_file/read_image_file` 依赖 `tauri::AppHandle`/文件系统权限（wasm 无 OS 文件系统，只能桥接 JS 的 OPFS，等于白编译）；`extract_zip_images` 写盘同样依赖宿主。
- **编译体积**：`rusqlite`（bundled）+ `zip` 单 crate 产物 gz 后 500KB~1.5MB，且与前端必然引入的 sqlite-wasm 重复（sqlite 编译两份）。
- **双维护**：Rust 壳 + wasm-bindgen ABI 边界（内存拷贝、JsValue 编解码），为 2 个"JS 侧已有等价物（fflate 8KB / sqlite-wasm 官方版）"的逻辑付出全套工具链成本。
- **DOM 交互**：wasm 不能碰 DOM，仍需 wasm-bindgen/web-sys 桥，无增量收益。

**结论（A）**：路径 A 对本项目**收益 ≈ 0、成本高**。唯一可接受的形式是"数据层 SQLite 用官方 sqlite-wasm"——但这属于前端依赖引入，不需要也不应该由本项目 Rust 编译（见 1.4）。

### 2.2 路径 B：API 化 / 云端化（Rust 改 Axum/Actix 服务，前端 fetch/WS）

```rust
// server/src/main.rs（骨架：仅当未来确需云端化某项能力时才落地）
use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use serde::Deserialize;

#[derive(Deserialize)]
struct ValidateReq { file_b64: String }   // 备份文件 base64

async fn validate_sqlite(Json(req): Json<ValidateReq>) -> Result<Json<serde_json::Value>, StatusCode> {
    // 复用 src-tauri 里的校验逻辑（rusqlite 只读 + quick_check）
    // Ok(Json(json!({ "ok": true })))
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/api/validate-sqlite", post(validate_sqlite));
    // 生产部署建议：Cloudflare Workers 上的 Rust (workers-rs) 或容器
    axum::Server::bind(&"0.0.0.0:8787".parse().unwrap()).serve(app.into_make_service()).await.unwrap();
}
```

```ts
// 若走 Cloudflare Workers（更贴合目标环境）——但下面会论证"不需要"：
// workers/api/src/index.ts（骨架）
export default {
  async fetch(req: Request) {
    // /api/validate-sqlite → 用 sql.js（Worker 环境可直接跑 sqlite wasm）校验
    // /img/* → 卡图 CDN 代理，补 CORS 头（这个才是真正需要的，见 3.3）
  },
}
```

**优点**：
- 能力可共享：未来多端（手机浏览器、其他设备）共用同一后端；
- Rust 侧保留（若团队更熟 Rust），TTS 类能力理论上可改造成云端服务（但 TTS 是用户本机程序，云上无意义）。

**缺点（对本项目同样不友好）**：
- **业务逻辑不在 Rust**：把 10 个壳搬上云，等于为"复制文件、解 ZIP、校验 SQLite"建服务器 + 鉴权 + 计费 + 隐私边界（收藏数据含微信/QQ/电话等联系人字段，上云即隐私风险升级）；
- 前端要处理网络失败、离线降级、鉴权——与 local-first 架构背道而驰；
- 真正缺的"云端能力"（跨设备全量备份）**Supabase 云同步已经覆盖**（LWW + 墓碑），无需自建。

### 2.3 对比与推荐

| 维度 | 路径 A（Wasm 化） | 路径 B（API 化） | 推荐：C（混合：数据层 WASM + 能力降级） |
|---|---|---|---|
| 业务逻辑改动 | 无（但需抽 crate） | 无 | **无** |
| 可覆盖的 command | 2/10（ZIP、校验，且有 JS 等价物） | 全部（但多数无意义） | 数据层 100% 保留（sqlite-wasm），其余按 1.2 平替/降级 |
| 服务器成本 | 无 | 有（且为薄壳付费） | 无（Cloudflare Pages 静态即可） |
| 隐私 | 好 | 差（联系人数据上云） | 好 |
| 实施成本 | 高（wasm 工具链 + ABI） | 高（服务 + 鉴权 + 运维） | **低**（1 个适配层 + 1 个文件换底） |
| 长期维护 | 双栈 | 双栈 + 服务 | 单栈（TS 为主） |

> **推荐：路径 C —— 以"路径 A 的精神"替换数据层（SQLite 本身在浏览器内以 WASM 运行，即 `sqlite-wasm`），把 10 个薄 command 全部在前端平替（可平替的）或降级（TTS），不整库 API 化。** 理由：核心业务本就在 TS；Rust 壳的每个能力在 Web 生态都有等价物（fflate / sqlite-wasm / OPFS / File System Access API）；唯一不可平替的 TTS 属"本机外设"，云端化在语义上就不成立。若未来出现"跨设备全量备份/分享链接鉴权"等真实云端需求，再加一个 Cloudflare Worker/D1 端点即可（架构上预留了 `platform` 层，未来接入成本低）。

---

## 3. 构建与工程化调整

### 3.1 Vite / SvelteKit / package.json

项目现状：`vite.config.js` 无 Tauri 构建插件（Tauri 官方本就没有 `vite-plugin-tauri`，桌面侧由 `@tauri-apps/cli` + `tauri.conf.json` 驱动），Tauri 专属内容只有 dev server 的固定端口/清屏/watch 忽略。SvelteKit 已是 `adapter-static` + `fallback: 'index.html'` —— **这正是 Cloudflare Pages SPA 需要的形态，svelte.config.js 一行不用改**。

```js
// vite.config.js：双模式（桌面继续用 1420，Web 走默认 5173）
import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'

// Tauri CLI 注入的环境变量；未设置 = 纯 Web 模式
const isTauri = !!process.env.TAURI_ENV_PLATFORM
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  server: isTauri
    ? {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
        watch: { ignored: ['**/src-tauri/**'] },
      }
    : { port: 5173, strictPort: false },
})
```

```jsonc
// package.json：仅增补语义化脚本，不删除任何 Tauri 相关依赖（桌面仍要跑）
{
  "scripts": {
    "dev": "vite dev",                // 纯 Web 开发（现状即如此）
    "dev:desktop": "pnpm tauri dev",  // 语义化别名
    "build": "vite build",            // 产物输出到 build/（adapter-static）—— CF Pages 直接用
    "build:web": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "tauri": "tauri",
    "tauri:build:linux": "NO_STRIP=true tauri build"
  }
}
```

要点：
- **不要删** `@tauri-apps/*` 依赖与 `src-tauri/`：单代码库双目标，桌面构建链路原样保留；`pnpm tauri build` 是 Web 化的回归基准。
- 工程约束升级：**所有 `@tauri-apps/*` 静态 import 只允许出现在 `src/lib/platform/tauri/`**（Vite 据此在 Web 构建时 tree-shake 掉整个 tauri 分支；其余文件一律平台层调用或动态 import）。可在 `pnpm check` 之外加一条 grep 检查（CI 可选）。
- wasm 产物（sqlite-wasm / sql.js 的 `.wasm`）放 `static/wasm/`（Vite 原样拷贝），用 `locateFile` 指向。

### 3.2 环境变量（.env）适配

```bash
# .env.example（增补；VITE_* 构建期注入，Cloudflare Pages 环境变量同名即可）
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=xxxx
# 可选：卡图 CDN 若未开 CORS，经 Cloudflare Worker 代理（见 3.3）
VITE_IMAGE_PROXY_URL=https://img-proxy.your-domain.workers.dev
# 可选：部署标识（'web' | 'desktop'），用于埋点/功能开关
VITE_DEPLOY_TARGET=web
```

- `import.meta.env.VITE_*` 机制在 Cloudflare Pages 构建时**原生支持**（在 Pages 项目 → Settings → Environment variables 配置，生产分支单独一组）。
- `vault.ts`/`supabase-transport.ts` 用的 Supabase 配置无需改动（supabase-js 自带浏览器 CORS 支持）。
- 注意：Web 端**不要**把 `publishable key` 视为机密（本就公开），真正的权限靠 Supabase RLS。

### 3.3 Cloudflare Pages 部署配置

```
构建命令:   pnpm build          （或 pnpm install && pnpm build，Pages 会自动识别 pnpm-lock.yaml）
输出目录:   build
```

```apacheconf
# static/_redirects —— SPA 回退（adapter-static fallback 与 Pages 配合的关键）
/*  /index.html  200

# static/_headers —— 安全头（方案甲 sqlite-wasm/OPFS 需要 COI 两行；方案乙可去掉 COI）
/*
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co https://<卡图CDN域名>; connect-src 'self' https://*.supabase.co https://<卡图CDN域名> https://<代理域名>; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

- **COI 的连带影响（方案甲必须处理）**：`require-corp` 下所有跨源资源必须带 CORS/CORP 头。Supabase REST（fetch，CORS 已开）没问题；**第三方卡图 CDN 的 `<img>`/fetch 需要 `crossorigin="anonymous"` + CDN 返回 `Access-Control-Allow-Origin`**，若无 → 卡图加载失败。兜底：加一个 Cloudflare Worker 代理（转发并补 `Access-Control-Allow-Origin: *`），前端 `VITE_IMAGE_PROXY_URL` 指过去，`image-cache-service` 的 fetch 前缀拼接即可。方案乙（sql.js）无此问题，但 `_headers` 建议保留 CSP。
- 部署形态：单仓库直接连 GitHub，Pages 分支发布；tag `v*` 发布与桌面 release 流程互不干扰（现有 `.github/workflows/release.yml` 不动）。

---

## 4. 潜在风险与"降级"体验

### 4.1 必须降级/舍弃的桌面级能力

| 桌面能力 | Web 状态 | 降级/替代方案 |
|---|---|---|
| **本地 TTS**（TCP 39998/39999 桌游语音） | ❌ 舍弃（无 TCP socket） | TTS 面板隐藏 + 提示"网页版不支持 TTS，请使用桌面版或复制卡组代码到其他工具"；保留"复制卡组代码"按钮作为替代交互 |
| **静默文件读写**（AppLocalData 自动读写） | ⚠️ 受限 | OPFS 沙箱内静默读写（同域隔离）；**对用户可见的文件**（导出/导入）必须走显式选择器或下载 |
| **全局快捷键**（若有） | ❌ 舍弃 | 页面内快捷键（keydown 监听）保留 |
| **系统托盘 / 后台常驻** | ❌ 舍弃 | 无平替；标签页后台会被浏览器节流（见 4.3） |
| **多窗口** | ⚠️ 降级 | 已有页内全屏降级（`openSecondary` 返回 `{ok:false}` → goto），改动为零 |
| **系统通知** | ✅ 平替 | Web Notifications（需 HTTPS + 用户授权） |
| **剪贴板图片** | ⚠️ 部分 | `ClipboardItem` 仅 Chromium 系；Firefox/Safari 降级"下载图片" |
| **系统分享（sharekit）** | ⚠️ 部分 | Web Share API（HTTPS）；不支持时降级下载文件 |
| **打开系统文件管理器定位** | ⚠️ 降级 | 无；改为下载到"下载"目录 |
| **深链自定义协议** | ➡️ 等价 | URL 即深链（`/decks/xxx` 可分享直达） |

### 4.2 降级提示 UI（给用户合理反馈）

```svelte
<!-- src/lib/components/PlatformCapability.svelte（骨架）：能力门控 + 降级提示 -->
<script lang="ts">
  import { platform, type PlatformCapability } from '$lib/platform'
  import { t } from '$lib/i18n'
  let { cap, children, fallback }: {
    cap: PlatformCapability
    children?: Snippet
    fallback?: Snippet
  } = $props()

  const available = $derived(platform.has(cap))
</script>

{#if available}
  {@render children?.()}
{:else if fallback}
  {@render fallback()}
{:else}
  <div class="cap-unavailable" role="note">
    <span class="cap-icon">⚠️</span>
    <!-- i18n 键：cap.tts.unavailable 等，zh-CN/en.json 同步登记 -->
    <span>{@html $t(`cap.${cap}.unavailable`)}</span>
  </div>
{/if}
```

```svelte
<!-- 使用示例：TTS 面板（tts-communication-service 的调用点） -->
<PlatformCapability cap="tts">
  {#snippet fallback()}
    <!-- 降级替代交互：复制卡组代码而非语音生成 -->
    <button onclick={copyDeckCode}>复制卡组代码</button>
  {/snippet}
  <!-- 原 TTS 面板内容 -->
  <TtsPanel />
</PlatformCapability>
```

```ts
// 启动时一次性横幅（+layout.svelte onMount 内，仅 Web 触发一次，7 天不重复）
if (platform.kind === 'web' && !localStorage.getItem('ra:web-banner-dismissed')) {
  showToast($t('web.banner', {
    values: {
      // "当前为网页版：数据保存在本浏览器中。建议开启云同步，并定期导出备份。
      //  TTS 语音与多窗口等桌面功能不可用。"
    }
  }), { duration: 0, dismissable: true })
}
```

补充 UI 细节：设置页新增「Web 环境」信息卡（存储用量估算、导出备份按钮、云同步状态）、能力说明；所有"仅桌面"入口（TTS、完整数据包、ZIP 导入等）在 Web 端要么隐藏要么带 `PlatformCapability` 提示，禁止裸 throw（现有 `data-pack-service`/`card-image-zip-import` 的 `throw '仅桌面端支持'` 必须替换为可用实现或 UI 门控）。

### 4.3 数据持久性 / 会话 / 多标签页风险

| 风险 | 说明 | 对策 |
|---|---|---|
| **浏览器清理存储** | Safari ITP 7 天未访问清理 OPFS/IndexedDB；用户清缓存、隐私模式 | 首屏横幅提醒 + 已有 Supabase 云同步作为主备份（Web 端启用 localStorage 会话后可恢复）+ 设置页「导出备份」一键下载 `.db`（桌面版可恢复同一文件，形成完整换机链路） |
| **会话安全** | localStorage 明文（与桌面 `session.json` 明文同级），但 Web 暴露面更大（XSS） | 仅 HTTPS（CF 默认）；CSP 收紧（见 `_headers`）；不引入额外第三方脚本；可接受后置项：把 BYO 会话改为 HttpOnly Cookie（需 Supabase 自定义域名 + 小后端，非本期） |
| **多标签页并发写** | 两个标签页同时写 IndexedDB/OPFS 会互相覆盖 | Web Locks API（`navigator.locks.request('ra-db', ...)`）串行化写；或启动时 BroadcastChannel 探测"已有活动标签页"则提示只读模式 |
| **后台节流** | 标签页后台时定时器/自动同步被降频 | 自动同步只在页面可见时执行（`document.visibilitychange` 触发补一次）；提示"请保持页面打开以完成同步" |
| **首次加载体积** | sqlite wasm + 首屏全表查询 | 加载页（现有启动流程已有初始化态）；`vite-plugin-...` 分包；sqlite wasm gzip 后增量可接受（~450KB） |
| **CORS** | 卡图 CDN 未开 CORS | Worker 代理（3.3）；网络探测/下载失败已有重试与降级逻辑 |

### 4.4 桌面回归保障

单代码库改动的最大风险是"修好 Web 弄坏桌面"。对策：
- 每里程碑收尾跑 `pnpm check` + `cargo check` + `pnpm tauri dev` 冒烟（数据页、同步、导出、TTS 门控恢复）；
- `platform/tauri/index.ts` 只做"薄封装"，行为与现状逐字节对齐；
- CI 可加一条 Web 构建 job（`pnpm build` + `pnpm check`），桌面 release 流程不动。

---

## 5. 实施路线图

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1 平台层与数据层换底**（2~3 天） | 建 `src/lib/platform/*`（types/工厂/web/tauri）；`database.ts` 换 `platform.db.open`；sql.js 方案落地（IndexedDB 持久化）；`vault.ts` Web 分支 | `pnpm dev` 纯浏览器可进收藏/卡组页并读写数据；`pnpm check` 通过；`pnpm tauri dev` 桌面回归冒烟通过 |
| **M2 服务层逐个适配**（3~5 天） | 1.5 清单逐项：image-cache / db-file / zip（fflate）/ data-pack / replay-library / dialog→save / clipboard / opener / share / notification / os；TTS 门控 + `PlatformCapability` 组件；Web 端备份导入导出全链路 | Web 端可完成：内容同步、云同步登录/恢复、导出备份并在桌面恢复、卡图 ZIP 导入、卡组图片导出；TTS 入口隐藏且不报错 |
| **M3 构建与 Cloudflare 部署**（1~2 天） | vite 双模式；`_redirects`/`_headers`；Pages 站点 + 环境变量；可选 Worker 图片代理；CSP 校验 | 生产 URL 全功能冒烟（同步/导出/备份/导入）；`pnpm tauri build` 仍通过；性能预算：首屏 gzip < 1MB（不含卡图） |

## 附录 A：预计改动文件清单

**新增**：`src/lib/platform/{index,types}.ts`、`src/lib/platform/web/{index,db-sqljs,db-sqlite-wasm,opfs}.ts`、`src/lib/platform/tauri/{index,db,fs,tts,clipboard,share}.ts`、`src/lib/components/PlatformCapability.svelte`、`static/_redirects`、`static/_headers`、`static/wasm/*`（构建产物）

**修改**：`src/lib/db/repository/database.ts`（换底，~10 行）、`src/lib/services/{image-cache,db-file,card-image-zip-import,tts-communication,data-pack,replay-library,deck-image,card-image-download,backup-reminder}-service.ts`、`src/lib/db/service/user-sync/vault.ts`、`src/lib/utils/os.ts`、`src/lib/collection/collection-export.ts`、`src/lib/locker/locker-csv.ts`、`src/lib/decks/ownership-export.ts`、`src/routes/{sync,settings,decks/[deckid],loans,purchase-lists/[listId],rules/[slug]}/+page.svelte`、`src/lib/components/decks/ImportDeckModal.svelte`、`vite.config.js`、`.env.example`、`src/locales/{zh-CN,en}.json`（新增降级文案键）

**不改**：`src-tauri/**`（桌面构建继续）、`src/lib/db/repository/**`（除 database.ts）、`src/lib/db/service/{sync,search,filter,user-sync/engine,user-sync/bundle}.ts`、全部页面业务逻辑、`svelte.config.js`、Supabase 云表结构

## 附录 B：验证清单（Web 化完成判定）

- [ ] `pnpm dev` 纯浏览器无任何 `invoke`/`__TAURI_INTERNALS__` 报错
- [ ] 首屏初始化建库 → 内容同步（5 张同步表）→ 搜索/筛选/收藏读写全链路可用
- [ ] Supabase BYO 登录 → 会话跨刷新保持（localStorage）→ 云同步双向（LWW + 墓碑）
- [ ] 导出：收藏 CSV / 卡组 JSON / 卡组图片 / 数据库备份（下载 `.db`）→ 桌面版导入同一备份成功（反向亦然）
- [ ] 导入：卡图 ZIP（fflate）、CSV 回导、备份恢复（sqlite-wasm 校验）
- [ ] TTS 入口隐藏/禁用且不抛错；多窗口入口走页内全屏
- [ ] 通知（下载完成）在授权后弹出；剪贴板复制在各主流浏览器可用
- [ ] 桌面回归：`pnpm check`、`cargo check`、`pnpm tauri dev` 冒烟、`pnpm tauri build` 打包
- [ ] 生产站点：HTTPS、CSP 无违规、SPA 深链直达（`/decks/xxx` 刷新 200）、COI 头生效（若方案甲）
