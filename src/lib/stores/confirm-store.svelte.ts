// 应用内弹窗状态（替代原生 plugin-dialog 的 ask/message，避免系统弹窗声音）
import { get } from 'svelte/store'
import { t } from 'svelte-i18n'

export type DialogMode = 'confirm' | 'alert' | 'choice'
export type DialogIcon = 'info' | 'success' | 'warning' | 'error'

/** choice 模式下的一个可选操作按钮 */
export interface DialogAction {
  /** 选中时 resolve 的标识 key */
  key: string
  label: string
  /** 危险操作：按钮用红色样式 */
  danger?: boolean
}

interface DialogState {
  open: boolean
  mode: DialogMode
  message: string
  title: string
  okLabel: string
  cancelLabel: string
  danger: boolean
  icon: DialogIcon
  actions: DialogAction[]
  resolve: ((value: boolean | string | null) => void) | null
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
  actions: [],
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

export interface ChoiceOptions {
  title?: string
  cancelLabel?: string
  actions: DialogAction[]
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
    dialogState.actions = []
    dialogState.resolve = (value) => resolve(Boolean(value))
    dialogState.open = true
  })
}

/**
 * 打开应用内多选操作弹窗（取消 / 多个可选按钮），返回所选 action 的 key；取消则返回 null。
 * 用于「删除并联动清理」这类需要用户在多个后果间选择的情形。
 */
export function openChoice(
  message: string,
  opts: Partial<ChoiceOptions> = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    dialogState.mode = 'choice'
    dialogState.message = message
    dialogState.title = opts.title ?? ''
    dialogState.okLabel = ''
    dialogState.cancelLabel = opts.cancelLabel ?? get(t)('common.cancel') ?? '取消'
    dialogState.danger = false
    dialogState.icon = 'warning'
    dialogState.actions = opts.actions ?? []
    dialogState.resolve = (v) => resolve(typeof v === 'string' ? v : null)
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
    dialogState.actions = []
    dialogState.resolve = () => resolve()
    dialogState.open = true
  })
}

export function closeDialog(result: boolean | string | null) {
  dialogState.resolve?.(result)
  dialogState.resolve = null
  dialogState.open = false
}
