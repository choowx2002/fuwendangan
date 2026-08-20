<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'
  import {
    buildReplay,
    resolveSelfPlayer,
    stateAt,
    collectKeyframes,
    type ReplayBuild,
    type ReplayKeyframe,
  } from '$lib/replay/replay-engine'
  import {
    collectCardCodesFromStates,
    resolveCardMetas,
    resolveNameMetas,
    type ReplayCardMeta,
  } from '$lib/replay/card-meta'
  import type { RiftAtlasMatchRecord } from '$lib/replay/types'
  import {
    getReplayResultMarks,
    markReplayResult,
    type ReplayResultMark,
  } from '$lib/stores/replay-import.svelte'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import { isTauri } from '$lib/db/env'
  import { updateGameStarterChooser } from '$lib/services/replay-library-service'
  import ReplayBattlefield from './ReplayBattlefield.svelte'
  import ReplayBoard from './ReplayBoard.svelte'
  import ReplayCard from './ReplayCard.svelte'
  import ReplayCardReader from './ReplayCardReader.svelte'
  import ReplayNarration from './ReplayNarration.svelte'
  import {
    ChevronLeft,
    ChevronRight,
    Maximize,
    Minimize,
    PanelLeft,
    PanelRight,
    Pause,
    Play,
    ScrollText,
    SkipBack,
    SkipForward,
  } from '@lucide/svelte'

  interface Props {
    group: RiftAtlasMatchRecord
    /** 所在库文件 id（手动指定先手选择者需写回磁盘；会话内导入为 null） */
    fileId?: string | null
    /** 页内工具栏返回按钮回调（无则隐藏） */
    onBack?: (() => void) | null
  }
  let { group, fileId = null, onBack = null }: Props = $props()

  // build 是一次性构造的只读回放数据，用 $state.raw 避免深代理：
  // applyOp 会把 op 携带的卡/条目对象塞进克隆的 state，深代理下这些是 Svelte proxy，
  // 在 $derived 里再被 patch 操作写入会触发 state_unsafe_mutation。
  let build = $state.raw<ReplayBuild | null>(null)
  const metas = $state(new Map<string, ReplayCardMeta>())
  // 战场名元数据（key=英文名，如 "Shadow Temple"），供战场带渲染列名与最佳卡图
  const nameMetas = $state(new Map<string, ReplayCardMeta>())

  let current = $state(0)
  let playing = $state(false)
  let pace = $state(1)
  let ff = $state(false)
  let narrationOpen = $state(false)
  let gameIndex = $state(0)
  let timer: ReturnType<typeof setInterval> | null = null

  // 侧栏开关与全屏（剧场模式）
  let showLeft = $state(true)
  let showRight = $state(true)
  let isFullscreen = $state(false)

  // 阅读器：悬停预览，点击固定
  interface ReaderSel {
    card: Record<string, unknown> | null
    meta: ReplayCardMeta | null
    side: 'self' | 'opp' | null
    zone: string | null
  }
  let preview = $state<ReaderSel | null>(null)
  let pinned = $state<ReaderSel | null>(null)

  // 系列内选局（Schema v3）：games 按 gameNumber 升序；回放事件源在各局 telemetry
  const games = $derived(group.games ?? [])
  const game = $derived(games.length > 0 ? games[Math.min(gameIndex, games.length - 1)] : null)

  // build 依赖当前局重建（session 事件源在 game 级）
  $effect(() => {
    if (!game) {
      build = null
      return
    }
    build = buildReplay({
      roomCode: game.roomCode,
      sessions: game.telemetry?.sessions ?? [],
      selfId: group.perspective?.localPlayerId,
    })
    current = 0
  })

  $effect(() => {
    if (!build) return
    const codes = collectCardCodesFromStates(build.snapshots.map((s) => s.state))
    resolveCardMetas(codes).then((m) => {
      metas.clear()
      for (const [k, v] of m) metas.set(k, v)
    })
  })

  $effect(() => {
    if (!build) return
    const names = new Set<string>()
    for (const s of build.snapshots) {
      for (const pl of s.state.players ?? []) {
        const n = pl.selectedBattlefield
        if (typeof n === 'string' && n.trim()) names.add(n.trim())
      }
    }
    if (names.size === 0) {
      nameMetas.clear()
      return
    }
    resolveNameMetas([...names]).then((m) => {
      nameMetas.clear()
      for (const [k, v] of m) nameMetas.set(k, v)
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
      ? `${get(t)('replay.frame', { values: { current: safeCurrent + 1, total } })} · ${
          gameState?.phase ?? '-'
        } · ${get(t)('replay.turn', { values: { number: gameState?.turnNumber ?? '-' } })}`
      : ''
  )
  const frameSeq = $derived(build && total > 0 ? build.frames[safeCurrent].seq : null)
  const isEnd = $derived(total > 0 && safeCurrent >= total - 1)
  const marks = $derived(getReplayResultMarks())
  const resultKey = $derived(group.key)

  // 视角解耦：我方 = perspective.localPlayerId，对方 = 剩余玩家；观战无「我方」，按玩家池顺序铺两名玩家
  const players = $derived(group.players ?? {})
  const playerList = $derived(Object.values(players))
  const selfPlayer = $derived.by(() => {
    if (group.perspective?.isSpectator) return playerList[0] ?? null
    return group.perspective?.localPlayerId
      ? (players[group.perspective.localPlayerId] ?? null)
      : null
  })
  const oppPlayer = $derived.by(() => {
    if (group.perspective?.isSpectator) return playerList[1] ?? null
    for (const [pid, p] of Object.entries(players)) {
      if (pid !== (group.perspective?.localPlayerId ?? null)) return p
    }
    return null
  })
  const selfName = $derived(selfPlayer?.name ?? me?.name ?? me?.id ?? '?')
  const oppName = $derived(oppPlayer?.name ?? opp?.name ?? opp?.id ?? '?')

  // 关键帧书签：回合切换 / 阶段切换 / 得分变化（同帧多事件合并成一条），外加开局/终局锚点
  interface Bookmark {
    label: string
    frame: number
  }
  const bookmarks = $derived.by(() => {
    if (!build || total === 0) return []
    const g = get(t)
    const out: Bookmark[] = []
    const push = (label: string, frame: number) => {
      const f = Math.max(0, Math.min(frame, total - 1))
      if (!out.some((b) => b.frame === f)) out.push({ label, frame: f })
    }
    push(g('replay.jumpStart'), 0)

    const nameOf = (playerId?: string | null) => {
      if (!playerId) return ''
      if (me && playerId === me.id) return selfName
      if (opp && playerId === opp.id) return oppName
      return players[playerId]?.name ?? playerId
    }

    const byFrame = new Map<number, ReplayKeyframe[]>()
    for (const kf of collectKeyframes(build)) {
      const list = byFrame.get(kf.frame) ?? []
      list.push(kf)
      byFrame.set(kf.frame, list)
    }
    for (const [frame, kfs] of [...byFrame.entries()].sort((a, b) => a[0] - b[0])) {
      const parts: string[] = []
      for (const kf of kfs) {
        if (kf.kind === 'turn') {
          parts.push(g('replay.jumpTurn', { values: { n: kf.value } }))
        } else if (kf.kind === 'phase') {
          parts.push(g('replay.jumpPhase', { values: { p: kf.value } }))
        } else if (kf.kind === 'score') {
          parts.push(
            g('replay.jumpScore', { values: { delta: kf.delta ?? 0, name: nameOf(kf.playerId) } })
          )
        }
      }
      if (parts.length > 0) push(parts.join(' · '), frame)
    }

    push(g('replay.jumpEnd'), total - 1)
    out.sort((a, b) => a.frame - b.frame)
    return out.slice(0, 200)
  })

  function zoneLabel(zone: string | null | undefined): string {
    if (!zone) return ''
    const g = get(t)
    const map: Record<string, string> = {
      hand: g('replay.zoneHand'),
      deck: g('replay.zoneDeck'),
      runeDeck: g('replay.zoneRuneDeck'),
      runeArea: g('replay.runeArea'),
      champion: g('replay.champion'),
      legend: g('replay.legend'),
      base: g('replay.base'),
      trash: g('replay.trash'),
      banished: g('replay.banished'),
      battlefieldA: g('replay.battlefield', { values: { lane: 'A' } }),
      battlefieldB: g('replay.battlefield', { values: { lane: 'B' } }),
      battlefieldC: g('replay.battlefield', { values: { lane: 'C' } }),
      battlefieldToken: g('replay.battlefieldToken'),
      chain: g('replay.zoneChain'),
    }
    return map[zone] ?? zone
  }

  function metaOfChain(card: Record<string, unknown> | undefined | null): ReplayCardMeta | null {
    if (!card || typeof card.cardCode !== 'string') return null
    return metas.get(String(card.cardCode)) ?? null
  }

  // ==================== 播放控制 ====================

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
      Math.round(1200 / pace)
    )
  }
  function play() {
    if (playing) return
    playing = true
    if (current >= total - 1) current = 0
  }

  // 播放中切换节奏时重建 interval，否则仍按旧节奏走
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
  function setPace(v: number) {
    pace = v
    ff = false
  }
  function toggleFF() {
    ff = !ff
    if (ff) {
      pace = 4
      play()
    } else {
      pace = 1
    }
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

  // ==================== 系列内切局 ====================

  function prevGame() {
    if (gameIndex > 0) gameIndex--
  }
  function nextGame() {
    if (gameIndex < games.length - 1) gameIndex++
  }

  // ==================== 阅读器 ====================

  function hoverCard(
    card: Record<string, unknown>,
    meta: ReplayCardMeta | null,
    side: 'self' | 'opp' | null,
    zone: string
  ) {
    preview = { card, meta, side, zone }
  }
  function pickCard(
    card: Record<string, unknown>,
    meta: ReplayCardMeta | null,
    side: 'self' | 'opp' | null,
    zone: string
  ) {
    const sel: ReaderSel = { card, meta, side, zone }
    preview = sel
    pinned = sel
  }
  function clearPinned() {
    pinned = null
  }

  // ==================== 全屏 ====================

  async function toggleFullscreen() {
    if (isTauri) {
      try {
        const win = (await import('@tauri-apps/api/window')).getCurrentWindow()
        const cur = await win.isFullscreen()
        await win.setFullscreen(!cur)
        isFullscreen = !cur
      } catch {
        isFullscreen = false
      }
    } else {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen()
          isFullscreen = false
        } else {
          await document.documentElement.requestFullscreen()
          isFullscreen = true
        }
      } catch {
        isFullscreen = false
      }
    }
  }

  async function syncFullscreen() {
    if (isTauri) {
      try {
        const win = (await import('@tauri-apps/api/window')).getCurrentWindow()
        isFullscreen = await win.isFullscreen()
      } catch {
        return
      }
    } else {
      isFullscreen = document.fullscreenElement != null
    }
  }

  // ==================== 结果标记 ====================

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

  // 手动指定/清除先手选择者：内存即时生效 + 写回磁盘（fileId 为 null 时仅内存）
  async function setStarterChooser(playerId: string | null) {
    if (!game) return
    game.starterChooserPlayerId = playerId
    if (!fileId) {
      showToast(get(t)('replay.starterChooserNotPersisted'), 'info')
      return
    }
    const ok = await updateGameStarterChooser(fileId, group.key, game.gameNumber, playerId)
    if (ok) {
      showToast(get(t)('replay.starterChooserSaved'), 'success')
    } else {
      showToast(get(t)('replay.starterChooserSaveFailed'), 'error')
    }
  }

  onMount(() => {
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
      } else if (e.code === 'Escape') {
        // 系统全屏被 Esc 退出时同步按钮状态
        if (isFullscreen) void syncFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', syncFullscreen)
      if (timer) clearInterval(timer)
      if (isFullscreen) {
        if (isTauri) {
          import('@tauri-apps/api/window')
            .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(false))
            .catch(() => {})
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {})
        }
      }
    }
  })

  const durationMin = $derived(
    group.meta?.durationMs != null ? Math.max(1, Math.round(group.meta.durationMs / 60000)) : null
  )
  const boTotal = $derived.by(() => {
    const m = /bo(\d+)/i.exec(group.meta?.format ?? '')
    return m ? parseInt(m[1], 10) : 1
  })
  const reconnectCount = $derived(game?.telemetry?.reconnectCount ?? 0)
  const readerSel = $derived(pinned ?? preview)
</script>

{#if !build || total === 0}
  <div class="empty-box">
    {#if (game?.telemetry?.snapshotCount ?? 0) > 0}
      {$t('replay.viewerIncomplete')}
    {:else}
      {$t('replay.viewerEmpty')}
    {/if}
  </div>
{:else}
  <div class="viewer">
    <header class="toolbar">
      {#if onBack}
        <button
          class="tb-btn"
          onclick={onBack}
          aria-label={$t('common.back')}
          title={$t('common.back')}
        >
          <ChevronLeft size={18} />
        </button>
      {/if}
      <span class="tb-title" title={group.meta?.roomCode ?? undefined}
        >{group.meta?.roomCode ?? $t('replay.viewerTitle')}</span
      >
      <span class="tb-spacer"></span>
      <button
        class="tb-btn"
        class:active={showLeft}
        onclick={() => (showLeft = !showLeft)}
        aria-pressed={showLeft}
        title={$t('replay.toggleLeft')}
      >
        <PanelLeft size={18} />
      </button>
      <button
        class="tb-btn"
        class:active={showRight}
        onclick={() => (showRight = !showRight)}
        aria-pressed={showRight}
        title={$t('replay.toggleRight')}
      >
        <PanelRight size={18} />
      </button>
      <button
        class="tb-btn"
        class:active={isFullscreen}
        onclick={() => void toggleFullscreen()}
        aria-pressed={isFullscreen}
        title={$t(isFullscreen ? 'replay.exitFullscreen' : 'replay.enterFullscreen')}
      >
        {#if isFullscreen}<Minimize size={18} />{:else}<Maximize size={18} />{/if}
      </button>
    </header>

    <div class="main">
      <!-- 左栏：头部 + 卡牌阅读器 + 控制 -->
      <aside class="inspector" class:hidden={!showLeft}>
        <header class="insp-head">
          <div class="chips">
            <span class="badge bo">{$t('replay.groupBo', { values: { n: boTotal } })}</span>
            {#if group.meta?.format}
              <span class="badge queue"
                >{$t('replay.groupQueueFormat', { values: { format: group.meta.format } })}</span
              >
            {/if}
            {#if durationMin !== null}
              <span class="badge meta"
                >{$t('replay.groupDuration', { values: { minutes: durationMin } })}</span
              >
            {/if}
            <span class="badge meta">
              {$t('replay.groupSessions', {
                values: { n: game?.telemetry?.sessions.length ?? 1 },
              })}
              {#if reconnectCount > 0}
                · {$t('replay.groupReconnects', { values: { n: reconnectCount } })}
              {/if}
            </span>
            {#if group.perspective?.isSpectator}
              <span class="badge spectator">{$t('replay.spectatorView')}</span>
            {/if}
          </div>
          <div class="starter-row">
            <span class="starter-label">{$t('replay.starterChooserLabel')}:</span>
            {#if game?.starterChooserPlayerId}
              <span class="starter-name"
                >{players[game.starterChooserPlayerId]?.name ?? game.starterChooserPlayerId}</span
              >
              <button class="starter-btn" onclick={() => setStarterChooser(null)}
                >{$t('common.clear')}</button
              >
            {:else}
              <span class="starter-unknown">{$t('replay.starterChooserUnknown')}</span>
              {#if selfPlayer && oppPlayer}
                <button class="starter-btn" onclick={() => setStarterChooser(selfPlayer.id)}
                  >{selfPlayer.name ?? selfName}</button
                >
                <button class="starter-btn" onclick={() => setStarterChooser(oppPlayer.id)}
                  >{oppPlayer.name ?? oppName}</button
                >
              {/if}
            {/if}
          </div>
          {#if games.length > 1}
            <div class="game-tabs">
              <button class="gtab mini" onclick={prevGame} title={$t('replay.prevGame')}>
                <ChevronLeft size={12} />
              </button>
              {#each games as g, i (g.gameNumber)}
                <button
                  class="gtab"
                  class:active={i === gameIndex}
                  title={`${$t('replay.gameTab', { values: { n: g.gameNumber } })}${g.winnerId ? ' · ' + $t('replay.gameWin', { values: { name: players[g.winnerId]?.name ?? g.winnerId } }) : ''}`}
                  onclick={() => {
                    gameIndex = i
                  }}
                >
                  {g.gameNumber}
                  {#if g.winnerId}<span class="gwin">胜</span>{/if}
                </button>
              {/each}
              <button class="gtab mini" onclick={nextGame} title={$t('replay.nextGame')}>
                <ChevronRight size={12} />
              </button>
            </div>
          {/if}
        </header>

        <div class="reader-wrap">
          <ReplayCardReader
            card={readerSel?.card ?? null}
            meta={readerSel?.meta ?? null}
            side={readerSel?.side ?? null}
            zone={zoneLabel(readerSel?.zone ?? null)}
            onClose={clearPinned}
          />
        </div>

        <footer class="transport">
          <div class="t-row">
            <button class="tbtn" title="Home" onclick={() => jump(false)}
              ><SkipBack size={13} /></button
            >
            <button class="tbtn" onclick={() => step(-1)}><ChevronLeft size={13} /></button>
            <button class="tbtn play" onclick={togglePlay}>
              {#if playing}<Pause size={13} />{:else}<Play size={13} />{/if}
              {$t(playing ? 'replay.pause' : 'replay.play')}
            </button>
            <button class="tbtn" onclick={() => step(1)}><ChevronRight size={13} /></button>
            <button class="tbtn" title="End" onclick={() => jump(true)}
              ><SkipForward size={13} /></button
            >
            <button
              class="tbtn {ff ? 'on' : ''}"
              onclick={toggleFF}
              title={$t('replay.ff')}
              aria-pressed={ff}
            >
              <span class="rot-180"><SkipForward size={13} /></span>
            </button>
          </div>
          <div class="t-row">
            <label class="pace">
              <span
                >{$t('replay.pace')}
                {pace}×{pace === 1 ? ` (${$t('replay.paceRecorded')})` : ''}</span
              >
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.25"
                value={pace}
                oninput={(e) => setPace(Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
          </div>
          <div class="t-row">
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
            <span class="tframe" title={frameSeq != null ? `seq ${frameSeq}` : ''}
              >{frameLabel}</span
            >
            <button
              class="tbtn {narrationOpen ? 'on' : ''}"
              onclick={() => (narrationOpen = !narrationOpen)}
              title={$t('replay.logToggle')}
              aria-pressed={narrationOpen}
            >
              <ScrollText size={13} />
            </button>
          </div>
        </footer>
      </aside>

      <!-- 中央：对局棋盘（对手在上镜像，双方卡牌正立） -->
      <main class="board-col">
        <div class="board-opp">
          <ReplayBoard
            player={opp}
            side="opp"
            activeTurn={activeTurnPlayerId === opp?.id}
            {metas}
            onHover={hoverCard}
            onPick={pickCard}
          />
        </div>
        <div class="bf-band">
          <ReplayBattlefield
            {me}
            {opp}
            {metas}
            {nameMetas}
            turnNumber={gameState?.turnNumber}
            phase={gameState?.phase}
            {activeTurnPlayerId}
            onHover={hoverCard}
            onPick={pickCard}
          />
        </div>
        <div class="board-self">
          <ReplayBoard
            player={me}
            side="self"
            activeTurn={activeTurnPlayerId === me?.id}
            {metas}
            onHover={hoverCard}
            onPick={pickCard}
          />
        </div>

        {#if narrationOpen}
          <div class="narration-overlay">
            <ReplayNarration
              entries={build.narration}
              current={safeCurrent}
              collapsed={false}
              onToggle={() => (narrationOpen = false)}
            />
          </div>
        {/if}
      </main>

      <!-- 右栏：阶段书签 + 连锁 -->
      <aside class="side-col" class:hidden={!showRight}>
        <div class="jump-panel">
          <div class="panel-title">
            <span>{$t('replay.jumpTitle')}</span>
            <span class="count">{bookmarks.length}</span>
          </div>
          <div class="jump-list">
            {#each bookmarks as b (b.frame)}
              <button
                class="jump-item"
                class:active={b.frame === safeCurrent}
                onclick={() => (current = b.frame)}
              >
                <span class="jf">{b.frame + 1}</span>
                <span class="jl">{b.label}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="chain-panel {chainEntries.length === 0 ? 'empty' : ''}">
          <span class="chain-label"
            >{$t('replay.chain', { values: { count: chainEntries.length } })}</span
          >
          {#if chainEntries.length === 0}
            <span class="chain-empty">{$t('replay.chainEmpty')}</span>
          {:else}
            <div class="chain-cards">
              {#each chainEntries as en (en.id)}
                {@const c = en.card as Record<string, unknown> | undefined}
                <button
                  type="button"
                  class="slot"
                  onmouseenter={() => c && hoverCard(c, metaOfChain(c), null, 'chain')}
                  onclick={() => c && pickCard(c, metaOfChain(c), null, 'chain')}
                >
                  <ReplayCard
                    card={c}
                    meta={c && typeof c.cardCode === 'string'
                      ? (metas.get(String(c.cardCode)) ?? null)
                      : null}
                    width={44}
                    showType={false}
                  />
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </aside>
    </div>

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
    height: 100%;
    min-height: 0;
  }
  .empty-box {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
  }

  /* ============ 页内工具栏 ============ */
  .toolbar {
    flex: none;
    height: calc(48px + env(safe-area-inset-top));
    min-height: calc(48px + env(safe-area-inset-top));
    display: flex;
    align-items: center;
    gap: 6px;
    padding: env(safe-area-inset-top) 12px 0;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-primary);
    z-index: 30;
  }

  .tb-btn {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .tb-btn:hover {
    background: var(--bg-hover);
  }
  .tb-btn.active {
    background: color-mix(in srgb, var(--accent-color) 16%, transparent);
    color: var(--accent-color);
  }

  .tb-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .tb-spacer {
    flex: 1;
  }

  @media (max-width: 767.99px) {
    .tb-title {
      max-width: 140px;
    }
  }

  /* ============ 主区三栏 ============ */
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 10px;
  }
  .inspector {
    width: 360px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    padding: 10px;
  }
  .inspector.hidden,
  .side-col.hidden {
    display: none;
  }
  .insp-head {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    border-radius: 8px;
    padding: 1px 8px;
    white-space: nowrap;
  }
  .badge.bo {
    background: var(--accent-color);
    color: #fff;
  }
  .badge.queue,
  .badge.meta {
    background: var(--surface-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .badge.spectator {
    background: #f5eefb;
    color: #7c3aed;
    border: 1px solid #ddd0f5;
  }
  .starter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .starter-label {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .starter-name {
    color: var(--text-primary);
    font-weight: 700;
  }
  .starter-unknown {
    color: var(--text-tertiary);
  }
  .starter-btn {
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 1px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .starter-btn:hover {
    background: var(--bg-hover);
  }
  .game-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .gtab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    min-width: 26px;
    justify-content: center;
  }
  .gtab:hover {
    background: var(--bg-hover);
  }
  .gtab.active {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
  }
  .gtab.mini {
    padding: 2px 4px;
  }
  .gwin {
    font-size: 10px;
    font-weight: 500;
    opacity: 0.85;
  }
  .reader-wrap {
    flex: 1;
    min-height: 0;
  }

  /* ============ 控制 ============ */
  .transport {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 8px;
  }
  .t-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
  }
  .tbtn:hover {
    background: var(--bg-hover);
  }
  .tbtn.on {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
  }
  .rot-180 {
    display: inline-flex;
    transform: rotate(180deg);
  }
  .tbtn.play {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
    min-width: 76px;
    justify-content: center;
  }
  .tbtn.selected {
    outline: 2px solid var(--accent-color);
  }
  .pace {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .pace input {
    flex: 1;
    min-width: 60px;
    accent-color: var(--accent-color);
  }
  .tscrub {
    flex: 1;
    min-width: 80px;
    accent-color: var(--accent-color);
  }
  .tframe {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* ============ 中央棋盘 ============ */
  .board-col {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: relative;
  }
  .board-opp,
  .board-self {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
  }
  .board-opp :global(.board),
  .board-self :global(.board) {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  .bf-band {
    flex: 0 1 auto;
    min-height: 0;
    max-height: 44%;
    overflow: auto;
  }

  /* ============ 右栏 ============ */
  .side-col {
    width: 300px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .jump-panel {
    flex: 1 1 45%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    padding: 8px;
  }
  .panel-title {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .panel-title .count {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .jump-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .jump-item {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 12px;
    padding: 3px 6px;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
  }
  .jump-item:hover {
    background: var(--bg-hover);
  }
  .jump-item.active {
    background: var(--accent-color);
    color: #fff;
  }
  .jf {
    flex: none;
    width: 30px;
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .jump-item.active .jf {
    color: rgba(255, 255, 255, 0.75);
  }
  .jl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chain-panel {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    padding: 8px;
    overflow-y: auto;
  }
  .chain-label {
    flex: none;
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 700;
  }
  .chain-empty {
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .chain-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chain-panel .slot {
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    display: block;
  }
  .chain-panel .slot:hover {
    outline: 2px solid var(--accent-color);
    outline-offset: 1px;
    z-index: 3;
  }

  /* ============ 叙述浮层 ============ */
  .narration-overlay {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(380px, 46%);
    z-index: 40;
    display: flex;
    flex-direction: column;
    background: rgba(8, 14, 24, 0.97);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .narration-overlay :global(.narration) {
    max-height: none;
    background: transparent;
    border: none;
    flex: 1;
    min-height: 0;
  }

  /* ============ 终局浮层 ============ */
  .end-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
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
    font-size: var(--text-md);
    color: var(--text-primary);
  }
  .end-box p {
    margin: 0 0 14px;
    font-size: var(--text-base);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .end-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
</style>
