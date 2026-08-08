/**
 * 缺卡清单导出
 * 生成文本清单并保存为 .txt（Tauri 环境走插件，Web 环境降级为浏览器下载）。
 */

import { isTauri } from '$lib/db/env'
import { writeTextFile } from '$lib/services/db-file-service'

/** 缺卡清单导出行：一个印刷卡牌（编号/名字/稀有度/拥有数/需求量） */
export interface MissingListTextRow {
  cardNoExtend: string
  cardNameCn: string | null
  rarity: string | null
  ownedQty: number
  needed: number
  /** 已集齐（拥有数 ≥ 需求），导出时行尾标记 */
  satisfied?: boolean
}

/** 生成缺卡清单文本（每行一个印刷卡牌） */
export function buildMissingListText(
  items: MissingListTextRow[],
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
      const mark = item.satisfied ? '（已集齐）' : ''
      lines.push(
        `${item.cardNoExtend} ${item.cardNameCn ?? ''} ${item.rarity ?? ''} ${item.ownedQty}/${item.needed}${mark}`
      )
    }
  }
  lines.push('='.repeat(36))
  lines.push(`合计 ${items.length} 个卡牌`)
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
