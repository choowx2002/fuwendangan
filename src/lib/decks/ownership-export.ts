/**
 * 卡组持有检查导出
 * 生成文本/CSV 清单并保存（Tauri 环境走插件，Web 环境降级为浏览器下载）。
 */

import { isTauri } from '$lib/db/env'
import { writeTextFile } from '$lib/services/db-file-service'
import { get } from 'svelte/store'
import { locale } from 'svelte-i18n'
import { t } from '$lib/i18n'

export type OwnershipExportFormat = 'txt' | 'csv'

export interface OwnershipExportRow {
  zoneLabel: string
  cardName: string
  cardNo: string
  owned: number
  needed: number
  insufficient: boolean
}

/** 生成持有检查文本（每行一个卡牌，按区域分组） */
export function buildOwnershipText(items: OwnershipExportRow[], deckName: string): string {
  const lines: string[] = []
  const stamp = new Date()
  lines.push(get(t)('deckDetail.ownershipExportTitle'))
  lines.push(get(t)('deckDetail.ownershipExportDeck', { values: { name: deckName } }))
  lines.push(
    get(t)('deckDetail.ownershipExportTime', {
      values: { time: stamp.toLocaleString(get(locale) || 'zh-CN') },
    })
  )
  lines.push('='.repeat(36))
  const missing = items.filter((i) => i.insufficient)
  lines.push(
    get(t)('deckDetail.ownershipExportMissing', {
      values: { count: missing.length, total: items.length },
    })
  )
  lines.push('='.repeat(36))
  if (items.length === 0) {
    lines.push(get(t)('deckDetail.ownershipExportEmpty'))
  } else {
    for (const item of items) {
      const mark = item.insufficient ? '' : get(t)('deckDetail.ownershipExportOwnedMark')
      lines.push(
        `[${item.zoneLabel}] ${item.cardNo} ${item.cardName} ${item.owned}/${item.needed}${mark}`
      )
    }
  }
  lines.push('='.repeat(36))
  return lines.join('\n')
}

/** CSV 单元格转义（引号包裹含逗号/引号/换行的字段） */
function csvCell(value: string | number | null): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 生成持有检查 CSV（首行表头，便于导入表格） */
export function buildOwnershipCsv(items: OwnershipExportRow[]): string {
  const lines: string[] = [get(t)('deckDetail.ownershipCsvHeader')]
  for (const item of items) {
    lines.push(
      [
        csvCell(item.zoneLabel),
        csvCell(item.cardName),
        csvCell(item.cardNo),
        csvCell(item.owned),
        csvCell(item.needed),
        csvCell(
          item.insufficient
            ? get(t)('deckDetail.ownershipCsvInsufficient')
            : get(t)('deckDetail.ownershipCsvOwned')
        ),
      ].join(',')
    )
  }
  return `\uFEFF${lines.join('\n')}`
}

function downloadTextInWeb(text: string, name: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 保存持有检查文件（返回是否成功） */
export async function saveOwnershipExport(
  content: string,
  defaultName: string,
  format: OwnershipExportFormat = 'txt'
): Promise<boolean> {
  try {
    if (isTauri) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const isCsv = format === 'csv'
      const dest = await save({
        title: get(t)('deckDetail.saveOwnershipTitle'),
        defaultPath: defaultName,
        filters: [
          {
            name: isCsv
              ? get(t)('deckDetail.csvFileFilter')
              : get(t)('deckDetail.textFileFilter'),
            extensions: isCsv ? ['csv'] : ['txt'],
          },
        ],
      })
      if (!dest) return false
      await writeTextFile(dest, content)
    } else {
      downloadTextInWeb(content, defaultName, format === 'csv' ? 'text/csv' : 'text/plain')
    }
    return true
  } catch {
    return false
  }
}
