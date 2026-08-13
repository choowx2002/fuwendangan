/**
 * 完整数据包导出服务
 * 一次性把「本地数据库 + 完整收藏 CSV + 全部卡组 JSON + 使用说明」导出到用户选择的目录，
 * 作为换机/重装前的一键数据兜底（覆盖整库备份 + 各模块 CSV/JSON 导出的组合）。
 */

import { appConfigDir, join } from '@tauri-apps/api/path'
import { isTauri } from '$lib/db/env'
import { copyFile, writeTextFile } from './db-file-service'
import { buildFullCollectionCsv } from '$lib/collection/full-collection-csv'
import {
  DB_NAME,
  getCollectionFullRows,
  getDecks,
  getDeckVersions,
  getDeckVersionCards,
  getMatchesByDeck,
  getDatabase,
  closeDatabase,
} from '$lib/db'

export interface DataPackResult {
  files: string[]
  deckCount: number
  collectionRows: number
}

/** 组装全部卡组导出负载（含版本与对局记录），与设置页「导出全部卡组」数据结构一致 */
async function buildDeckExportPayload(): Promise<{
  app: string
  type: string
  exportMode: string
  exportedAt: string
  matchRecords: boolean
  decks: unknown[]
}> {
  const allDecks = await getDecks()
  const decks: unknown[] = []

  for (const deck of allDecks) {
    const [versions, versionCards, matches] = await Promise.all([
      getDeckVersions(deck.id),
      getDeckVersionCards(deck.id),
      getMatchesByDeck(deck.id),
    ])
    const cardsByVersion = new Map<string, typeof versionCards>()
    for (const card of versionCards) {
      const list = cardsByVersion.get(card.deck_version_id) ?? []
      list.push(card)
      cardsByVersion.set(card.deck_version_id, list)
    }

    decks.push({
      ...deck,
      versions: versions.map((v) => ({ ...v, cards: cardsByVersion.get(v.id) ?? [] })),
      matches: matches.map((m) => ({
        player_name: m.player_name,
        group_name: m.group_name,
        opponent_name: m.opponent_name,
        opponent_deck: m.opponent_deck,
        opp_legend_id: m.opp_legend_id,
        opp_legend_print_id: m.opp_legend_print_id,
        opp_legend_name: m.opp_legend_name,
        opp_legend_image: m.opp_legend_image,
        deck_version_id: m.deck_version_id,
        deck_version_number: m.deck_version_number,
        best_of: m.best_of,
        note: m.note,
        played_at: m.played_at,
        created_at: m.created_at,
        updated_at: m.updated_at,
        games: m.games.map((g) => ({
          game_number: g.game_number,
          my_score: g.my_score,
          opp_score: g.opp_score,
          win_type: g.win_type,
          is_win: g.is_win,
          is_first: g.is_first,
          win_reason: g.win_reason,
          log: g.log,
        })),
      })),
    })
  }

  return {
    app: 'Rune Archive',
    type: 'decks-export',
    exportMode: 'all',
    exportedAt: new Date().toISOString(),
    matchRecords: true,
    decks,
  }
}

function buildDataPackReadme(stamp: string, collectionRows: number, deckCount: number): string {
  return [
    '符文档案 · 完整数据包',
    '=====================',
    `导出时间：${stamp}`,
    '',
    `本数据包共 ${collectionRows} 行收藏明细、${deckCount} 个卡组，包含以下文件：`,
    `1. rune-archive-db-${stamp}.db           完整本地数据库（卡组、收藏、借还、心愿单、购买清单、联系人、储物柜、对局记录等）`,
    `2. rune-archive-collection-${stamp}.csv  完整收藏明细（设置 → 收藏库 CSV 导入 → 完整收藏可回导）`,
    `3. rune-archive-decks-${stamp}.json      全部卡组与对局记录（设置 → 导入卡组可回导）`,
    `4. rune-archive-说明-${stamp}.txt        本说明文件`,
    '',
    '恢复方式：',
    '- 数据库：设置 → 本地数据库 → 恢复备份，选择 .db 文件（仅支持同版本应用）。',
    '- 收藏：收藏库 → CSV 导入 → 完整收藏（若 .db 已恢复则无需重复导入）。',
    '- 卡组：设置 → 导入卡组（若 .db 已恢复则无需重复导入）。',
    '',
    '注意事项：',
    '- 备份文件包含联系人（微信/QQ/电话）等私密信息，请妥善保管，勿外传。',
    '- 应用设置（界面语言、默认语言等）不在备份范围内，换机后需重新设置。',
    '',
  ].join('\n')
}

/**
 * 导出完整数据包到指定目录（桌面端）。
 * 数据库文件拷贝前会先关闭本地库连接以保证快照一致，拷贝后自动重开。
 */
export async function exportDataPack(targetDir: string): Promise<DataPackResult> {
  if (!isTauri) throw new Error('完整数据包导出仅支持桌面端')

  const stamp = new Date().toISOString().slice(0, 10)
  const configDir = await appConfigDir()
  const dbFileName = DB_NAME.replace(/^sqlite:/, '')
  const dbFilePath = await join(configDir, dbFileName)

  const [rows, deckPayload] = await Promise.all([getCollectionFullRows(), buildDeckExportPayload()])

  const files: string[] = []

  const dbDest = await join(targetDir, `rune-archive-db-${stamp}.db`)
  await closeDatabase()
  try {
    await copyFile(dbFilePath, dbDest)
  } finally {
    await getDatabase()
  }
  files.push(dbDest)

  const csvDest = await join(targetDir, `rune-archive-collection-${stamp}.csv`)
  await writeTextFile(csvDest, buildFullCollectionCsv(rows))
  files.push(csvDest)

  const jsonDest = await join(targetDir, `rune-archive-decks-${stamp}.json`)
  await writeTextFile(jsonDest, JSON.stringify(deckPayload, null, 2))
  files.push(jsonDest)

  const readmeDest = await join(targetDir, `rune-archive-说明-${stamp}.txt`)
  await writeTextFile(readmeDest, buildDataPackReadme(stamp, rows.length, deckPayload.decks.length))
  files.push(readmeDest)

  return { files, deckCount: deckPayload.decks.length, collectionRows: rows.length }
}
