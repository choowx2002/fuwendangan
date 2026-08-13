import { isTauri } from '$lib/db'

export interface ConfirmOptions {
  title?: string
  okLabel?: string
  cancelLabel?: string
}

/**
 * 统一确认弹窗：Tauri 环境走 plugin-dialog 的 ask()，Web 环境回退 window.confirm。
 * 所有不可逆操作（删除、清空等）都应先经此确认。
 */
export async function confirmAction(message: string, opts?: ConfirmOptions): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog')
    return ask(message, {
      title: opts?.title,
      kind: 'warning',
      okLabel: opts?.okLabel,
      cancelLabel: opts?.cancelLabel,
    })
  }
  return window.confirm(message)
}
