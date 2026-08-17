<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'
  import {
    buildReplay,
    resolveSelfPlayer,
    stateAt,
    type ReplayBuild,
  } from '$lib/replay/replay-engine'
  import {
    collectCardCodesFromStates,
    resolveCardMetas,
    type ReplayCardMeta,
  } from '$lib/replay/card-meta'
  import type { ReplayGroup } from '$lib/replay/types'
  import {
    getReplayResultMarks,
    markReplayResult,
    type ReplayResultMark,
  } from '$lib/stores/replay-import.svelte'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import ReplayBattlefield from './ReplayBattlefield.svelte'
  import ReplayBoard from './ReplayBoard.svelte'
  import ReplayCard from './ReplayCard.svelte'
  import ReplayNarration from './ReplayNarration.svelte'
  import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from '@lucide/svelte'

  interface Props {
    group: ReplayGroup
  }
  let { group }: Props = $props()

  // build 是一次性构造的只读回放数据，用 $state.raw 避免深代理：
  // applyOp 会把 op 携带的卡/条目对象塞进克隆的 state，深代理下这些是 Svelte proxy，
  // 在 $derived 里再被 patch 操作写入会触发 state_unsafe_mutation。
  let build = $state.raw<ReplayBuild | null>(null)
  const metas = $state(new Map<string, ReplayCardMeta>())

  let current = $state(0)
  let playing = $state(false)
  let speed = $state(1)
  let narrationCollapsed = $state(false)
  let timer: ReturnType<typeof setInterval> | null = null

  $effect(() => {
    if (!build) return
    const codes = collectCardCodesFromStates(build.snapshots.map((s) => s.state))
    resolveCardMetas(codes).then((m) => {
      metas.clear()
      for (const [k, v] of m) metas.set(k, v)
    })
  })

  const total = $derived(build?.frames.length ?? 0)
  const safeCurrent = $derived(total > 0 ? Math.min(current, total - 1) : 0)
  const gameState = $derived(build && total > 0 ? stateAt(build, safeCurrent) : null)
  const me = $derived(gameState ? resolveSelfPlayer(gameState, build?.selfId ?? null) : null)
  const opp = $derived(gameState ? ((gameState.players ?? []).find((p) => p !== me) ?? null) : null)
  const activeTurnPlayerId = $derived(gameState?.activeTurnPlayerId ?? null)
  const chainEntries = $derived(gameState?.chainEntries ?? [])
  const frameLabel = $derived(
    build && total > 0
      ? `${get(t)('replay.frame', { values: { current: safeCurrent + 1, total } })} · seq ${
          build.frames[safeCurrent].seq
        } · ${gameState?.phase ?? '-'} · ${get(t)('replay.turn', { values: { number: gameState?.turnNumber ?? '-' } })}`
      : ''
  )
  const isEnd = $derived(total > 0 && safeCurrent >= total - 1)
  const marks = $derived(getReplayResultMarks())
  const resultKey = $derived(group.key)
  const selfName = $derived(group.selfName ?? me?.name ?? me?.id ?? '?')
  const oppName = $derived(group.opponentName ?? opp?.name ?? opp?.id ?? '?')
  const selfLegendCode = $derived(group.selfLegend?.cardCode ?? null)
  const oppLegendCode = $derived(group.opponentLegend?.cardCode ?? null)
  const selfScore = $derived(typeof me?.board?.score === 'number' ? Number(me.board.score) : 0)
  const oppScore = $derived(typeof opp?.board?.score === 'number' ? Number(opp.board.score) : 0)

  function schedule() {
    if (timer) clearInterval(timer)
    timer = setInterval(
      () => {
        if (current >= total - 1) {
          pause()
          return
        }
        current++
      },
      Math.round(1200 / speed)
    )
  }
  function play() {
    if (playing) return
    playing = true
    if (current >= total - 1) current = 0
  }

  // 播放中切换速度时重建 interval，否则仍按旧速度走
  $effect(() => {
    if (playing) schedule()
  })
  function pause() {
    playing = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  function togglePlay() {
    playing ? pause() : play()
  }
  function step(dir: -1 | 1) {
    const next = Math.max(0, Math.min(current + dir, total - 1))
    current = next
  }
  function jump(end: boolean) {
    current = end ? total - 1 : 0
  }

  // 进度条拖动用 rAF 节流：大回放下 stateAt 每次要重放整段补丁，逐像素触发会卡顿
  let rafPending = false
  function scrubTo(v: number) {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      if (isFinite(v)) current = Math.max(0, Math.min(v, total - 1))
    })
  }

  function markResult(mark: ReplayResultMark) {
    markReplayResult(resultKey, mark)
    const label =
      mark === 'win'
        ? get(t)('replay.resultWin')
        : mark === 'loss'
          ? get(t)('replay.resultLoss')
          : get(t)('replay.resultDraw')
    showToast(get(t)('replay.marked', { values: { result: label } }), 'success')
  }

  onMount(() => {
    build = buildReplay({
      roomCode: group.roomCode,
      sessions: group.sessions,
      selfId: group.selfPlayerId,
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        step(-1)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        step(1)
      } else if (e.code === 'Home') {
        e.preventDefault()
        jump(false)
      } else if (e.code === 'End') {
        e.preventDefault()
        jump(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer) clearInterval(timer)
    }
  })

  const durationMin = $derived(
    group.durationMs != null ? Math.max(1, Math.round(group.durationMs / 60000)) : null
  )
</script>

{#if !build || total === 0}
  <div class="empty-box">
    {#if group.snapshotCount > 0}
      {$t('replay.viewerIncomplete')}
    {:else}
      {$t('replay.viewerEmpty')}
    {/if}
  </div>
{:else}
  <div class="viewer">
    <header class="v-head">
      <div class="head-players">
        <div class="pchip">
          {#if oppLegendCode}
            <ReplayCard
              card={{ cardCode: oppLegendCode, name: oppName }}
              meta={metas.get(oppLegendCode) ?? null}
              width={30}
              showType={false}
            />
          {:else}
            <span class="chip-ph"></span>
          {/if}
          <span class="pname">{oppName}</span>
        </div>
        <div class="score">
          <span class="snum">{oppScore}</span>
          <span class="scol">:</span>
          <span class="snum">{selfScore}</span>
        </div>
        <div class="pchip self">
          <span class="pname">{selfName}</span>
          {#if selfLegendCode}
            <ReplayCard
              card={{ cardCode: selfLegendCode, name: selfName }}
              meta={metas.get(selfLegendCode) ?? null}
              width={30}
              showType={false}
            />
          {:else}
            <span class="chip-ph"></span>
          {/if}
        </div>
      </div>
      <div class="head-meta">
        <span class="room">{group.roomCode ?? group.key}</span>
        <span class="badge bo">{$t('replay.groupBo', { values: { n: 1 } })}</span>
        {#if group.queueFormat}
          <span class="badge queue"
            >{$t('replay.groupQueueFormat', { values: { format: group.queueFormat } })}</span
          >
        {/if}
        <span class="meta">
          {$t('replay.groupSessions', { values: { n: group.sessionCount } })}
          {#if group.reconnectCount > 0}
            · {$t('replay.groupReconnects', { values: { n: group.reconnectCount } })}
          {/if}
        </span>
        {#if durationMin !== null}
          <span class="meta"
            >{$t('replay.groupDuration', { values: { minutes: durationMin } })}</span
          >
        {/if}
      </div>
    </header>

    <div class="v-body">
      <div class="v-col">
        <ReplayBoard player={opp} side="opp" activeTurn={activeTurnPlayerId === opp?.id} {metas} />
        <ReplayBattlefield
          {me}
          {opp}
          {metas}
          turnNumber={gameState?.turnNumber}
          phase={gameState?.phase}
        />
        <ReplayBoard player={me} side="self" activeTurn={activeTurnPlayerId === me?.id} {metas} />
      </div>
      <div class="side-col">
        <ReplayNarration
          entries={build.narration}
          current={safeCurrent}
          collapsed={narrationCollapsed}
          onToggle={() => (narrationCollapsed = !narrationCollapsed)}
        />
        <div class="chain-panel {chainEntries.length === 0 ? 'empty' : ''}">
          {#if chainEntries.length === 0}
            <span class="chain-label">{$t('replay.chain', { values: { count: 0 } })}</span>
            <span class="chain-empty">{$t('replay.chainEmpty')}</span>
          {:else}
            <span class="chain-label"
              >{$t('replay.chain', { values: { count: chainEntries.length } })}</span
            >
            <div class="chain-cards">
              {#each chainEntries as en (en.id)}
                {@const c = en.card as Record<string, unknown> | undefined}
                <ReplayCard
                  card={c}
                  meta={c && typeof c.cardCode === 'string'
                    ? (metas.get(String(c.cardCode)) ?? null)
                    : null}
                  width={44}
                  showType={false}
                />
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <footer class="v-transport">
      <button class="tbtn" title="Home" onclick={() => jump(false)}><SkipBack size={14} /></button>
      <button class="tbtn" onclick={() => step(-1)}><ChevronLeft size={14} /></button>
      <button class="tbtn play" onclick={togglePlay}>
        {#if playing}<Pause size={14} />{:else}<Play size={14} />{/if}
        {$t(playing ? 'replay.pause' : 'replay.play')}
      </button>
      <button class="tbtn" onclick={() => step(1)}><ChevronRight size={14} /></button>
      <button class="tbtn" title="End" onclick={() => jump(true)}><SkipForward size={14} /></button>
      <select class="tspeed" bind:value={speed}>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>
      <input
        class="tscrub"
        type="range"
        min="0"
        max={total - 1}
        value={safeCurrent}
        oninput={(e) => {
          const v = Number((e.currentTarget as HTMLInputElement).value)
          scrubTo(v)
        }}
      />
      <span class="tframe">{frameLabel}</span>
    </footer>

    {#if isEnd}
      <div class="end-overlay">
        <div class="end-box">
          <h4>{$t('replay.unfinishedTitle')}</h4>
          <p>{$t('replay.unfinishedHint')}</p>
          <div class="end-actions">
            <button
              class="tbtn"
              class:selected={marks[resultKey] === 'win'}
              onclick={() => markResult('win')}
            >
              {$t('replay.markWin')}
            </button>
            <button
              class="tbtn"
              class:selected={marks[resultKey] === 'loss'}
              onclick={() => markResult('loss')}
            >
              {$t('replay.markLoss')}
            </button>
            <button
              class="tbtn"
              class:selected={marks[resultKey] === 'draw'}
              onclick={() => markResult('draw')}
            >
              {$t('replay.markDraw')}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
  }
  .empty-box {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
  }
  .v-head {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    font-size: 13px;
  }
  .head-players {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .pchip {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .pchip.self {
    justify-content: flex-end;
  }
  .pname {
    font-weight: 700;
    color: var(--text-primary);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-ph {
    width: 30px;
    height: 42px;
    flex: 0 0 auto;
    background: var(--surface-muted);
    border-radius: 4px;
  }
  .score {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 2px 14px;
    font-weight: 800;
    font-size: 18px;
    color: var(--text-primary);
  }
  .scol {
    color: var(--text-tertiary);
  }
  .head-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }
  .room {
    font-weight: 700;
    color: var(--text-primary);
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    border-radius: 8px;
    padding: 1px 8px;
  }
  .badge.bo {
    background: var(--accent-color);
    color: #fff;
  }
  .badge.queue {
    background: var(--surface-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .meta {
    color: var(--text-secondary);
  }
  .v-body {
    display: grid;
    grid-template-columns: 1fr 240px;
    gap: 10px;
    align-items: start;
  }
  .v-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .side-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .chain-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 10px;
  }
  .chain-label {
    color: var(--text-tertiary);
    font-size: 10px;
  }
  .chain-empty {
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .chain-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .v-transport {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 6px 10px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  }
  .tbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 4px 10px;
    cursor: pointer;
    font-size: 13px;
  }
  .tbtn:hover {
    background: var(--bg-hover);
  }
  .tbtn.play {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
    min-width: 88px;
    justify-content: center;
  }
  .tbtn.selected {
    outline: 2px solid var(--accent-color);
  }
  .tspeed {
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 3px 6px;
    font-size: 13px;
  }
  .tscrub {
    flex: 1;
    min-width: 120px;
    accent-color: var(--accent-color);
  }
  .tframe {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .end-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
  }
  .end-box {
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: min(440px, 92%);
    text-align: center;
  }
  .end-box h4 {
    margin: 0 0 8px;
    font-size: 15px;
    color: var(--text-primary);
  }
  .end-box p {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .end-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
</style>
