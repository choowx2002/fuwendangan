// src/lib/stores/ui-store.svelte.ts

// 1. 定义状态类型
export type LoadStatus = 'loading' | 'syncing' | 'success' | 'error' | 'hidden'

// 2. 使用模块级 $state 创建全局响应式对象
export const uiState = $state({
  status: 'loading' as LoadStatus,
  text: '' as string | undefined,
  subText: '' as string | undefined,
})

// 3. 提供便捷的更新方法（可选，但推荐，保持逻辑清晰）
export function setLoadStatus(status: LoadStatus, text?: string, subText?: string) {
  uiState.status = status
  uiState.text = text ?? undefined
  uiState.subText = subText ?? undefined
}

export function hideLoading() {
  uiState.status = 'hidden'
}
