/**
 * 当前是否运行在 Tauri 环境中 (桌面端或移动端)
 * 
 * 注意：
 * 1. Tauri v2 会在 window 注入 __TAURI_INTERNALS__
 * 2. 保留 typeof window 判断是为了防止在 Vite 构建阶段 (Node.js 环境) 报错
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * 当前是否是纯 Web 浏览器环境
 */
export const isWeb = typeof window !== 'undefined' && !isTauri;