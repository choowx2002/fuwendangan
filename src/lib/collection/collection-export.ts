/**
 * 缺卡清单导出 / 通用 CSV 文本保存
 * 生成文本清单并保存为 .txt / .csv（Tauri 环境走插件，Web 环境降级为浏览器下载）。
 */

import { isTauri } from '$lib/db/env'
import { writeTextFile } from '$lib/services/db-file-service'
import { buildCsv, downloadTextInWeb } from '$lib/csv/csv-utils'

/** 缺卡清单导出行：一个印刷卡牌（编号/名字/稀有度/语言/拥有数/需求量） */
export interface MissingListTextRow {
  cardNoExtend: string
  cardNameCn: string | null
  rarity: string | null
  language: string
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

/** 导出文件格式 */
export type MissingExportFormat = 'txt' | 'csv'

/** 生成缺卡清单 CSV（首行表头，便于导入表格与回导：语言/拥有数列可回读写入收藏） */
export function buildMissingListCsv(items: MissingListTextRow[]): string {
  const rows = items.map((item) => [
    item.cardNoExtend,
    item.cardNameCn,
    item.rarity,
    item.language,
    item.ownedQty,
    item.needed,
  ])
  return buildCsv(['编号', '卡名', '稀有度', '语言', '拥有数', '需求量'], rows)
}

/** 通用保存文本/CSV 文件（返回是否成功）。title 为 Tauri 保存对话框标题。 */
export async function saveTextFile(
  content: string,
  defaultName: string,
  options: { format?: MissingExportFormat; title?: string } = {}
): Promise<boolean> {
  const format = options.format ?? 'txt'
  const isCsv = format === 'csv'
  try {
    if (isTauri) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const dest = await save({
        title: options.title ?? '保存文件',
        defaultPath: defaultName,
        filters: [
          {
            name: isCsv ? 'CSV 文件' : '文本文件',
            extensions: isCsv ? ['csv'] : ['txt'],
          },
        ],
      })
      if (!dest) return false
      await writeTextFile(dest, content)
    } else {
      downloadTextInWeb(content, defaultName, isCsv ? 'text/csv' : 'text/plain')
    }
    return true
  } catch {
    return false
  }
}

/** 保存缺卡清单文件（返回是否成功） */
export async function saveMissingList(
  content: string,
  defaultName: string,
  format: MissingExportFormat = 'txt'
): Promise<boolean> {
  return saveTextFile(content, defaultName, { format, title: '保存缺卡清单' })
}
