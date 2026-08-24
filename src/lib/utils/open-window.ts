/**
 * 在桌面端开启一个新的 Tauri 窗口，加载应用内的指定路由。
 *
 * 这是“开启另一个窗口”的底层能力封装：
 * - 通过 @tauri-apps/api/webviewWindow 的 WebviewWindow 创建独立窗口；
 * - 新窗口 label 使用 `secondary-` 前缀，与 capabilities 中 default 能力的
 *   glob 匹配（`secondary-*`），从而继承主窗口的数据库/文件/网络等权限；
 * - 非 Tauri（纯 Web）环境降级为浏览器新标签页打开。
 *
 * 使用示例：
 * ```ts
 * import { openSecondary } from '$lib/utils/open-window'
 * const res = await openSecondary('/cards', { title: '单卡库' })
 * if (!res.ok) await goto(route) // 平台不支持新窗口 → 页内全屏降级
 * ```
 */

import { isTauri } from '$lib/db/env'

export interface OpenWindowOptions {
  /** 窗口标题；缺省使用当前页面标题 */
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  center?: boolean
  resizable?: boolean
  maximized?: boolean
  /** 是否去除系统标题栏/边框（无边框浮窗用） */
  decorations?: boolean
  /** 窗口是否透明（需与无边框搭配，透明处显示桌面） */
  transparent?: boolean
  /** 是否始终置顶 */
  alwaysOnTop?: boolean
}

/** openSecondary 探测结果 */
export type OpenSecondaryResult =
  | { ok: true; window: import('@tauri-apps/api/webviewWindow').WebviewWindow }
  | { ok: false; reason: 'not-tauri' | 'create-failed' | 'timeout' }

/** 创建窗口后等待 created / error 的超时（毫秒） */
const CREATE_TIMEOUT = 1800

/**
 * 创建一个新窗口加载指定路由，并探测是否真正创建成功。
 *
 * 跨平台对策：部分平台（尤其 Linux/WebKitGTK）可能无法创建附加窗口。
 * 本函数通过监听 `tauri://created` / `tauri://error` + 超时判定成功与否；
 * 失败时返回 `{ ok: false }`，由调用方降级为「页内全屏」（goto 到该路由，
 * 该路由本身无 AppShell 且自带返回/关闭）。
 *
 * @param route 应用内路由，如 '/cards/filter'
 * @param options 窗口尺寸等选项
 */
export async function openSecondary(
  route: string,
  options: OpenWindowOptions = {}
): Promise<OpenSecondaryResult> {
  if (!isTauri) {
    return { ok: false, reason: 'not-tauri' }
  }

  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')

  const baseUrl = window.location.origin
  const url = route.startsWith('/') ? `${baseUrl}${route}` : `${baseUrl}/${route}`
  const label = `secondary-${Date.now()}`

  const win = new WebviewWindow(label, {
    url,
    title: options.title,
    width: options.width ?? 900,
    height: options.height ?? 600,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    center: options.center ?? true,
    resizable: options.resizable ?? true,
    maximized: options.maximized,
    decorations: options.decorations,
    transparent: options.transparent,
    alwaysOnTop: options.alwaysOnTop,
  })

  // 探测：created 成功，error 或超时失败
  const outcome = await new Promise<'ok' | 'error' | 'timeout'>((resolve) => {
    let settled = false
    const done = (v: 'ok' | 'error' | 'timeout') => {
      if (settled) return
      settled = true
      resolve(v)
    }
    win.once('tauri://created', () => done('ok'))
    win.once('tauri://error', (e) => {
      console.error('[open-window] 创建新窗口失败:', e)
      done('error')
    })
    setTimeout(() => done('timeout'), CREATE_TIMEOUT)
  })

  if (outcome !== 'ok') {
    // 创建失败：尝试清理，避免留下半创建窗口
    win.once('tauri://created', () => {
      win.close().catch(() => {})
    })
    return { ok: false, reason: outcome === 'timeout' ? 'timeout' : 'create-failed' }
  }

  return { ok: true, window: win }
}

/**
 * 打开一个新窗口加载指定路由。
 * @deprecated 优先使用 {@link openSecondary}（带跨平台探测）；本函数不做成功探测。
 * @returns Tauri 下返回创建的 WebviewWindow；Web 环境返回 null（已降级为 window.open）
 */
export async function openInNewWindow(
  route: string,
  options: OpenWindowOptions = {}
): Promise<import('@tauri-apps/api/webviewWindow').WebviewWindow | null> {
  if (!isTauri) {
    window.open(route, '_blank')
    return null
  }
  const res = await openSecondary(route, options)
  return res.ok ? res.window : null
}

/**
 * 当前窗口是否为通过 openSecondary / openInNewWindow 创建的次级窗口。
 * 次级窗口共享主窗口的数据库/权限，但不应重复执行内容同步、备份提醒等
 * 主窗口才应承担的一次性启动逻辑（避免弹出重复的同步/备份确认框）。
 */
export async function isSecondaryWindow(): Promise<boolean> {
  if (!isTauri) return false
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  try {
    return getCurrentWebviewWindow().label.startsWith('secondary-')
  } catch {
    return false
  }
}

/**
 * 将当前页面在新窗口中打开（用于侧边栏/顶栏的“弹出”入口）。
 */
export async function openCurrentPageInNewWindow(
  options: Omit<OpenWindowOptions, 'title'> = {}
): Promise<import('@tauri-apps/api/webviewWindow').WebviewWindow | null> {
  const path = window.location.pathname + window.location.search + window.location.hash
  return openInNewWindow(path, options)
}
