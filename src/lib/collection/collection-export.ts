/**
 * 缺卡清单导出
 * 生成文本清单并复制到剪贴板或保存为 .txt（Tauri 环境走插件，Web 环境降级）。
 */

import type { MissingCardItem } from '$lib/db'
import { BUCKET_LABELS } from '$lib/cards/utils/variant-utils'
import { isTauri } from '$lib/db/env'
import { writeTextFile } from '$lib/services/db-file-service'

/** 生成缺卡清单文本 */
export function buildMissingListText(
  items: MissingCardItem[],
  seriesName: string | null,
  totalOwned: number,
  totalCount: number
): string {
  const lines: string[] = []
  const t = new Date()
  lines.push('符文战场 · 缺卡清单')
  lines.push(`系列：${seriesName ?? '全部系列'}（${totalOwned}/${totalCount}）`)
  lines.push(`导出时间：${t.toLocaleString('zh-CN')}`)
  lines.push('='.repeat(36))
  if (items.length === 0) {
    lines.push('（无缺卡，全部集齐！）')
  } else {
    for (const item of items) {
      const bucket = BUCKET_LABELS[item.bucket as keyof typeof BUCKET_LABELS] ?? item.bucket
      lines.push(
        `[${bucket}] ${item.cardNo ?? ''} ${item.cardNameCn ?? ''}（缺 ${item.missingVariants}/${item.totalVariants}）`
      )
    }
  }
  lines.push('='.repeat(36))
  lines.push(`合计 ${items.length} 张卡待补全`)
  return lines.join('\n')
}

function downloadTextInWeb(text: string, name: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 复制缺卡清单到剪贴板（返回是否成功） */
export async function copyMissingList(text: string): Promise<boolean> {
  try {
    if (isTauri) {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
      await writeText(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    return true
  } catch {
    return false
  }
}

/** 保存缺卡清单为 .txt 文件（返回是否成功） */
export async function saveMissingList(
  text: string,
  defaultName: string
): Promise<boolean> {
  try {
    if (isTauri) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const dest = await save({
        title: '保存缺卡清单',
        defaultPath: defaultName,
        filters: [{ name: '文本文件', extensions: ['txt'] }],
      })
      if (!dest) return false
      await writeTextFile(dest, text)
    } else {
      downloadTextInWeb(text, defaultName)
    }
    return true
  } catch {
    return false
  }
}
