/**
 * M0 自检脚本：用 Rift Atlas 样本文件对照验证解析器与回放引擎。
 *
 * 运行（编译为 CJS 后执行，无需额外依赖）：
 *   pnpm exec tsc --module nodenext --moduleResolution nodenext --target es2022 \
 *     --strict --skipLibCheck --lib es2022,dom --outDir /tmp/m0-out \
 *     src/lib/replay/types.ts src/lib/replay/replay-engine.ts src/lib/replay/import-parser.ts \
 *     scripts/m0-replay-check.ts
 *   node /tmp/m0-out/scripts/m0-replay-check.js [json 路径]
 *
 * 断言基于设计文档 v2.1 的实测结论：
 *   - 6 条会话 = 2 局（EMSBW / 5HMU3）
 *   - 5HMU3 三条游戏 session 为断线重连（重连 2 次）
 *   - 我方均为 UMA；最终比分预填 EMSBW 4:8、5HMU3 7:8
 */

import { readFileSync } from 'node:fs'
import { parseRiftExport } from '../src/lib/replay/import-parser.js'
import {
  applyOp,
  buildReplay,
  finalState,
  stateAt,
  type GameState,
} from '../src/lib/replay/replay-engine.js'

const JSON_PATH =
  process.argv[2] ?? '/home/TianYue/.dsh/uploads/rift-atlas_all_2026-08-17T06-38-40-766Z.json'

let failures = 0
function assert(cond: unknown, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.error(`  ✗ FAIL: ${label}`)
  }
}

// ==================== 1. 解析 ====================

const raw = readFileSync(JSON_PATH, 'utf8')
const bundle = parseRiftExport(raw, { fileName: JSON_PATH })

console.log(`文件: ${bundle.fileName}`)
console.log(
  `导出: ${bundle.meta.exporter ?? '-'} v${bundle.meta.version ?? '-'} @ ${bundle.meta.exportedAt ?? '-'}`
)
console.log(`会话数(rawMatchCount): ${bundle.rawMatchCount}，分组(局数): ${bundle.groups.length}`)
console.log('warnings:', bundle.warnings.length ? bundle.warnings : '(无)')

assert(bundle.rawMatchCount === 6, `rawMatchCount === 6（实际 ${bundle.rawMatchCount}）`)
assert(bundle.groups.length === 2, `groups === 2 局（实际 ${bundle.groups.length}）`)

const emsbw = bundle.groups.find((g) => g.key === 'EMSBW')
const hm3 = bundle.groups.find((g) => g.key === '5HMU3')
assert(!!emsbw && !!hm3, '存在 EMSBW 与 5HMU3 两组')

if (emsbw) {
  console.log(`\n[EMSBW]`)
  assert(emsbw.sessionCount === 2, `sessionCount === 2（实际 ${emsbw.sessionCount}）`)
  assert(emsbw.gameSessions.length === 1, `gameSessions === 1（实际 ${emsbw.gameSessions.length}）`)
  assert(emsbw.reconnectCount === 0, `reconnectCount === 0（实际 ${emsbw.reconnectCount}）`)
  assert(
    emsbw.selfPlayerId === 'plr_7d01af4c',
    `selfPlayerId === plr_7d01af4c（实际 ${emsbw.selfPlayerId}）`
  )
  assert(emsbw.selfName === 'UMA', `selfName === UMA（实际 ${emsbw.selfName}）`)
  assert(emsbw.opponentName === 'test', `opponentName === test（实际 ${emsbw.opponentName}）`)
  assert(emsbw.queueFormat === 'bo1', `queueFormat === bo1（实际 ${emsbw.queueFormat}）`)
  assert(emsbw.opponentLegend === null, '对手卡组不可见 → opponentLegend === null')
  assert(
    !!emsbw.selfDecklistRaw && emsbw.selfDecklistRaw.includes('Legend:'),
    'selfDecklistRaw 已解析'
  )
  assert(emsbw.hasReplayableData, 'hasReplayableData === true')
}

if (hm3) {
  console.log(`\n[5HMU3]`)
  assert(hm3.sessionCount === 4, `sessionCount === 4（实际 ${hm3.sessionCount}）`)
  assert(hm3.gameSessions.length === 3, `gameSessions === 3（实际 ${hm3.gameSessions.length}）`)
  assert(hm3.reconnectCount === 2, `reconnectCount === 2（实际 ${hm3.reconnectCount}）`)
  assert(
    hm3.selfPlayerId === 'plr_23e100f1',
    `selfPlayerId === plr_23e100f1（实际 ${hm3.selfPlayerId}）`
  )
  assert(hm3.selfName === 'UMA', `selfName === UMA（实际 ${hm3.selfName}）`)
  assert(hm3.opponentName === 'jodido', `opponentName === jodido（实际 ${hm3.opponentName}）`)
  assert(hm3.queueFormat === 'bo1', `queueFormat === bo1（实际 ${hm3.queueFormat}）`)
  assert(hm3.opponentLegend === null, '对手卡组不可见 → opponentLegend === null')
  assert(!!hm3.selfDecklistRaw && hm3.selfDecklistRaw.includes('Legend:'), 'selfDecklistRaw 已解析')
  assert(hm3.hasReplayableData, 'hasReplayableData === true')
}

// ==================== 2. 回放引擎 ====================

for (const g of bundle.groups) {
  console.log(`\n[回放 ${g.key}]`)
  const build = buildReplay({ roomCode: g.roomCode, sessions: g.sessions, selfId: g.selfPlayerId })
  assert(build !== null, 'buildReplay 非空')
  if (!build) continue

  const patchCount = g.sessions.reduce(
    (sum, s) =>
      sum +
      s.events.filter((e) => {
        try {
          const p = JSON.parse(e.payload)
          return p?.type === 'authoritative_patch_commit'
        } catch {
          return false
        }
      }).length,
    0
  )
  assert(
    build.frames.length === patchCount,
    `frames === 补丁数 ${patchCount}（实际 ${build.frames.length}）`
  )
  assert(
    build.sessionCount === g.sessionCount,
    `sessionCount 传递正确（实际 ${build.sessionCount}）`
  )

  const reconnectNarration = build.narration.filter((n) => n.kind === 'reconnect')
  const boundaryFrames = build.frames.filter((f) => f.isSessionBoundary).length
  assert(
    reconnectNarration.length === g.reconnectCount,
    `重连解说条目 === ${g.reconnectCount}（实际 ${reconnectNarration.length}）`
  )
  assert(
    boundaryFrames === g.reconnectCount,
    `session 边界帧 === ${g.reconnectCount}（实际 ${boundaryFrames}）`
  )

  const state = finalState(build)
  assert(state !== null, 'finalState 非空')
  if (state) {
    const self = (state.players ?? []).find((p) => p.id === g.selfPlayerId) ?? null
    const opp = (state.players ?? []).find((p) => p !== self) ?? null
    const score = (p: { board?: Record<string, unknown> } | null): number | null =>
      typeof p?.board?.score === 'number' ? (p.board.score as number) : null
    console.log(
      `  最终比分: 我方 ${score(self)} : ${score(opp)}（预填 ${g.finalScore?.my} : ${g.finalScore?.opp}）`
    )
    assert(
      score(self) === g.finalScore?.my && score(opp) === g.finalScore?.opp,
      'finalScore 与最终状态一致'
    )
    assert(state.phase === 'in_game', `最终 phase === in_game（实际 ${state.phase}）`)
  }

  // 抽查第一帧状态
  const first = stateAt(build, 0)
  assert(!!first && (first.players ?? []).length === 2, '第一帧状态包含两名玩家')

  // 抽查中间帧状态可重建
  const mid = stateAt(build, Math.floor(build.frames.length / 2))
  assert(mid !== null && Array.isArray(mid.players), '中间帧状态可重建')

  const ignored = Object.keys(build.ignoredOps)
  assert(ignored.length === 0, `无未知 op（实际 ${ignored.length ? ignored.join(',') : '无'}）`)
}

// ==================== 3. applyOp 单元级合成测试 ====================

console.log('\n[applyOp 合成测试]')

{
  const s: GameState = { chainEntries: [{ id: 'a' }, { id: 'b' }] }
  applyOp(s, { op: 'chain_replace', entries: [{ id: 'x' }] })
  assert(s.chainEntries?.length === 1 && s.chainEntries[0].id === 'x', 'chain_replace 整体替换')
}

{
  const s: GameState = { chainEntries: [{ id: 'a' }] }
  applyOp(s, { op: 'chain_insert', index: 0, entries: [{ id: 'z' }] })
  applyOp(s, { op: 'chain_remove', entryIds: ['a'] })
  assert(
    s.chainEntries?.length === 1 && s.chainEntries[0].id === 'z',
    'chain_insert + chain_remove'
  )
}

{
  const s: GameState = {
    players: [{ id: 'p1', seat: 0, board: { score: 3, deckPeek: [], hand: [], deck: [] } }],
  }
  applyOp(s, { op: 'unset_board_fields', playerId: 'p1', fields: ['deckPeek'] })
  assert(!('deckPeek' in (s.players?.[0].board ?? {})), 'unset_board_fields 删除字段')
  applyOp(s, { op: 'set_board_fields', playerId: 'p1', fields: { score: 4 } })
  assert(s.players?.[0].board?.score === 4, 'set_board_fields 更新字段')
}

{
  const s: GameState = { players: [{ id: 'p1', seat: 0, board: { deck: [], hand: [] } }] }
  applyOp(s, {
    op: 'zone_insert',
    playerId: 'p1',
    zone: 'hand',
    cards: [{ id: 'c1' }, { id: 'c2' }],
  })
  applyOp(s, { op: 'zone_reorder', playerId: 'p1', zone: 'hand', cardIds: ['c2', 'c1'] })
  applyOp(s, {
    op: 'zone_move',
    cardId: 'c1',
    from: { playerId: 'p1', zone: 'hand' },
    to: { playerId: 'p1', zone: 'deck' },
  })
  const hand = s.players?.[0].board?.hand as unknown[]
  const deck = s.players?.[0].board?.deck as unknown[]
  const idOf = (arr: unknown[]): unknown => (arr[0] as { id?: string } | undefined)?.id
  assert(hand.length === 1 && idOf(hand) === 'c2', 'zone_insert/reorder/move 后手牌正确')
  assert(deck.length === 1 && idOf(deck) === 'c1', 'zone_move 目标区正确')
  applyOp(s, { op: 'zone_remove', playerId: 'p1', zone: 'deck', cardIds: ['c1'] })
  assert((s.players?.[0].board?.deck as unknown[]).length === 0, 'zone_remove 删除')
}

{
  const s: GameState = {
    players: [{ id: 'p1', seat: 0, board: { hand: [{ id: 'c1', exhausted: false }] } }],
  }
  applyOp(s, {
    op: 'patch_card_fields',
    playerId: 'p1',
    zone: 'hand',
    cardId: 'c1',
    fields: { exhausted: true },
  })
  applyOp(s, {
    op: 'unset_card_fields',
    playerId: 'p1',
    zone: 'hand',
    cardId: 'c1',
    fields: ['exhausted'],
  })
  assert(
    (s.players?.[0].board?.hand as Record<string, unknown>[])[0].exhausted === undefined,
    'patch/unset_card_fields'
  )
}

{
  const s: GameState = { players: [{ id: 'p1', seat: 0, board: {} }] }
  applyOp(s, { op: 'set_player_fields', playerId: 'p1', fields: { name: 'N' } })
  applyOp(s, { op: 'set_room_fields', fields: { phase: 'mulligan' } })
  applyOp(s, { op: 'unset_room_fields', fields: ['phase'] })
  assert(
    s.players?.[0].name === 'N' && s.phase === undefined,
    'set_player_fields / set/unset_room_fields'
  )
}

{
  const s: GameState = { players: [{ id: 'p1', seat: 0, board: {} }] }
  const ok = applyOp(s, { op: 'totally_unknown_op' })
  assert(ok === false, '未知 op 返回 false（可忽略）')
}

// ==================== 4. 错误路径 ====================

console.log('\n[错误路径]')
try {
  parseRiftExport('{ not json')
  assert(false, '非法 JSON 应抛错')
} catch (e) {
  assert((e as { code?: string }).code === 'not-json', 'not-json 错误码')
}
try {
  parseRiftExport({ matches: [] })
  assert(false, '空 matches 应抛错')
} catch (e) {
  assert((e as { code?: string }).code === 'no-matches', 'no-matches 错误码')
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
