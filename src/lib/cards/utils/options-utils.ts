import { OPTIONS_PRIORITY } from '../config/constants'

export function sortOptions(type: string, options: string[]): string[] {
  const priority = OPTIONS_PRIORITY[type as keyof typeof OPTIONS_PRIORITY] as string[] | undefined

  // 没有定义优先级，直接按字母排序返回
  if (!priority) {
    return [...options].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    )
  }

  // 构建 index map，O(1) 查找
  const priorityMap = new Map(priority.map((item, idx) => [item, idx]))

  return [...options].sort((a, b) => {
    const idxA = priorityMap.get(a)
    const idxB = priorityMap.get(b)

    // 都在优先级列表中，按优先级顺序排
    if (idxA !== undefined && idxB !== undefined) {
      return idxA - idxB
    }
    // 只有 a 在优先级列表中，a 排前面
    if (idxA !== undefined) return -1
    // 只有 b 在优先级列表中，b 排前面
    if (idxB !== undefined) return 1
    // 都不在优先级列表中，按字母排序兜底
    return a.localeCompare(b)
  })
}
