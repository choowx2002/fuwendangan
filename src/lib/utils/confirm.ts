import { isTauri } from '$lib/db'
import {
  openConfirm,
  openAlert,
  openChoice,
  type DialogAction,
} from '$lib/stores/confirm-store.svelte'

export interface ConfirmOptions {
  title?: string
  okLabel?: string
  cancelLabel?: string
  /** 危险操作：确定按钮用红色样式 */
  danger?: boolean
}

/**
 * 统一确认弹窗：Tauri 环境走应用内模态框（无系统声音），Web 环境回退 window.confirm。
 * 所有不可逆操作（删除、清空等）都应先经此确认。
 */
export async function confirmAction(message: string, opts?: ConfirmOptions): Promise<boolean> {
  if (isTauri) {
    return openConfirm(message, opts)
  }
  return window.confirm(message)
}

export interface ChoiceOptions {
  title?: string
  cancelLabel?: string
  actions: DialogAction[]
}

/**
 * 统一多选操作弹窗：返回所选 action 的 key，取消则返回 null。
 * Tauri 环境走应用内模态框；Web 环境（无原生多按钮）回退为确认后取第一个 action。
 */
export async function confirmChoice(message: string, opts: ChoiceOptions): Promise<string | null> {
  if (isTauri) {
    return openChoice(message, opts)
  }
  if (!window.confirm(message)) return null
  return opts.actions[0]?.key ?? null
}

export type MessageKind = 'info' | 'success' | 'warning' | 'error'

export interface MessageOptions {
  title?: string
  okLabel?: string
  kind?: MessageKind
}

/**
 * 统一信息弹窗（单 OK 按钮）：Tauri 环境走应用内模态框（无系统声音），Web 环境回退 window.alert。
 * 替代原生 @tauri-apps/plugin-dialog 的 message()。
 */
export async function showMessage(message: string, opts?: MessageOptions): Promise<void> {
  if (isTauri) {
    return openAlert(message, {
      title: opts?.title,
      okLabel: opts?.okLabel,
      kind: opts?.kind,
    })
  }
  window.alert(message)
}
