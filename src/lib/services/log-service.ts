/**
 * 本地错误日志服务
 * 方案 A：包装 console + 全局 error/unhandledrejection 捕获，
 * 维护内存 ring buffer，并追加写入 $APPLOCALDATA/logs/app.log（Tauri 环境）。
 * Web 环境仅保留内存 buffer，不落盘。
 */

import { isTauri } from '$lib/db/env'
import { writeTextFile, readTextFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs'

export type LogLevel = 'error' | 'warn' | 'info'

export interface LogEntry {
  time: string
  level: LogLevel
  message: string
}

const LOG_DIR = 'logs'
const LOG_FILE = 'logs/app.log'
const MAX_BUFFER = 200

const buffer: LogEntry[] = []

const originals = {
  log: console.log,
  warn: console.warn,
  error: console.error,
}

let writeChain: Promise<void> = Promise.resolve()
let dirReady: Promise<boolean> | null = null

function formatArg(v: unknown): string {
  if (v instanceof Error) return v.stack ?? v.message
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/** 已知良性浏览器警告：不写入错误日志（ResizeObserver 循环属浏览器诊断信息，非应用错误） */
function isBenignError(message: string): boolean {
  return /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(
    message
  )
}

function push(level: LogLevel, args: unknown[]): void {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    message: args.map(formatArg).join(' '),
  }
  buffer.push(entry)
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
  persist(entry)
}

function ensureDirReady(): Promise<boolean> {
  if (!dirReady) {
    dirReady = (async () => {
      try {
        if (!(await exists(LOG_DIR, { baseDir: BaseDirectory.AppLocalData }))) {
          await mkdir(LOG_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
        }
        return true
      } catch {
        return false
      }
    })()
  }
  return dirReady
}

function persist(entry: LogEntry): void {
  if (!isTauri) return
  const line = `[${entry.time}] [${entry.level.toUpperCase()}] ${entry.message}\n`
  writeChain = writeChain
    .then(async () => {
      if (!(await ensureDirReady())) return
      await writeTextFile(LOG_FILE, line, {
        baseDir: BaseDirectory.AppLocalData,
        append: true,
      })
    })
    .catch(() => {})
}

/**
 * 安装日志收集钩子（幂等）。在应用根布局 onMount 中调用。
 */
export function initLogService(): void {
  const self = console as unknown as { __logServiceInstalled?: boolean }
  if (self.__logServiceInstalled) return
  self.__logServiceInstalled = true

  console.log = (...args) => {
    originals.log.apply(console, args)
    push('info', args)
  }
  console.warn = (...args) => {
    originals.warn.apply(console, args)
    push('warn', args)
  }
  console.error = (...args) => {
    originals.error.apply(console, args)
    const msg = args.map(formatArg).join(' ')
    if (isBenignError(msg)) return
    push('error', args)
  }

  window.addEventListener('error', (e) => {
    if (isBenignError(e.message)) return
    push('error', [
      e.message,
      e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '',
      e.error?.stack ?? '',
    ].filter(Boolean))
  })

  window.addEventListener('unhandledrejection', (e) => {
    push('error', ['Unhandled rejection', formatArg(e.reason)])
  })
}

/** 最近的内存日志（含本次会话） */
export function getLogBuffer(): LogEntry[] {
  return [...buffer]
}

/** 读取完整日志文本（Tauri 读文件，Web 用内存 buffer） */
export async function getLogText(): Promise<string> {
  if (isTauri) {
    try {
      return await readTextFile(LOG_FILE, { baseDir: BaseDirectory.AppLocalData })
    } catch {
      return ''
    }
  }
  return buffer
    .map((e) => `[${e.time}] [${e.level.toUpperCase()}] ${e.message}`)
    .join('\n')
}

/** 清空日志（内存 + 文件） */
export async function clearLogs(): Promise<void> {
  buffer.length = 0
  if (isTauri) {
    try {
      await writeTextFile(LOG_FILE, '', { baseDir: BaseDirectory.AppLocalData })
    } catch {
      // 忽略：文件不存在等场景
    }
  }
}
