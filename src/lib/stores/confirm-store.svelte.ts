// 应用内弹窗状态（替代原生 plugin-dialog 的 ask/message，避免系统弹窗声音）
import { get } from 'svelte/store'
import { t } from 'svelte-i18n'

export type DialogMode = 'confirm' | 'alert'
export type DialogIcon = 'info' | 'success' | 'warning' | 'error'

interface DialogState {
  open: boolean
  mode: DialogMode
  message: string
  title: string
  okLabel: string
  cancelLabel: string
  danger: boolean
  icon: DialogIcon
  resolve: ((value: boolean) => void) | null
}

export const dialogState = $state<DialogState>({
  open: false,
  mode: 'confirm',
  message: '',
  title: '',
  okLabel: '',
  cancelLabel: '',
  danger: false,
  icon: 'info',
  resolve: null,
})

export interface ConfirmOptions {
  title?: string
  okLabel?: string
  cancelLabel?: string
  /** 危险操作：确定按钮用红色样式 */
  danger?: boolean
}

export interface AlertOptions {
  title?: string
  okLabel?: string
  kind?: DialogIcon
}

/**
 * 打开应用内确认弹窗，返回用户选择的 Promise<boolean>。
 * Tauri 环境用它替代 @tauri-apps/plugin-dialog 的 ask()（无系统声音）。
 */
export function openConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    dialogState.mode = 'confirm'
    dialogState.message = message
    dialogState.title = opts.title ?? ''
    dialogState.okLabel = opts.okLabel ?? get(t)('common.confirm') ?? '确定'
    dialogState.cancelLabel = opts.cancelLabel ?? get(t)('common.cancel') ?? '取消'
    dialogState.danger = opts.danger ?? false
    dialogState.icon = opts.danger ? 'warning' : 'info'
    dialogState.resolve = resolve
    dialogState.open = true
  })
}

/**
 * 打开应用内信息弹窗（单 OK 按钮），返回用户关闭时 resolve 的 Promise。
 * Tauri 环境用它替代 @tauri-apps/plugin-dialog 的 message()（无系统声音）。
 */
export function openAlert(message: string, opts: AlertOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    dialogState.mode = 'alert'
    dialogState.message = message
    dialogState.title = opts.title ?? ''
    dialogState.okLabel = opts.okLabel ?? get(t)('common.confirm') ?? '确定'
    dialogState.cancelLabel = ''
    dialogState.danger = false
    dialogState.icon = opts.kind ?? 'info'
    dialogState.resolve = () => resolve()
    dialogState.open = true
  })
}

export function closeDialog(result: boolean) {
  dialogState.resolve?.(result)
  dialogState.resolve = null
  dialogState.open = false
}
