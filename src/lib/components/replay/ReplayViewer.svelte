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
  import ReplayBoard from './ReplayBoard.svelte'
  import ReplayArrowOverlay from './ReplayArrowOverlay.svelte'
  import ReplayCard from './ReplayCard.svelte'
  import ReplayCardTooltip from './ReplayCardTooltip.svelte'
  import ReplayNarration from './ReplayNarration.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import {
    ChevronLeft,
    ChevronRight,
    Maximize,
    Minimize,
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

  // 右栏（书签）开关与全屏（剧场模式）
  let showRight = $state(false)
  let isFullscreen = $state(false)

  // 悬停提示（跟随指针的小浮层）：只展示卡图 + 卡牌效果（中文）。不指着卡牌时不显示。
  interface ReaderSel {
    card: Record<string, unknown> | null
    meta: ReplayCardMeta | null
    side: 'self' | 'opp' | null
    zone: string | null
  }
  let preview = $state<ReaderSel | null>(null)
  // 需按住 Alt 才显示提示：松开即隐藏
  let altHeld = $state(false)
  // 指针在画布内的设计坐标（1280×720），用于把提示锚定在指针旁
  let pointer = $state({ x: 0, y: 0 })
  let canvasEl = $state<HTMLElement | null>(null)
  const TOOLTIP_W = 340
  const TOOLTIP_H = 320

  // 战场行 / 连锁区独立缩放：按战场带实际高度（设计基准 300px）缩放卡牌尺寸
  let bfRowEl = $state<HTMLElement | null>(null)
  let bfK = $state(1)
  $effect(() => {
    const el = bfRowEl
    if (!el) return
    const update = () => {
      const h = el.clientHeight || 0
      bfK = Math.max(0.5, Math.min(2.4, h / 300))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  })
  const bfCardW = $derived(Math.round(64 * bfK)) // 战场槽主卡
  const bfExtraW = $derived(Math.round(48 * bfK)) // 战场附加槽卡
  const chainBigW = $derived(Math.round(70 * bfK)) // 连锁最新一张
  const chainMiniW = $derived(Math.round(34 * bfK)) // 连锁其余小图

  // 系列内选局（Schema v3）：games 按 gameNumber 升序；回放事件源在各局 telemetry
  const games = $derived(group.games ?? [])
  const game = $derived(games.length > 0 ? games[Math.min(gameIndex, games.length - 1)] : null)
  // 该局先手方（实际先手 firstPlayerId 优先，缺失回退先手选择者）
  const gameFirstId = $derived(game?.firstPlayerId ?? game?.starterChooserPlayerId ?? null)

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
    console.log(gameState)
    console.log(opp)
    console.log(me)
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

  // ==================== 悬停提示（跟随指针，不点击固定） ====================

  // 指针移动时记录棋盘容器内像素坐标（提示锚定用，直接量容器相对位置）
  function updatePointer(e: PointerEvent) {
    const canvas = canvasEl
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    if (r.width === 0) return
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // 离开任何卡牌区域（指针落在非卡牌元素上）即隐藏提示
  function onCanvasPointerOver(e: PointerEvent) {
    const t = e.target as Element | null
    if (!t || typeof t.closest !== 'function' || !t.closest('[data-card-id]')) preview = null
  }

  // 牌背（占位/无卡/back/hidden）不显示悬停提示
  function isBackCard(card: Record<string, unknown> | null | undefined): boolean {
    return !card || card.isPlaceholder === true  && card.hidden === true
  }

  function hoverCard(
    card: Record<string, unknown>,
    meta: ReplayCardMeta | null,
    side: 'self' | 'opp' | null,
    zone: string
  ) {
    if (isBackCard(card)) return
    preview = { card, meta, side, zone }
  }
  // 点击与悬停一致：仅显示提示，不做固定；牌背卡同样不显示
  function pickCard(
    card: Record<string, unknown>,
    meta: ReplayCardMeta | null,
    side: 'self' | 'opp' | null,
    zone: string
  ) {
    if (isBackCard(card)) return
    preview = { card, meta, side, zone }
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

  // 手动指定/清除先手：内存即时生效 + 写回磁盘（fileId 为 null 时仅内存）。
  // 同时写 firstPlayerId（实际先手）与 starterChooserPlayerId（先手选择者），保证手动值覆盖解析值
  async function setStarterChooser(playerId: string | null) {
    if (!game) return
    game.firstPlayerId = playerId
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
      // Alt（或 Option）按住时才允许显示悬停提示
      altHeld = e.altKey
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
    const onKeyUp = (e: KeyboardEvent) => {
      // 松开 Alt（或 Option）立即隐藏提示；按 key 判断比 e.altKey 可靠
      if (e.key === 'Alt') altHeld = false
      else altHeld = e.altKey
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
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
  const readerSel = $derived(altHeld ? preview : null)

  // 提示锚定在指针旁（棋盘容器像素），越界时翻转到另一侧并夹取在容器内
  const tooltipStyle = $derived.by(() => {
    if (!preview) return ''
    const W = canvasEl?.clientWidth ?? TOOLTIP_W
    const H = canvasEl?.clientHeight ?? TOOLTIP_H
    const off = 16
    let left = pointer.x + off
    if (left + TOOLTIP_W > W) left = pointer.x - off - TOOLTIP_W
    let top = pointer.y + off
    if (top + TOOLTIP_H > H) top = pointer.y - off - TOOLTIP_H
    left = Math.max(4, Math.min(W - TOOLTIP_W - 4, left))
    top = Math.max(4, Math.min(H - 40, top))
    return `left: ${left}px; top: ${top}px;`
  })

  // 战场卡背景元数据（selectedBattlefield 英文名 → 本地库卡图）
  function bfMetaOf(
    p: { selectedBattlefield?: string | null } | null | undefined
  ): ReplayCardMeta | null {
    const n = p?.selectedBattlefield
    if (typeof n !== 'string' || !n.trim()) return null
    return nameMetas.get(n.trim()) ?? null
  }
  const oppBf = $derived(bfMetaOf(opp))
  const meBf = $derived(bfMetaOf(me))

  // 顶部信息面板（与工具栏同行）：比分 / 能量 / 法力 / 传奇经验
  function playerNums(p: { board?: Record<string, unknown> } | null | undefined) {
    const b = p?.board ?? {}
    return {
      score: typeof b.score === 'number' ? Number(b.score) : null,
      energy: typeof b.floatingEnergy === 'number' ? Number(b.floatingEnergy) : 0,
      power: typeof b.floatingPower === 'number' ? Number(b.floatingPower) : 0,
      legendXp: typeof b.legendXp === 'number' ? Number(b.legendXp) : 0,
    }
  }
  const oppNums = $derived(playerNums(opp))
  const meNums = $derived(playerNums(me))

  // 战场行（共用一行，不镜像）：战场1 = battlefieldA、战场2 = battlefieldB；C/token 有卡时附加小槽
  function bfCardsOf(
    p: { board?: Record<string, unknown> } | null | undefined,
    zone: string
  ): Record<string, unknown>[] {
    const z = p?.board?.[zone]
    return Array.isArray(z) ? (z as Record<string, unknown>[]) : []
  }
  function metaOfCard(card: Record<string, unknown> | null | undefined): ReplayCardMeta | null {
    if (!card) return null
    const code = typeof card.cardCode === 'string' ? card.cardCode : ''
    return code ? (metas.get(code) ?? null) : null
  }
  const extraBfCards = $derived([
    ...bfCardsOf(opp, 'battlefieldC'),
    ...bfCardsOf(me, 'battlefieldC'),
    ...bfCardsOf(opp, 'battlefieldToken'),
    ...bfCardsOf(me, 'battlefieldToken'),
  ])
  const hasExtraBf = $derived(extraBfCards.length > 0)

  // ==================== 连锁区（画布右沟）与目标箭头层 ====================
  // 连锁最新一张大图 + 其余小图堆叠；箭头数据来自 state.targetArrowsByPlayer
  // （服务端 set_room_fields 整组覆盖，引擎 Object.assign 已落到状态根）
  const chainNewest = $derived(
    chainEntries.length > 0
      ? ((chainEntries[chainEntries.length - 1]?.card ?? null) as Record<string, unknown> | null)
      : null
  )
  const chainOlder = $derived(
    chainEntries
      .slice(0, -1)
      .reverse()
      .map((en) => en.card as Record<string, unknown> | undefined)
  )
  interface FlatArrow {
    ownerId: string
    sourceCardId: string
    targetCardId: string
    sourceAnchor: string
    targetAnchor: string
  }
  const roomArrows = $derived.by(() => {
    const raw = gameState?.targetArrowsByPlayer
    if (!raw || typeof raw !== 'object') return [] as FlatArrow[]
    const out: FlatArrow[] = []
    for (const [pid, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      for (const a of list) {
        const o = a as Record<string, unknown>
        if (typeof o.sourceCardId !== 'string' || typeof o.targetCardId !== 'string') continue
        out.push({
          ownerId: pid,
          sourceCardId: o.sourceCardId,
          targetCardId: o.targetCardId,
          sourceAnchor: typeof o.sourceAnchor === 'string' ? o.sourceAnchor : '',
          targetAnchor: typeof o.targetAnchor === 'string' ? o.targetAnchor : '',
        })
      }
    }
    return out
  })
  const highlightCardId = $derived.by(() => {
    const id = readerSel?.card?.id
    return typeof id === 'string' ? id : null
  })

  // ==================== 竖屏判定（保留拦截，Step 6 再做自适应） ====================
  let portrait = $state(false)
  function measureViewport() {
    portrait = window.innerWidth < window.innerHeight
  }
  $effect(() => {
    measureViewport()
    window.addEventListener('resize', measureViewport)
    window.addEventListener('orientationchange', measureViewport)
    return () => {
      window.removeEventListener('resize', measureViewport)
      window.removeEventListener('orientationchange', measureViewport)
    }
  })
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
    <!-- 流体画布：填满窗口，三个 band 纵排；竖屏时战场行改为上下叠放 -->
    <div
      class="board"
      class:portrait={portrait}
      bind:this={canvasEl}
      role="presentation"
      onpointermove={updatePointer}
      onpointerover={onCanvasPointerOver}
      onpointerleave={() => (preview = null)}
    >
      <div class="board-half-opp">
          <ReplayBoard
            player={opp}
            side="opp"
            activeTurn={activeTurnPlayerId === opp?.id}
            {metas}
            onHover={hoverCard}
            onPick={pickCard}
          />
        </div>

        <!-- 战场行（共用一行，不镜像）：战场1/战场2 各按 1039:744 等比展示完整战场卡图（卡图作背景，无图用 static/black.jpg） -->
        <div class="bf-row" bind:this={bfRowEl} style="--bfK: {bfK}">
          <div class="bf-slot">
            <div class="bf-bg">
              {#if oppBf?.imgCdn}
                <CardSimpleImage
                  url={oppBf.imgCdn}
                  name={oppBf.cacheName}
                  className="bf-bg-img"
                  isLandscape
                />
              {/if}
            </div>
            <div class="bf-side">
              {#each bfCardsOf(opp, 'battlefieldA') as c (c.id)}
                <button
                  type="button"
                  class="slot"
                  data-card-id={String(c.id)}
                  onmouseenter={() => hoverCard(c, metaOfCard(c), 'opp', 'battlefieldA')}
                  onclick={() => pickCard(c, metaOfCard(c), 'opp', 'battlefieldA')}
                >
                  <ReplayCard card={c} meta={metaOfCard(c)} width={bfCardW} />
                </button>
              {/each}
            </div>
            <div class="bf-side">
              {#each bfCardsOf(me, 'battlefieldA') as c (c.id)}
                <button
                  type="button"
                  class="slot"
                  data-card-id={String(c.id)}
                  onmouseenter={() => hoverCard(c, metaOfCard(c), 'self', 'battlefieldA')}
                  onclick={() => pickCard(c, metaOfCard(c), 'self', 'battlefieldA')}
                >
                  <ReplayCard card={c} meta={metaOfCard(c)} width={bfCardW} />
                </button>
              {/each}
            </div>
          </div>
          <div class="bf-slot">
            <div class="bf-bg">
              {#if meBf?.imgCdn}
                <CardSimpleImage
                  url={meBf.imgCdn}
                  isLandscape
                  name={meBf.cacheName}
                  className="bf-bg-img"
                />
              {/if}
            </div>
            <div class="bf-side">
              {#each bfCardsOf(opp, 'battlefieldB') as c (c.id)}
                <button
                  type="button"
                  class="slot"
                  data-card-id={String(c.id)}
                  onmouseenter={() => hoverCard(c, metaOfCard(c), 'opp', 'battlefieldB')}
                  onclick={() => pickCard(c, metaOfCard(c), 'opp', 'battlefieldB')}
                >
                  <ReplayCard card={c} meta={metaOfCard(c)} width={bfCardW} />
                </button>
              {/each}
            </div>
            <div class="bf-side">
              {#each bfCardsOf(me, 'battlefieldB') as c (c.id)}
                <button
                  type="button"
                  class="slot"
                  data-card-id={String(c.id)}
                  onmouseenter={() => hoverCard(c, metaOfCard(c), 'self', 'battlefieldB')}
                  onclick={() => pickCard(c, metaOfCard(c), 'self', 'battlefieldB')}
                >
                  <ReplayCard card={c} meta={metaOfCard(c)} width={bfCardW} />
                </button>
              {/each}
            </div>
          </div>
          {#if hasExtraBf}
            <div class="bf-slot extra">
              <div class="bf-side">
                {#each extraBfCards as c (c.id)}
                  <button
                    type="button"
                    class="slot"
                    data-card-id={String(c.id)}
                    onmouseenter={() => hoverCard(c, metaOfCard(c), null, 'battlefieldC')}
                    onclick={() => pickCard(c, metaOfCard(c), null, 'battlefieldC')}
                  >
                    <ReplayCard card={c} meta={metaOfCard(c)} width={bfExtraW} />
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          <!-- 连锁区（战场行内）：最新一张大图，其余小图堆叠 -->
          {#if chainNewest}
            <div class="chain-col">
              <span class="cc-label">{$t('replay.zoneChain')} · {chainEntries.length}</span>
              <button
                type="button"
                class="slot cc-big"
                data-card-id={String(chainNewest.id)}
                onmouseenter={() =>
                  chainNewest && hoverCard(chainNewest, metaOfChain(chainNewest), null, 'chain')}
                onclick={() =>
                  chainNewest && pickCard(chainNewest, metaOfChain(chainNewest), null, 'chain')}
              >
                <ReplayCard
                  card={chainNewest}
                  meta={metaOfChain(chainNewest)}
                  width={chainBigW}
                  showType={false}
                  forceFace={true}
                />
              </button>
              {#if chainOlder.length > 0}
                <div class="cc-minis">
                  {#each chainOlder as c, i (String(c?.id ?? i))}
                    {#if c}
                      <button
                        type="button"
                        class="slot cc-mini"
                        data-card-id={String(c.id)}
                        onmouseenter={() => c && hoverCard(c, metaOfChain(c), null, 'chain')}
                        onclick={() => c && pickCard(c, metaOfChain(c), null, 'chain')}
                      >
                        <ReplayCard card={c} meta={metaOfChain(c)} width={chainMiniW} showType={false} forceFace={true} />
                      </button>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="board-half-self">
          <ReplayBoard
            player={me}
            side="self"
            activeTurn={activeTurnPlayerId === me?.id}
            {metas}
            onHover={hoverCard}
            onPick={pickCard}
          />
        </div>

        <!-- 目标箭头层：SVG 覆盖画布，pointer-events:none，按容器像素定位 -->
        <ReplayArrowOverlay
          arrows={roomArrows}
          frame={safeCurrent}
          {highlightCardId}
          selfOwnerId={me?.id ?? null}
        />

        <!-- 悬停提示（跟随指针）：只展示卡图 + 卡牌效果（中文），不指着卡牌时不显示 -->
        {#if readerSel}
          <div class="card-tip" style={tooltipStyle}>
            <ReplayCardTooltip card={readerSel?.card ?? null} meta={readerSel?.meta ?? null} />
          </div>
        {/if}
    </div>

    <!-- 视口层顶部一行（不随画布缩放）：敌方信息 + 工具栏 + 我方信息 同行 -->
    <div class="top-row">
      <aside class="top-info">
        <span class="ip-name">{oppName}</span>
        {#if activeTurnPlayerId === opp?.id}
          <span class="turn-badge">{$t('replay.activeTurn')}</span>
        {/if}
        <span class="ip-score-block">
          <i>{$t('replay.score')}</i>
          <b>{oppNums.score ?? '-'}</b>
        </span>
        <span class="ip-pill"><i>{$t('replay.energy')}</i><b class="g">{oppNums.energy}</b></span>
        <span class="ip-pill"><i>{$t('replay.power')}</i><b class="o">{oppNums.power}</b></span>
        <span class="ip-pill"><i>{$t('replay.legendXp')}</i><b>{oppNums.legendXp}</b></span>
      </aside>
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
      <aside class="top-info">
        <span class="ip-name">{selfName}</span>
        {#if activeTurnPlayerId === me?.id}
          <span class="turn-badge">{$t('replay.activeTurn')}</span>
        {/if}
        <span class="ip-score-block">
          <i>{$t('replay.score')}</i>
          <b>{meNums.score ?? '-'}</b>
        </span>
        <span class="ip-pill"><i>{$t('replay.energy')}</i><b class="g">{meNums.energy}</b></span>
        <span class="ip-pill"><i>{$t('replay.power')}</i><b class="o">{meNums.power}</b></span>
        <span class="ip-pill"><i>{$t('replay.legendXp')}</i><b>{meNums.legendXp}</b></span>
      </aside>
    </div>

    <!-- 底栏（视口层，不随画布缩放）：对局信息 + 播放控制 + 连锁 -->
    <footer class="bp-bar">
      <div class="bp-meta">
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
          <span class="starter-label">{$t('replay.starterLabel')}</span>
          {#if gameFirstId}
            <span class="starter-name">{players[gameFirstId]?.name ?? gameFirstId}</span>
          {:else}
            <span class="starter-unknown">{$t('replay.starterChooserUnknown')}</span>
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
      </div>

      <div class="transport">
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
          <span class="tframe" title={frameSeq != null ? `seq ${frameSeq}` : ''}>{frameLabel}</span>
          <button
            class="tbtn {narrationOpen ? 'on' : ''}"
            onclick={() => (narrationOpen = !narrationOpen)}
            title={$t('replay.logToggle')}
            aria-pressed={narrationOpen}
          >
            <ScrollText size={13} />
          </button>
        </div>
      </div>
    </footer>

    {#if showRight}
      <aside class="side-col">
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
      </aside>
    {/if}

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
    position: fixed;
    inset: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .empty-box {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
  }

  /* ============ 竖屏自适应：战场行上下叠放、半区压缩 ============ */
  .board.portrait .bf-row {
    flex-direction: column;
  }
  .board.portrait .board-half-opp {
    flex: 0 0 18%;
  }
  .board.portrait .board-half-self {
    flex: 0 0 18%;
  }
  .board.portrait .bf-slot {
    height: auto;
    width: min(96cqw, calc((100cqh - 8px) / 2 * 1039 / 744));
    aspect-ratio: 1039 / 744;
  }
  .board.portrait .bf-slot.extra {
    height: auto;
    width: calc(90px * var(--bfK, 1));
    aspect-ratio: auto;
  }
  /* 竖屏窄：连锁区隐藏，避免遮挡战场 */
  .board.portrait .chain-col {
    display: none;
  }

  /* ============ 流体画布：填满窗口，三 band 纵排（横屏先按比例） ============ */
  .board {
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 52px 12px 96px 12px;
    border-radius: 16px;
    overflow: hidden;
    /* 主题自适应的棋盘底色：深浅主题均可用 */
    background:
      radial-gradient(
        900px 500px at 50% 42%,
        color-mix(in srgb, var(--accent-color) 9%, transparent),
        transparent 65%
      ),
      linear-gradient(180deg, var(--bg-secondary), var(--bg-primary));
  }

  /* T1 区域：敌方半区 / 共用战场行 / 我方半区（流体 flex 纵排）
     战场行作画面核心约占 44%，上下半区各 ~28% */
  .board-half-opp {
    flex: 0 0 28%;
    min-height: 0;
  }
  .bf-row {
    flex: 1 1 44%;
    min-height: 0;
    position: relative;
    container-type: size;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  /* 两格各按 1039:744；高度取 min(带高, 宽度限制) 使其同时适配宽、高并居中 */
  .bf-slot {
    position: relative;
    flex: none;
    height: min(96cqh, calc((100cqw - 8px) / 2 * 744 / 1039));
    aspect-ratio: 1039 / 744;
    min-width: 0;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: #000;
  }
  .bf-slot.extra {
    flex: none;
    width: calc(90px * var(--bfK, 1));
    height: min(96cqh, calc((100cqw - 8px) / 2 * 744 / 1039));
    aspect-ratio: auto;
  }
  .bf-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: url('/black.jpg') center / cover no-repeat #000;
  }
  .bf-bg :global(.bf-bg-img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  /* 背景暗化：保证卡牌可读性 */
  .bf-bg::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
  }
  .bf-side {
    position: relative;
    height: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 0 4px;
    overflow: hidden;
  }
  .bf-side + .bf-side {
    border-top: 1px dashed rgba(255, 255, 255, 0.22);
  }
  .bf-row .slot {
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    display: block;
    flex: none;
  }
  .board-half-self {
    flex: 0 0 28%;
    min-height: 0;
  }

  /* 连锁区（战场行右缘浮层，不占战场布局宽度）：最新一张大图 + 其余小图堆叠 */
  .chain-col {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    width: 100px;
    height: 90%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: 12px;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    backdrop-filter: blur(6px);
    min-width: 0;
  }
  .cc-label {
    flex: none;
    font-size: 9px;
    font-weight: 600;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .chain-col .slot {
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    display: block;
    flex: none;
  }
  .cc-big {
    z-index: 2;
  }
  .cc-minis {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
  }
  .cc-mini {
    margin-top: -34px;
  }
  .cc-mini:first-child {
    margin-top: 0;
  }
  .bp-bar {
    position: fixed;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    z-index: 60;
    width: min(940px, 94vw);
    max-height: 46vh;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 14px;
    border-radius: 16px;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(14px);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.3);
    min-width: 0;
  }

  /* ============ 顶部一行（视口层，不随画布缩放）：敌方信息 + 工具栏 + 我方信息 ============ */
  .top-row {
    position: fixed;
    top: 8px;
    left: 10px;
    right: 10px;
    z-index: 70;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .top-info {
    flex: 1 1 0;
    min-width: 0;
    max-width: 300px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    padding: 0 10px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--surface) 66%, transparent);
    backdrop-filter: blur(8px);
    overflow: hidden;
  }
  .top-info:last-child {
    justify-content: flex-end;
  }
  .ip-name {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-primary);
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: none;
  }
  .turn-badge {
    flex: none;
    font-size: 9px;
    font-weight: 600;
    color: #fff;
    background: var(--accent-color);
    padding: 1px 5px;
    border-radius: 999px;
  }
  .ip-score-block {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    flex: none;
  }
  .ip-score-block i {
    font-style: normal;
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .ip-score-block b {
    font-size: 15px;
    font-weight: 800;
    line-height: 1;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .ip-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    flex: none;
  }
  .ip-pill i {
    font-style: normal;
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .ip-pill b {
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .ip-pill b.g {
    color: #128378;
  }
  .ip-pill b.o {
    color: #d9730d;
  }
  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid var(--border-color);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  }
  .tb-btn {
    width: 30px;
    height: 30px;
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
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .tb-spacer {
    flex: 1;
    min-width: 4px;
  }

  /* 较窄窗口：信息面板只保留名字+比分（隐藏能量/法力/传奇经验 pill），避免溢出 */
  @media (max-width: 1180px) {
    .top-info .ip-pill {
      display: none;
    }
  }

  @media (max-width: 767.99px) {
    .tb-title {
      max-width: 100px;
    }
    /* 窄屏：信息面板只保留名字 + 比分，避免与工具栏挤占 */
    .top-info {
      max-width: 26vw;
      gap: 6px;
      padding: 0 8px;
    }
    .top-info .ip-pill {
      display: none;
    }
    /* 窄屏：底栏只保留播放控制（隐藏对局信息行），减少遮挡 */
    .bp-bar {
      padding: 6px 10px;
      border-radius: 12px;
    }
    .bp-bar .bp-meta {
      display: none;
    }
  }

  /* ============ 底栏：对局信息徽章 ============ */
  .bp-meta {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    min-width: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .badge {
    font-size: 10px;
    font-weight: 600;
    border-radius: 8px;
    padding: 0 7px;
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
    gap: 5px;
    font-size: 11px;
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
  .game-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    align-items: center;
  }
  .gtab {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 1px 7px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    min-width: 24px;
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
    padding: 1px 3px;
  }
  .gwin {
    font-size: 9px;
    font-weight: 500;
    opacity: 0.85;
  }

  /* ============ 底栏：播放控制 ============ */
  .transport {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .t-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .tbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 3px 8px;
    cursor: pointer;
    font-size: 11px;
    flex: none;
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
    min-width: 64px;
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
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .pace input {
    flex: 1;
    min-width: 40px;
    max-width: 90px;
    accent-color: var(--accent-color);
  }
  .tscrub {
    flex: 3;
    min-width: 60px;
    accent-color: var(--accent-color);
  }
  .tframe {
    flex: none;
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* ============ 悬停提示（画布内，随缩放；锚定在指针旁） ============ */
  .card-tip {
    position: absolute;
    z-index: 30;
    width: max-content;
    pointer-events: none;
  }

  /* ============ 右栏浮层：书签（默认收起） ============ */
  .side-col {
    position: fixed;
    top: 56px;
    right: 10px;
    bottom: 10px;
    width: min(300px, 40vw);
    z-index: 60;
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
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(14px);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 8px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.3);
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

  /* ============ 叙述浮层（视口层） ============ */
  .narration-overlay {
    position: fixed;
    top: 56px;
    right: 10px;
    bottom: 10px;
    width: min(380px, 46vw);
    z-index: 65;
    display: flex;
    flex-direction: column;
    background: rgba(8, 14, 24, 0.97);
    border: 1px solid var(--border-color);
    border-radius: 16px;
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
    z-index: 80;
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
