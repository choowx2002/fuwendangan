/**
 * 对局记录数据仓储层
 */

import { Snowflake } from '@theinternetfolks/snowflake'
import { TABLES } from '../config/constants'
import type {
  MatchGame,
  MatchGameInput,
  MatchInput,
  MatchRecord,
  MatchSummary,
  MatchWithGames,
} from '../types'
import { getDatabase } from './database'
import { addTombstone } from './sync-repository'

/**
 * SQL 平局条件：显式 win_type='draw'，或正常比分且双方同分（兼容历史数据）
 */
const DRAW_SQL = `(g.win_type = 'draw' OR (g.win_type = 'normal' AND g.my_score = g.opp_score AND g.my_score IS NOT NULL))`

/**
 * 获取当前时间戳（ISO 8601）
 */
function now(): string {
  return new Date().toISOString()
}

/**
 * 将 SQLite 行映射为小局模型（is_win 0/1 → boolean）
 */
function mapGameRow(row: any): MatchGame {
  return {
    id: row.id,
    match_id: row.match_id,
    game_number: row.game_number,
    my_score: row.my_score,
    opp_score: row.opp_score,
    win_type: row.win_type,
    is_win: !!row.is_win,
    is_first: row.is_first === null || row.is_first === undefined ? null : !!row.is_first,
    win_reason: row.win_reason,
    log: row.log,
    created_at: row.created_at,
  }
}

/**
 * 创建一场对局（含小局）
 * @returns 对局 id
 */
export async function createMatch(input: MatchInput, games: MatchGameInput[]): Promise<string> {
  const db = await getDatabase()
  const id = Snowflake.generate()
  const timestamp = now()

  const sql = `
    INSERT INTO ${TABLES.MATCH_RECORDS}
      (id, deck_id, player_name, group_name, opponent_name, opponent_deck, opp_legend_id, opp_legend_print_id, opp_legend_name, opp_legend_image, deck_version_id, deck_version_number, best_of, note, played_at, replay_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  await db.execute(sql, [
    id,
    input.deck_id,
    input.player_name ?? null,
    input.group_name ?? null,
    input.opponent_name ?? null,
    input.opponent_deck ?? null,
    input.opp_legend_id ?? null,
    input.opp_legend_print_id ?? null,
    input.opp_legend_name ?? null,
    input.opp_legend_image ?? null,
    input.deck_version_id ?? null,
    input.deck_version_number ?? null,
    input.best_of ?? null,
    input.note ?? null,
    input.played_at ?? null,
    input.replay_key ?? null,
    timestamp,
    timestamp,
  ])

  await insertGames(id, games)
  return id
}

/**
 * 更新一场对局（更新场次信息并重建小局）
 */
export async function updateMatch(
  matchId: string,
  input: Partial<MatchInput>,
  games: MatchGameInput[]
): Promise<boolean> {
  const db = await getDatabase()
  const fields: string[] = []
  const params: any[] = []

  if (input.deck_id !== undefined) {
    fields.push(`deck_id = ?`)
    params.push(input.deck_id)
  }
  if (input.player_name !== undefined) {
    fields.push(`player_name = ?`)
    params.push(input.player_name ?? null)
  }
  if (input.group_name !== undefined) {
    fields.push(`group_name = ?`)
    params.push(input.group_name ?? null)
  }
  if (input.opponent_name !== undefined) {
    fields.push(`opponent_name = ?`)
    params.push(input.opponent_name ?? null)
  }
  if (input.opponent_deck !== undefined) {
    fields.push(`opponent_deck = ?`)
    params.push(input.opponent_deck ?? null)
  }
  if (input.opp_legend_id !== undefined) {
    fields.push(`opp_legend_id = ?`)
    params.push(input.opp_legend_id ?? null)
  }
  if (input.opp_legend_print_id !== undefined) {
    fields.push(`opp_legend_print_id = ?`)
    params.push(input.opp_legend_print_id ?? null)
  }
  if (input.opp_legend_name !== undefined) {
    fields.push(`opp_legend_name = ?`)
    params.push(input.opp_legend_name ?? null)
  }
  if (input.opp_legend_image !== undefined) {
    fields.push(`opp_legend_image = ?`)
    params.push(input.opp_legend_image ?? null)
  }
  if (input.deck_version_id !== undefined) {
    fields.push(`deck_version_id = ?`)
    params.push(input.deck_version_id ?? null)
  }
  if (input.deck_version_number !== undefined) {
    fields.push(`deck_version_number = ?`)
    params.push(input.deck_version_number ?? null)
  }
  if (input.best_of !== undefined) {
    fields.push(`best_of = ?`)
    params.push(input.best_of ?? null)
  }
  if (input.note !== undefined) {
    fields.push(`note = ?`)
    params.push(input.note ?? null)
  }
  if (input.played_at !== undefined) {
    fields.push(`played_at = ?`)
    params.push(input.played_at ?? null)
  }
  if (input.replay_key !== undefined) {
    fields.push(`replay_key = ?`)
    params.push(input.replay_key ?? null)
  }

  if (fields.length > 0) {
    fields.push(`updated_at = ?`)
    params.push(now())
    params.push(matchId)
    await db.execute(`UPDATE ${TABLES.MATCH_RECORDS} SET ${fields.join(', ')} WHERE id = ?`, params)
  }

  await db.execute(`DELETE FROM ${TABLES.MATCH_GAMES} WHERE match_id = ?`, [matchId])
  await insertGames(matchId, games)
  return true
}

/**
 * 插入一场对局的所有小局
 */
async function insertGames(matchId: string, games: MatchGameInput[]): Promise<void> {
  if (games.length === 0) return
  const db = await getDatabase()
  const timestamp = now()

  const sql = `
    INSERT INTO ${TABLES.MATCH_GAMES}
      (id, match_id, game_number, my_score, opp_score, win_type, is_win, is_first, win_reason, log, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `

  for (const game of games) {
    await db.execute(sql, [
      Snowflake.generate(),
      matchId,
      game.game_number,
      game.my_score ?? null,
      game.opp_score ?? null,
      game.win_type,
      game.is_win ? 1 : 0,
      game.is_first === true ? 1 : game.is_first === false ? 0 : null,
      game.win_reason ?? null,
      game.log ?? null,
      timestamp,
    ])
  }
}

/**
 * 查询单场对局（含小局）
 */
export async function getMatchById(matchId: string): Promise<MatchWithGames | null> {
  return loadMatchWithGamesById(matchId)
}

/** 按 id 加载单场对局（含小局 + 印刷信息），复用 getMatchById/findSynced 等入口 */
async function loadMatchWithGamesById(matchId: string): Promise<MatchWithGames | null> {
  const db = await getDatabase()
  const rows = await db.select<MatchRecord[]>(
    `SELECT m.*, cp.card_no_extend AS opp_legend_print_code, cp.language AS opp_legend_lang
     FROM ${TABLES.MATCH_RECORDS} m
     LEFT JOIN ${TABLES.CARD_PRINTS} cp ON cp.id = m.opp_legend_print_id
     WHERE m.id = ?`,
    [matchId]
  )
  if (rows.length === 0) return null

  const games = await getGamesByMatch(matchId)
  return { ...rows[0], games }
}

/**
 * 按复盘 key 查询绑定记录（含小局）。本地列 replay_key 唯一。
 */
export async function getMatchByReplayKey(replayKey: string): Promise<MatchWithGames | null> {
  const db = await getDatabase()
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.MATCH_RECORDS} WHERE replay_key = ?`,
    [replayKey]
  )
  const row = rows[0]
  if (!row) return null
  return loadMatchWithGamesById(row.id)
}

/** 复盘绑定身份指纹（用于跨设备识别同一局） */
export interface ReplayBindingIdentity {
  roomCode: string | null
  startedAt: number | null
}

function replayPlayedAt(startedAt: number | null): string | null {
  return startedAt == null ? null : new Date(startedAt).toISOString()
}

/**
 * 身份指纹查找：同一份复盘 json 在另一设备已同步出 match 记录（本机无 replay_key 链接）时，
 * 用 group_name(=roomCode) + played_at(=startedAt ISO) 找到它，供导入静默重链 / 弹窗合并编辑。
 * 已带 replay_key 链接（归属其他局）的记录不参与匹配；多条时取 updated_at 最新。
 */
export async function findSyncedMatchForReplay(
  identity: ReplayBindingIdentity
): Promise<MatchWithGames | null> {
  const playedAt = replayPlayedAt(identity.startedAt)
  if (!identity.roomCode || !playedAt) return null
  const db = await getDatabase()
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.MATCH_RECORDS}
     WHERE group_name = ? AND played_at = ?
       AND (replay_key IS NULL OR replay_key = '')
     ORDER BY updated_at DESC LIMIT 1`,
    [identity.roomCode, playedAt]
  )
  const row = rows[0]
  if (!row) return null
  return loadMatchWithGamesById(row.id)
}

/**
 * 导入后静默重链：身份指纹命中已同步记录时补上本机 replay_key 链接。
 * 只改本地列、不新建行、不触碰 note/结果；返回是否重链成功。
 */
export async function relinkReplayToSyncedMatch(
  replayKey: string,
  identity: ReplayBindingIdentity
): Promise<boolean> {
  const found = await findSyncedMatchForReplay(identity)
  if (!found) return false
  const db = await getDatabase()
  await db.execute(`UPDATE ${TABLES.MATCH_RECORDS} SET replay_key = ? WHERE id = ?`, [
    replayKey,
    found.id,
  ])
  return true
}

/** 全部复盘绑定关系：replay_key → deck_id（复盘列表展示 FileLock 指示用） */
export async function getAllReplayBindings(): Promise<Map<string, string>> {
  const db = await getDatabase()
  const rows = await db.select<{ replay_key: string; deck_id: string }[]>(
    `SELECT replay_key, deck_id FROM ${TABLES.MATCH_RECORDS}
     WHERE replay_key IS NOT NULL AND replay_key != ''`
  )
  return new Map(rows.map((r) => [r.replay_key, r.deck_id]))
}

/** 删除复盘绑定记录（按 replay_key），带同步墓碑；未绑定返回 false */
export async function deleteMatchByReplayKey(replayKey: string): Promise<boolean> {
  const db = await getDatabase()
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${TABLES.MATCH_RECORDS} WHERE replay_key = ?`,
    [replayKey]
  )
  const row = rows[0]
  if (!row) return false
  return deleteMatch(row.id)
}

/**
 * 查询某卡组的所有对局（含小局，按对局时间倒序）
 */
export async function getMatchesByDeck(deckId: string): Promise<MatchWithGames[]> {
  const db = await getDatabase()
  const rows = await db.select<MatchRecord[]>(
    `SELECT m.*, cp.card_no_extend AS opp_legend_print_code, cp.language AS opp_legend_lang
     FROM ${TABLES.MATCH_RECORDS} m
     LEFT JOIN ${TABLES.CARD_PRINTS} cp ON cp.id = m.opp_legend_print_id
     WHERE m.deck_id = ?
     ORDER BY m.created_at DESC`,
    [deckId]
  )
  return withGames(rows)
}

/**
 * 查询小局列表（按 game_number 升序）
 */
async function getGamesByMatch(matchId: string): Promise<MatchGame[]> {
  const db = await getDatabase()
  const rows = await db.select<any[]>(
    `SELECT * FROM ${TABLES.MATCH_GAMES} WHERE match_id = ? ORDER BY game_number ASC`,
    [matchId]
  )
  return rows.map(mapGameRow)
}

/**
 * 为多场对局批量加载小局
 */
async function withGames(records: MatchRecord[]): Promise<MatchWithGames[]> {
  if (records.length === 0) return []
  const db = await getDatabase()

  const placeholders = records.map(() => '?').join(', ')
  const rows = await db.select<any[]>(
    `SELECT * FROM ${TABLES.MATCH_GAMES} WHERE match_id IN (${placeholders}) ORDER BY game_number ASC`,
    records.map((r) => r.id)
  )

  const byMatch = new Map<string, MatchGame[]>()
  for (const row of rows) {
    const game = mapGameRow(row)
    const list = byMatch.get(game.match_id) ?? []
    list.push(game)
    byMatch.set(game.match_id, list)
  }

  return records.map((record) => ({
    ...record,
    games: byMatch.get(record.id) ?? [],
  }))
}

/**
 * 删除一场对局（小局级联删除；写入同步墓碑传播删除）
 */
export async function deleteMatch(matchId: string): Promise<boolean> {
  const db = await getDatabase()
  await db.execute(`DELETE FROM ${TABLES.MATCH_RECORDS} WHERE id = ?`, [matchId])
  await addTombstone('match', matchId)
  return true
}

/**
 * 查询某卡组的战绩统计
 */
export async function getDeckMatchStats(deckId: string): Promise<MatchSummary | null> {
  const db = await getDatabase()
  const rows = await db.select<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM ${TABLES.MATCH_RECORDS} WHERE deck_id = ?`,
    [deckId]
  )
  const matchCount = rows[0]?.c ?? 0
  if (matchCount === 0) return null

  const matchResult = (await getMatchResultCounts([deckId])).get(deckId)

  return {
    deck_id: deckId,
    matches: matchCount,
    ...(await getGameAggregates(deckId)),
    match_wins: matchResult?.match_wins ?? 0,
    match_losses: matchResult?.match_losses ?? 0,
    match_draws: matchResult?.match_draws ?? 0,
  }
}

/**
 * 批量统计多个卡组的对局级结果（wins > losses 记胜，反之记负，相等记平）
 */
async function getMatchResultCounts(
  deckIds: string[]
): Promise<Map<string, { match_wins: number; match_losses: number; match_draws: number }>> {
  const result = new Map<
    string,
    { match_wins: number; match_losses: number; match_draws: number }
  >()
  if (deckIds.length === 0) return result

  const db = await getDatabase()
  const placeholders = deckIds.map(() => '?').join(', ')

  const rows = await db.select<
    { deck_id: string; match_wins: number; match_losses: number; match_draws: number }[]
  >(
    `SELECT r.deck_id,
            COALESCE(SUM(CASE WHEN m.wins > m.losses THEN 1 ELSE 0 END), 0) as match_wins,
            COALESCE(SUM(CASE WHEN m.losses > m.wins THEN 1 ELSE 0 END), 0) as match_losses,
            COALESCE(SUM(CASE WHEN m.wins = m.losses THEN 1 ELSE 0 END), 0) as match_draws
     FROM ${TABLES.MATCH_RECORDS} r
     JOIN (
       SELECT g.match_id,
              COALESCE(SUM(CASE WHEN g.is_win = 1 THEN 1 ELSE 0 END), 0) as wins,
              COALESCE(SUM(CASE WHEN g.is_win = 0 AND NOT ${DRAW_SQL} THEN 1 ELSE 0 END), 0) as losses
       FROM ${TABLES.MATCH_GAMES} g
       GROUP BY g.match_id
     ) m ON m.match_id = r.id
     WHERE r.deck_id IN (${placeholders})
     GROUP BY r.deck_id`,
    deckIds
  )

  for (const row of rows) {
    result.set(row.deck_id, {
      match_wins: row.match_wins,
      match_losses: row.match_losses,
      match_draws: row.match_draws,
    })
  }
  return result
}

/**
 * 批量查询多个卡组的战绩统计（供卡组列表/首页展示）
 */
export async function getMatchStatsForDecks(deckIds: string[]): Promise<Map<string, MatchSummary>> {
  const result = new Map<string, MatchSummary>()
  if (deckIds.length === 0) return result

  const db = await getDatabase()
  const placeholders = deckIds.map(() => '?').join(', ')

  const matchRows = await db.select<{ deck_id: string; c: number }[]>(
    `SELECT deck_id, COUNT(*) as c FROM ${TABLES.MATCH_RECORDS}
     WHERE deck_id IN (${placeholders})
     GROUP BY deck_id`,
    deckIds
  )

  for (const row of matchRows) {
    result.set(row.deck_id, {
      deck_id: row.deck_id,
      matches: row.c,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      match_wins: 0,
      match_losses: 0,
      match_draws: 0,
      first_games: 0,
      first_wins: 0,
      second_games: 0,
      second_wins: 0,
    })
  }

  const gameRows = await db.select<
    {
      deck_id: string
      games: number
      wins: number
      losses: number
      draws: number
      first_games: number
      first_wins: number
      second_games: number
      second_wins: number
    }[]
  >(
    `SELECT r.deck_id,
            COUNT(g.id) as games,
            COALESCE(SUM(CASE WHEN g.is_win = 1 THEN 1 ELSE 0 END), 0) as wins,
            COALESCE(SUM(CASE WHEN g.is_win = 0 AND NOT ${DRAW_SQL} THEN 1 ELSE 0 END), 0) as losses,
            COALESCE(SUM(CASE WHEN ${DRAW_SQL} THEN 1 ELSE 0 END), 0) as draws,
            COALESCE(SUM(CASE WHEN g.is_first = 1 THEN 1 ELSE 0 END), 0) as first_games,
            COALESCE(SUM(CASE WHEN g.is_first = 1 AND g.is_win = 1 THEN 1 ELSE 0 END), 0) as first_wins,
            COALESCE(SUM(CASE WHEN g.is_first = 0 THEN 1 ELSE 0 END), 0) as second_games,
            COALESCE(SUM(CASE WHEN g.is_first = 0 AND g.is_win = 1 THEN 1 ELSE 0 END), 0) as second_wins
     FROM ${TABLES.MATCH_RECORDS} r
     JOIN ${TABLES.MATCH_GAMES} g ON g.match_id = r.id
     WHERE r.deck_id IN (${placeholders})
     GROUP BY r.deck_id`,
    deckIds
  )

  for (const row of gameRows) {
    const summary = result.get(row.deck_id)
    if (summary) {
      summary.games = row.games
      summary.wins = row.wins
      summary.losses = row.losses
      summary.draws = row.draws
      summary.first_games = row.first_games
      summary.first_wins = row.first_wins
      summary.second_games = row.second_games
      summary.second_wins = row.second_wins
    }
  }

  const matchCounts = await getMatchResultCounts(deckIds)
  for (const [deckId, counts] of matchCounts) {
    const summary = result.get(deckId)
    if (summary) {
      summary.match_wins = counts.match_wins
      summary.match_losses = counts.match_losses
      summary.match_draws = counts.match_draws
    }
  }

  return result
}

/**
 * 统计单卡组小局汇总
 */
async function getGameAggregates(
  deckId: string
): Promise<
  Pick<
    MatchSummary,
    | 'games'
    | 'wins'
    | 'losses'
    | 'draws'
    | 'first_games'
    | 'first_wins'
    | 'second_games'
    | 'second_wins'
  >
> {
  const db = await getDatabase()
  const rows = await db.select<
    {
      games: number
      wins: number
      losses: number
      draws: number
      first_games: number
      first_wins: number
      second_games: number
      second_wins: number
    }[]
  >(
    `SELECT COUNT(g.id) as games,
            COALESCE(SUM(CASE WHEN g.is_win = 1 THEN 1 ELSE 0 END), 0) as wins,
            COALESCE(SUM(CASE WHEN g.is_win = 0 AND NOT ${DRAW_SQL} THEN 1 ELSE 0 END), 0) as losses,
            COALESCE(SUM(CASE WHEN ${DRAW_SQL} THEN 1 ELSE 0 END), 0) as draws,
            COALESCE(SUM(CASE WHEN g.is_first = 1 THEN 1 ELSE 0 END), 0) as first_games,
            COALESCE(SUM(CASE WHEN g.is_first = 1 AND g.is_win = 1 THEN 1 ELSE 0 END), 0) as first_wins,
            COALESCE(SUM(CASE WHEN g.is_first = 0 THEN 1 ELSE 0 END), 0) as second_games,
            COALESCE(SUM(CASE WHEN g.is_first = 0 AND g.is_win = 1 THEN 1 ELSE 0 END), 0) as second_wins
     FROM ${TABLES.MATCH_RECORDS} r
     JOIN ${TABLES.MATCH_GAMES} g ON g.match_id = r.id
     WHERE r.deck_id = ?`,
    [deckId]
  )
  const row = rows[0]
  return {
    games: row?.games ?? 0,
    wins: row?.wins ?? 0,
    losses: row?.losses ?? 0,
    draws: row?.draws ?? 0,
    first_games: row?.first_games ?? 0,
    first_wins: row?.first_wins ?? 0,
    second_games: row?.second_games ?? 0,
    second_wins: row?.second_wins ?? 0,
  }
}

/**
 * 获取已有对局分组（去重），用于记录时的自动补全提示
 */
export async function getMatchGroups(): Promise<string[]> {
  const db = await getDatabase()
  const rows = await db.select<{ group_name: string | null }[]>(
    `SELECT DISTINCT group_name FROM ${TABLES.MATCH_RECORDS}
     WHERE group_name IS NOT NULL AND group_name != ''`
  )
  return rows.map((r) => r.group_name as string).sort((a, b) => a.localeCompare(b, 'zh'))
}
