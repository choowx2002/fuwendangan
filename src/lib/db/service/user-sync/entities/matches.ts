/**
 * 对局实体：实体聚合（key = match_records.id，含小局），LWW + 墓碑 'match'。
 * 写回时 deck_id 引用的卡组不存在则跳过该对局（外键 NOT NULL + CASCADE）；
 * deck_version_id 引用不存在则置 NULL。
 */

import { getDatabase } from '../../../repository/database'
import { TABLES } from '../../../config/constants'
import type { SyncMatch, SyncMatchGame, SyncTombstone } from '../types'
import { mergeById, existsIn, type DbLike, type MergeResult } from './common'

export function extractMatches(): Promise<SyncMatch[]> {
  return (async () => {
    const db = await getDatabase()
    const headers = (await db.select(`SELECT * FROM ${TABLES.MATCH_RECORDS}`)) as Record<
      string,
      unknown
    >[]
    const games = (await db.select(`SELECT * FROM ${TABLES.MATCH_GAMES}`)) as Record<
      string,
      unknown
    >[]
    const byMatch = new Map<string, SyncMatchGame[]>()
    for (const r of games) {
      const matchId = String(r.match_id)
      const game: SyncMatchGame = {
        id: String(r.id),
        game_number: Number(r.game_number),
        my_score: (r.my_score as number) ?? null,
        opp_score: (r.opp_score as number) ?? null,
        win_type: String(r.win_type ?? 'normal'),
        is_win: (r.is_win as boolean | number) ?? 0,
        is_first: (r.is_first as boolean | number | null) ?? null,
        win_reason: (r.win_reason as string) ?? null,
        log: (r.log as string) ?? null,
        created_at: (r.created_at as string) ?? null,
      }
      const list = byMatch.get(matchId)
      if (list) list.push(game)
      else byMatch.set(matchId, [game])
    }
    return headers.map((r) => {
      const id = String(r.id)
      return {
        id,
        deck_id: String(r.deck_id ?? ''),
        player_name: (r.player_name as string) ?? null,
        group_name: (r.group_name as string) ?? null,
        opponent_name: (r.opponent_name as string) ?? null,
        opponent_deck: (r.opponent_deck as string) ?? null,
        opp_legend_id: (r.opp_legend_id as string) ?? null,
        opp_legend_print_id: (r.opp_legend_print_id as string) ?? null,
        opp_legend_name: (r.opp_legend_name as string) ?? null,
        opp_legend_image: (r.opp_legend_image as string) ?? null,
        deck_version_id: (r.deck_version_id as string) ?? null,
        deck_version_number: (r.deck_version_number as number) ?? null,
        best_of: (r.best_of as number) ?? null,
        note: (r.note as string) ?? null,
        played_at: (r.played_at as string) ?? null,
        created_at: (r.created_at as string) ?? null,
        updated_at: (r.updated_at as string) ?? (r.created_at as string) ?? '',
        games: byMatch.get(id) ?? [],
      }
    })
  })()
}

export function mergeMatches(opts: {
  local: SyncMatch[]
  remote: SyncMatch[]
  localTomb: Map<string, SyncTombstone>
  remoteTomb: Map<string, SyncTombstone>
  localDeviceId: string
  remoteDeviceId: string
  live: Map<string, string>
}): MergeResult<SyncMatch> {
  return mergeById(opts)
}

export async function applyMatches(
  db: DbLike,
  upsert: SyncMatch[],
  deleteIds: string[]
): Promise<number> {
  for (const id of deleteIds) {
    await db.execute(`DELETE FROM ${TABLES.MATCH_RECORDS} WHERE id = ?`, [id])
  }
  let skipped = 0
  for (const m of upsert) {
    // deck_id 外键 NOT NULL：引用的卡组不存在时跳过该对局
    if (!(await existsIn(db, TABLES.DECKS, m.deck_id))) {
      skipped++
      continue
    }
    let deckVersionId = m.deck_version_id
    if (deckVersionId && !(await existsIn(db, TABLES.DECK_VERSIONS, deckVersionId)))
      deckVersionId = null

    await db.execute(
      `INSERT INTO ${TABLES.MATCH_RECORDS}
       (id, deck_id, player_name, group_name, opponent_name, opponent_deck,
        opp_legend_id, opp_legend_print_id, opp_legend_name, opp_legend_image,
        deck_version_id, deck_version_number, best_of, note, played_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         deck_id = excluded.deck_id, player_name = excluded.player_name,
         group_name = excluded.group_name, opponent_name = excluded.opponent_name,
         opponent_deck = excluded.opponent_deck, opp_legend_id = excluded.opp_legend_id,
         opp_legend_print_id = excluded.opp_legend_print_id, opp_legend_name = excluded.opp_legend_name,
         opp_legend_image = excluded.opp_legend_image, deck_version_id = excluded.deck_version_id,
         deck_version_number = excluded.deck_version_number, best_of = excluded.best_of,
         note = excluded.note, played_at = excluded.played_at, updated_at = excluded.updated_at`,
      [
        m.id,
        m.deck_id,
        m.player_name,
        m.group_name,
        m.opponent_name,
        m.opponent_deck,
        m.opp_legend_id,
        m.opp_legend_print_id,
        m.opp_legend_name,
        m.opp_legend_image,
        deckVersionId,
        m.deck_version_number,
        m.best_of,
        m.note,
        m.played_at,
        m.created_at,
        m.updated_at,
      ]
    )

    await db.execute(`DELETE FROM ${TABLES.MATCH_GAMES} WHERE match_id = ?`, [m.id])
    for (const g of m.games) {
      await db.execute(
        `INSERT INTO ${TABLES.MATCH_GAMES}
         (id, match_id, game_number, my_score, opp_score, win_type, is_win, is_first, win_reason, log, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          g.id,
          m.id,
          g.game_number,
          g.my_score,
          g.opp_score,
          g.win_type,
          g.is_win ? 1 : 0,
          g.is_first === null ? null : g.is_first ? 1 : 0,
          g.win_reason,
          g.log,
          g.created_at,
        ]
      )
    }
  }
  return skipped
}
