<script lang="ts">
  import {
    getDeckList,
    getDeckVersions,
    getMatchGroups,
    createMatch,
    searchCards,
    getBestPrint,
    printCacheName,
    type DeckListResult,
    type DeckVersion,
  } from '$lib/db'
  import {
    scoreCounterState,
    matchTimerMinutes,
    toolsStoreReady,
    type GameRecord,
    type ActionEntry,
  } from '$lib/stores/tools'
  import { playerName } from '$lib/stores/settings'
  import type { CardBase, MatchWinType } from '$lib/db/types'
  import { confirmAction, showMessage } from '$lib/utils/confirm'
  import { goto } from '$app/navigation'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import {
    Save,
    History,
    Trophy,
    RotateCcw,
    Flag,
    Timer,
    SlidersHorizontal,
    Search,
    X,
    FlipVertical2,
    ChevronLeft,
    ChevronDown,
    Dice6,
    Gamepad2,
    Swords,
  } from '@lucide/svelte'
  import { onMount, onDestroy } from 'svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  let decks = $state<DeckListResult[]>([])
  let decksLoaded = $state(false)

  let historyOpen = $state(false)

  let settingsOpen = $state(false)
  let diceOpen = $state(false)
  let oppFlipped = $state(true)

  let rngMode = $state<'dice' | 'coin'>('dice')
  let coinResult = $state<'正面' | '反面' | null>(null)
  let coinFlipping = $state(false)
  let diceResult = $state<number | null>(null)
  let diceRolling = $state(false)

  let allLegends = $state<CardBase[]>([])
  let legendLoading = $state(false)
  let oppLegendQuery = $state('')
  let legendOpen = $state(false)

  const bestOfTarget: Record<string, number> = { '1': 1, '3': 2, '5': 3 }

  const games = $derived($scoreCounterState.games)
  const meWins = $derived(games.filter((g) => g.winner === 'me').length)
  const oppWins = $derived(games.filter((g) => g.winner === 'opp').length)
  /** 平局也占一局：双方 dots 中均以深灰显示 */
  const draws = $derived(games.filter((g) => g.winner === 'draw').length)
  const matchTargetWins = $derived(bestOfTarget[$scoreCounterState.bestOf] ?? 0)
  const mePoints = $derived($scoreCounterState.mePoints)
  const oppPoints = $derived($scoreCounterState.oppPoints)
  const currentActions = $derived($scoreCounterState.currentActions ?? [])

  const meReached = $derived($scoreCounterState.mePoints >= $scoreCounterState.targetScore)
  const oppReached = $derived($scoreCounterState.oppPoints >= $scoreCounterState.targetScore)
  const gameOver = $derived(meReached || oppReached)

  const matchWinner = $derived.by(() => {
    const target = bestOfTarget[$scoreCounterState.bestOf] ?? 0
    if (target === 0) return null
    const maxGames = Number($scoreCounterState.bestOf) || 1
    if (meWins >= target && oppWins >= target) return 'both'
    // 延长模式（再打一局）：提前达标的一方不再立即结束，打到场次满或对方达标
    if (extended) {
      if (oppWins >= target) return 'opp'
      if (games.length >= maxGames) {
        if (meWins > oppWins) return 'me'
        if (oppWins > meWins) return 'opp'
        return 'draw'
      }
      return null
    }
    if (meWins >= target) return 'me'
    if (oppWins >= target) return 'opp'
    // 平局也算一局：达到赛制总场次仍未分出胜负时结束，胜场多者胜，否则平局
    if (games.length >= maxGames) {
      if (meWins > oppWins) return 'me'
      if (oppWins > meWins) return 'opp'
      return 'draw'
    }
    return null
  })

  const matchOver = $derived(matchWinner !== null)

  /* ===== 对局阶段与引导 ===== */
  const matchIdle = $derived(
    $scoreCounterState.games.length === 0 &&
      $scoreCounterState.mePoints === 0 &&
      $scoreCounterState.oppPoints === 0 &&
      ($scoreCounterState.currentActions?.length ?? 0) === 0 &&
      $scoreCounterState.timerEndsAt == null &&
      $scoreCounterState.timerRemaining == null
  )
  const draftSummary = $derived($scoreCounterState.pendingDraftSummary)

  /* ===== 弹窗 ===== */
  let startModalOpen = $state(false)
  let startPrompted = $state(false)
  let matchOverModalOpen = $state(false)
  let matchOverPrompted = $state(false)

  /* ===== 本局结算草稿（结算弹窗共用） ===== */
  let settleWinType = $state<MatchWinType>('normal')
  /** 特殊胜利/认输的胜者归属（默认我方） */
  let settleWinner = $state<'me' | 'opp'>('me')
  let settleFirst = $state<boolean | null>(null)
  let settleReason = $state('')
  let settleLog = $state('')
  let settleError = $state('')
  let settleModalOpen = $state(false)
  let endBannerDismissed = $state(false)
  /** 延长模式：提前达标后仍继续打 */
  let extended = $state(false)

  /* ===== 保存 ===== */
  let saveModalOpen = $state(false)
  let saveDate = $state('')
  let saveDoneOpen = $state(false)
  let savedDeckId = $state('')

  /* ===== 设置弹窗附加数据 ===== */
  let deckVersions = $state<DeckVersion[]>([])
  let deckVersionLoading = $state(false)
  let groupSuggestions = $state<string[]>([])

  const deckNameLabel = $derived(decks.find((d) => d.id === $scoreCounterState.deckId)?.name ?? '')

  function todayInput(): string {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  async function loadDeckVersions() {
    const deckId = $scoreCounterState.deckId
    if (!deckId) {
      deckVersions = []
      return
    }
    deckVersionLoading = true
    try {
      const list = await getDeckVersions(deckId)
      deckVersions = list
      scoreCounterState.update((s) =>
        s.deckVersionId && !list.some((v) => v.id === s.deckVersionId)
          ? { ...s, deckVersionId: '' }
          : s
      )
    } catch {
      deckVersions = []
    } finally {
      deckVersionLoading = false
    }
  }

  async function loadGroups() {
    try {
      groupSuggestions = await getMatchGroups()
    } catch {
      groupSuggestions = []
    }
  }

  const oppLegendFiltered = $derived.by(() => {
    const q = oppLegendQuery.trim().toLowerCase()
    if (!q) return allLegends
    return allLegends
      .filter((c) =>
        [c.card_name_cn, c.card_name_en, c.card_no].some((v) => v && v.toLowerCase().includes(q))
      )
      .slice(0, 50)
  })

  // ===== 对局倒计时 =====
  let timerNow = $state(Date.now())
  let timerInterval: ReturnType<typeof setInterval> | null = null

  const timerRemainingMs = $derived.by(() => {
    const s = $scoreCounterState
    if (s.timerEndsAt != null) return Math.max(0, s.timerEndsAt - timerNow)
    return s.timerRemaining
  })

  const timerActive = $derived(timerRemainingMs != null)
  const timerRunning = $derived($scoreCounterState.timerEndsAt != null)
  const timerExpired = $derived(timerActive && timerRemainingMs! <= 0)
  const timerLow = $derived(timerActive && !timerExpired && timerRemainingMs! <= 60_000)
  const timerDisplayMs = $derived(timerRemainingMs ?? (Number($matchTimerMinutes) || 60) * 60_000)
  const timerProgress = $derived.by(() => {
    const total = $scoreCounterState.timerTotalMs ?? (Number($matchTimerMinutes) || 60) * 60_000
    if (!timerActive || total <= 0) return 100
    return Math.max(0, Math.min(100, (timerRemainingMs! / total) * 100))
  })

  function formatTimer(ms: number): string {
    const totalSec = Math.max(0, Math.ceil(ms / 1000))
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  }

  function startTimer() {
    const durationMs = Math.max(1, Number($matchTimerMinutes) || 60) * 60_000
    scoreCounterState.update((s) => ({
      ...s,
      timerEndsAt: Date.now() + durationMs,
      timerRemaining: null,
      timerTotalMs: durationMs,
    }))
  }

  function pauseTimer() {
    scoreCounterState.update((s) => {
      if (s.timerEndsAt == null) return s
      return { ...s, timerEndsAt: null, timerRemaining: Math.max(0, s.timerEndsAt - Date.now()) }
    })
  }

  function resumeTimer() {
    scoreCounterState.update((s) => {
      if (s.timerRemaining == null) return s
      return { ...s, timerEndsAt: Date.now() + s.timerRemaining, timerRemaining: null }
    })
  }

  function resetTimer() {
    scoreCounterState.update((s) => ({
      ...s,
      timerEndsAt: null,
      timerRemaining: null,
      timerTotalMs: null,
    }))
  }

  function coinLabel(value: string): string {
    return get(t)(value === '正面' ? 'tools.coinHeads' : 'tools.coinTails')
  }

  function nowTime() {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  async function loadDecks() {
    try {
      const { decks: list } = await getDeckList({ limit: 500 })
      decks = list
    } catch (error) {
      decks = []
    } finally {
      decksLoaded = true
    }
  }

  async function loadLegends() {
    if (legendLoading || allLegends.length > 0) return
    legendLoading = true
    try {
      const res = await searchCards({
        page: 1,
        pageSize: 1000,
        card_category: { include: ['传奇'] },
      })
      allLegends = res.data
        .slice()
        .sort((a, b) =>
          (a.card_name_cn || a.card_name_en || a.card_no).localeCompare(
            b.card_name_cn || b.card_name_en || b.card_no,
            'zh'
          )
        )
    } catch (error) {
      allLegends = []
    } finally {
      legendLoading = false
    }
  }

  function pickOppLegend(card: CardBase) {
    const print = getBestPrint(card)
    scoreCounterState.update((s) => ({
      ...s,
      oppLegendId: card.id,
      oppLegendPrintId: print?.id ?? null,
      oppLegendName: card.card_name_cn || card.card_name_en || '',
      oppLegendImage: print?.url || '',
    }))
    legendOpen = false
    oppLegendQuery = ''
  }

  function clearOppLegend() {
    scoreCounterState.update((s) => ({
      ...s,
      oppLegendId: null,
      oppLegendPrintId: null,
      oppLegendName: null,
      oppLegendImage: null,
    }))
  }

  function adjustPoints(side: 'me' | 'opp', delta: number) {
    endBannerDismissed = false
    scoreCounterState.update((s) => {
      const next = Math.max(0, (side === 'me' ? s.mePoints : s.oppPoints) + delta)
      if (next === (side === 'me' ? s.mePoints : s.oppPoints) && delta < 0) return s
      const mePoints = side === 'me' ? next : s.mePoints
      const oppPoints = side === 'opp' ? next : s.oppPoints
      const entry: ActionEntry = {
        time: nowTime(),
        side,
        delta,
        mePoints,
        oppPoints,
      }
      return {
        ...s,
        mePoints,
        oppPoints,
        currentActions: [...(s.currentActions ?? []), entry],
      }
    })
  }

  function settleGame(
    winType: GameRecord['winType'],
    extra?: { isFirst?: boolean | null; winReason?: string; log?: string; winner?: 'me' | 'opp' }
  ) {
    scoreCounterState.update((s) => {
      const myScore = s.mePoints
      const oppScore = s.oppPoints
      const winner: GameRecord['winner'] =
        winType === 'draw'
          ? 'draw'
          : winType === 'normal'
            ? myScore > oppScore
              ? 'me'
              : myScore < oppScore
                ? 'opp'
                : 'draw'
            : (extra?.winner ?? 'me')
      const record: GameRecord = {
        gameNumber: s.games.length + 1,
        winner,
        myScore,
        oppScore,
        winType,
        time: new Date().toLocaleString([], {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        actions: s.currentActions ?? [],
        isFirst: extra?.isFirst ?? null,
        winReason: extra?.winReason?.trim() || null,
        log: extra?.log?.trim() || null,
      }
      return {
        ...s,
        games: [...s.games, record],
        mePoints: 0,
        oppPoints: 0,
        currentActions: [],
      }
    })
  }

  function resetSettleDraft(winType: MatchWinType = 'normal') {
    settleWinType = winType
    settleWinner = 'me'
    settleFirst = null
    settleReason = ''
    settleLog = ''
    settleError = ''
  }

  /** 结算弹窗里的"继续计分"：关闭弹窗并暂时隐藏浮动按钮 */
  function dismissEndBanner() {
    endBannerDismissed = true
    settleModalOpen = false
    resetSettleDraft()
  }

  function openSettleModal(winType: MatchWinType) {
    resetSettleDraft(winType)
    settleModalOpen = true
  }

  function confirmSettle() {
    if (settleWinType === 'special' && !settleReason.trim()) {
      settleError = get(t)('match.specialNeedsReason')
      return
    }
    settleGame(settleWinType, {
      winner: settleWinner,
      isFirst: settleFirst,
      winReason: settleReason,
      log: settleLog,
    })
    settleModalOpen = false
    resetSettleDraft()
  }

  function playAgain() {
    extended = true
    endBannerDismissed = false
    matchOverModalOpen = false
  }

  function revertLastGame() {
    scoreCounterState.update((s) => {
      if (s.games.length === 0) return s
      const last = s.games[s.games.length - 1]
      return {
        ...s,
        mePoints: last.myScore,
        oppPoints: last.oppScore,
        games: s.games.slice(0, -1),
        currentActions: last.actions ?? [],
      }
    })
  }

  async function resetScore() {
    const confirm = await confirmAction(get(t)('tools.resetConfirm'), {
      title: get(t)('tools.resetScoreTitle'),
      danger: true,
      okLabel: get(t)('common.reset'),
      cancelLabel: get(t)('common.cancel'),
    })
    if (!confirm) return
    scoreCounterState.update((s) => ({
      ...s,
      mePoints: 0,
      oppPoints: 0,
      games: [],
      currentActions: [],
      timerEndsAt: null,
      timerRemaining: null,
      timerTotalMs: null,
      pendingDraftSummary: null,
      diceHistory: [],
      coinHistory: [],
    }))
    extended = false
    endBannerDismissed = false
    resetSettleDraft()
    matchOverModalOpen = false
  }

  function flipCoin() {
    if (coinFlipping) return
    coinFlipping = true
    coinResult = null
    setTimeout(() => {
      coinResult = Math.random() < 0.5 ? '正面' : '反面'
      scoreCounterState.update((s) => ({
        ...s,
        coinHistory: [...s.coinHistory, coinResult as string].slice(-100),
      }))
      coinFlipping = false
    }, 600)
  }

  function rollDice() {
    if (diceRolling) return
    diceRolling = true
    diceResult = null
    setTimeout(() => {
      const value = Math.floor(Math.random() * 20) + 1
      diceResult = value
      scoreCounterState.update((s) => ({
        ...s,
        diceHistory: [...s.diceHistory, value].slice(-100),
      }))
      diceRolling = false
    }, 500)
  }

  function openSaveModal() {
    saveDate = todayInput()
    saveModalOpen = true
  }

  async function confirmSave() {
    const s = $scoreCounterState
    if (!s.deckId || s.games.length === 0) return

    const gameInputs = s.games.map((g) => ({
      game_number: g.gameNumber,
      my_score: g.myScore,
      opp_score: g.oppScore,
      win_type: g.winner === 'draw' ? 'draw' : g.winType,
      is_win: g.winner === 'me',
      is_first: g.isFirst ?? null,
      win_reason: g.winReason ?? null,
      log: g.log ?? null,
    }))

    let deckVersionId: string | null = null
    let deckVersionNumber: number | null = null
    if (s.deckVersionId) {
      const v = deckVersions.find((ver) => ver.id === s.deckVersionId)
      if (v) {
        deckVersionId = v.id
        deckVersionNumber = v.version_number
      }
    }
    if (!deckVersionId) {
      try {
        const versions = await getDeckVersions(s.deckId)
        const latest = versions[0]
        if (latest) {
          deckVersionId = latest.id
          deckVersionNumber = latest.version_number
        }
      } catch {
        deckVersionId = null
        deckVersionNumber = null
      }
    }

    const playedAt = saveDate ? new Date(`${saveDate}T00:00:00`).toISOString() : null

    try {
      await createMatch(
        {
          deck_id: s.deckId,
          player_name: $playerName.trim() || null,
          opponent_name: s.opponentName.trim() || null,
          opponent_deck: s.opponentDeck.trim() || null,
          opp_legend_id: s.oppLegendId,
          opp_legend_print_id: s.oppLegendPrintId,
          opp_legend_name: s.oppLegendName,
          opp_legend_image: s.oppLegendImage,
          deck_version_id: deckVersionId,
          deck_version_number: deckVersionNumber,
          best_of: s.bestOf === '' ? null : Number(s.bestOf),
          group_name: s.groupName.trim() || null,
          note: s.note.trim() || null,
          played_at: playedAt,
        },
        gameInputs
      )
      saveModalOpen = false
      // 清空对局数据（含骰子/硬币历史），保留对手/卡组/传奇等设置便于打下一场
      scoreCounterState.update((st) => ({
        ...st,
        mePoints: 0,
        oppPoints: 0,
        games: [],
        currentActions: [],
        timerEndsAt: null,
        timerRemaining: null,
        timerTotalMs: null,
        pendingDraftSummary: null,
        diceHistory: [],
        coinHistory: [],
      }))
      extended = false
      endBannerDismissed = false
      resetSettleDraft()
      savedDeckId = s.deckId
      saveDoneOpen = true
    } catch (error) {
      console.error('[Tools] 保存对局失败:', error)
      await showMessage(get(t)('tools.saveFailedRetry'), {
        title: get(t)('tools.saveFailedTitle'),
        kind: 'error',
      })
    }
  }

  function gotoRecords() {
    saveDoneOpen = false
    if (savedDeckId) goto(`/decks/${savedDeckId}/records`)
  }

  /** 从对局记录弹窗带入：确认开始后清除引导 */
  function startFromDraft() {
    scoreCounterState.update((s) => ({ ...s, pendingDraftSummary: null }))
    startModalOpen = false
  }

  /** 取消带入：清掉带入的信息字段 */
  function cancelDraft() {
    scoreCounterState.update((s) => ({
      ...s,
      pendingDraftSummary: null,
      deckId: '',
      deckVersionId: '',
      opponentName: '',
      opponentDeck: '',
      oppLegendId: null,
      oppLegendPrintId: null,
      oppLegendName: null,
      oppLegendImage: null,
      groupName: '',
      note: '',
      bestOf: '3',
    }))
    startModalOpen = false
  }

  let toolsReady = $state(false)

  onMount(() => {
    loadDecks()
    loadLegends()
    timerNow = Date.now()
    timerInterval = setInterval(() => (timerNow = Date.now()), 1000)
    toolsStoreReady.then(() => (toolsReady = true))
  })

  onDestroy(() => {
    if (timerInterval) clearInterval(timerInterval)
  })

  /** 无进行中对局时，自动弹出"开始新对局"引导 */
  $effect(() => {
    if (toolsReady && matchIdle && !startPrompted) {
      startPrompted = true
      startModalOpen = true
    }
  })

  /** 系列结束（一方达 BO 目标）时自动弹出结果弹窗 */
  $effect(() => {
    if (matchOver) {
      if (!matchOverPrompted) {
        matchOverPrompted = true
        matchOverModalOpen = true
      }
    } else {
      matchOverPrompted = false
    }
  })

  $effect(() => {
    const name = $playerName.trim()
    if (!name) return
    if ($scoreCounterState.meName === '我方') {
      scoreCounterState.update((s) => (s.meName === '我方' ? { ...s, meName: name } : s))
    }
  })

  $effect(() => {
    if ($scoreCounterState.deckId) {
      loadDeckVersions()
    } else {
      deckVersions = []
    }
  })

  $effect(() => {
    if (settingsOpen) {
      loadGroups()
      if ($scoreCounterState.deckId) loadDeckVersions()
    }
  })
</script>

<div class="tools-page">
  <section class="section">
    <div class="section-header">
      <button
        class="header-back-btn"
        onclick={() => window.history.back()}
        aria-label={$t('common.back')}
        title={$t('common.back')}
      >
        <ChevronLeft size={18} />
      </button>
      <div class="section-actions">
        {#if games.length > 0}
          <button class="button button-primary button-sm" onclick={openSaveModal}>
            <Save size={16} />
            {$t('tools.saveNow')}
          </button>
        {/if}
        <button class="button button-ghost button-sm" onclick={() => (settingsOpen = true)}>
          <SlidersHorizontal size={16} />
          {$t('tools.settings')}
        </button>
        <button class="button button-ghost button-sm" onclick={() => (historyOpen = true)}>
          <History size={16} />
          {$t('tools.history')}
          {#if games.length > 0}<span class="history-btn-badge">{games.length}</span>{/if}
        </button>
        <button class="button button-ghost button-sm" onclick={() => (diceOpen = true)}>
          <Dice6 size={16} />
          {$t('tools.dice')}
        </button>
      </div>
    </div>

    {#if gameOver && !endBannerDismissed}
      <button type="button" class="settle-fab" onclick={() => openSettleModal('normal')}>
        <Flag size={18} />
        {$t('tools.finishGame')}
      </button>
    {/if}

    <div class="scoreboards">
      <div
        class="scoreboard me-board"
        class:winner-side={mePoints >= $scoreCounterState.targetScore}
      >
        <button class="score-zone minus" onclick={() => adjustPoints('me', -1)}>
          <span class="zone-text">-</span>
        </button>
        <div class="score-main">
          <div class="score-name-row">
            <input
              class="score-name"
              type="text"
              maxlength="12"
              placeholder={$t('tools.mePlaceholder')}
              bind:value={$scoreCounterState.meName}
            />
            <div class="match-dots" title="{$t('tools.win')} {meWins} · {$t('tools.draw')} {draws}">
              {#each Array(matchTargetWins) as _, i}
                <span
                  class="match-dot"
                  class:won={i < meWins}
                  class:draw={i >= meWins && i < meWins + draws}
                ></span>
              {/each}
            </div>
          </div>
          <span class="score-number">{$scoreCounterState.mePoints}</span>
        </div>
        <button class="score-zone add" onclick={() => adjustPoints('me', 1)}>
          <span class="zone-text">+</span>
        </button>
      </div>

      <div class="timer-bar" class:low={timerLow} class:expired={timerExpired}>
        <div class="timer-track" style={`--pct: ${timerProgress}`}>
          <div class="timer-fill"></div>
        </div>
        <div class="timer-meta">
          <Timer size={14} />
          <span class="timer-display">{formatTimer(timerDisplayMs)}</span>
          {#if timerExpired}
            <span class="timer-expired-label">{$t('tools.timerExpired')}</span>
          {/if}
        </div>
        <div class="timer-actions">
          {#if !timerActive}
            <button class="button button-ghost button-sm" onclick={startTimer}>
              {$t('tools.timerStart')}
            </button>
          {:else if timerRunning}
            <button class="button button-ghost button-sm" onclick={pauseTimer}>
              {$t('tools.timerPause')}
            </button>
            <button class="button button-ghost button-sm" onclick={resetTimer}>
              {$t('tools.timerReset')}
            </button>
          {:else}
            <button class="button button-ghost button-sm" onclick={resumeTimer}>
              {$t('tools.timerResume')}
            </button>
            <button class="button button-ghost button-sm" onclick={resetTimer}>
              {$t('tools.timerReset')}
            </button>
          {/if}
        </div>
      </div>

      <div class="opp-wrap">
        <button
          class="flip-btn"
          class:active={oppFlipped}
          title={$t('tools.flipView')}
          aria-label={$t('tools.flipView')}
          onclick={() => (oppFlipped = !oppFlipped)}
        >
          <FlipVertical2 size={16} />
        </button>
        <div
          class="scoreboard opp-board"
          class:flipped={oppFlipped}
          class:winner-side={oppPoints >= $scoreCounterState.targetScore}
        >
          <button class="score-zone minus" onclick={() => adjustPoints('opp', -1)}>
            <span class="zone-text">−</span>
          </button>
          <div class="score-main">
            <div class="score-name-row">
              <input
                class="score-name"
                type="text"
                maxlength="12"
                placeholder={$t('tools.oppPlaceholder')}
                bind:value={$scoreCounterState.oppName}
              />
              <div
                class="match-dots"
                title="{$t('tools.win')} {oppWins} · {$t('tools.draw')} {draws}"
              >
                {#each Array(matchTargetWins) as _, i}
                  <span
                    class="match-dot"
                    class:won={i < oppWins}
                    class:draw={i >= oppWins && i < oppWins + draws}
                  ></span>
                {/each}
              </div>
            </div>
            <span class="score-number">{$scoreCounterState.oppPoints}</span>
          </div>
          <button class="score-zone add" onclick={() => adjustPoints('opp', 1)}>
            <span class="zone-text">+</span>
          </button>
        </div>
      </div>
    </div>

    <div class="score-tools-row">
      <button class="button button-ghost button-sm" onclick={() => openSettleModal('special')}>
        <Flag size={14} />
        {$t('tools.specialWin')}
      </button>
      <button class="button button-ghost button-sm" onclick={() => openSettleModal('concede')}>
        <RotateCcw size={14} />
        {$t('tools.oppConcede')}
      </button>
      <button class="button button-ghost button-sm" onclick={() => openSettleModal('draw')}>
        <Timer size={14} />
        {$t('tools.timeoutDraw')}
      </button>
      <span class="score-tools-hint">{$t('tools.manualSettleHint')}</span>
    </div>
  </section>

  <CommonModal
    open={settingsOpen}
    title={$t('tools.settingsTitle')}
    subtitle={$t('tools.settingsSubtitle')}
    width="min(520px, 100%)"
    onclose={() => (settingsOpen = false)}
  >
    <div class="settings-form">
      <div class="field-group">
        <div class="field-group-title">{$t('match.sectionOpponent')}</div>
        <label class="field">
          <span class="field-label">{$t('tools.myDeck')}</span>
          <select
            class="input select"
            bind:value={$scoreCounterState.deckId}
            disabled={!decksLoaded}
          >
            <option value="">{$t('tools.noDeckAssoc')}</option>
            {#each decks as deck (deck.id)}
              <option value={deck.id}>{deck.name}</option>
            {/each}
          </select>
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field-label">{$t('tools.opponent')}</span>
            <input
              class="input"
              type="text"
              placeholder={$t('common.optional')}
              maxlength="50"
              bind:value={$scoreCounterState.opponentName}
            />
          </label>
          <label class="field">
            <span class="field-label">{$t('tools.opponentDeck')}</span>
            <input
              class="input"
              type="text"
              placeholder={$t('common.optional')}
              maxlength="50"
              bind:value={$scoreCounterState.opponentDeck}
            />
          </label>
        </div>
        <div class="legend-field">
          <span class="field-label">{$t('tools.oppLegend')}</span>
          {#if $scoreCounterState.oppLegendId}
            <div class="legend-picked">
              <CardSimpleImage
                url={$scoreCounterState.oppLegendImage}
                name={printCacheName({
                  id: $scoreCounterState.oppLegendPrintId ?? $scoreCounterState.oppLegendId,
                })}
                className="legend-picked-thumb"
              />
              <span class="legend-picked-name">{$scoreCounterState.oppLegendName}</span>
              <button
                class="legend-picked-clear"
                type="button"
                title={$t('tools.clearSelection')}
                onclick={clearOppLegend}
              >
                <X size={14} />
              </button>
            </div>
          {:else}
            <button
              type="button"
              class="legend-trigger"
              class:open={legendOpen}
              onclick={() => (legendOpen = !legendOpen)}
            >
              <Swords size={15} />
              {$t('match.legendPick')}
              <ChevronDown
                size={14}
                class={legendOpen ? 'legend-trigger-chevron flipped' : 'legend-trigger-chevron'}
              />
            </button>
          {/if}
          {#if legendOpen && !$scoreCounterState.oppLegendId}
            <div class="legend-panel">
              <div class="legend-search search-bar search-bar--sm">
                <Search size={14} class="search-bar-icon" />
                <input
                  class="search-bar-input"
                  type="text"
                  placeholder={$t('tools.searchLegendPlaceholder')}
                  maxlength="50"
                  bind:value={oppLegendQuery}
                />
                {#if oppLegendQuery}
                  <button
                    class="search-bar-clear"
                    type="button"
                    title={$t('tools.clearSelection')}
                    onclick={() => (oppLegendQuery = '')}
                  >
                    <X size={14} />
                  </button>
                {/if}
              </div>
              {#if legendLoading}
                <span class="legend-hint">{$t('common.loading')}</span>
              {:else if oppLegendFiltered.length === 0}
                <span class="legend-hint">{$t('tools.noLegendFound')}</span>
              {:else}
                <div class="legend-row">
                  {#each oppLegendFiltered as card (card.id)}
                    {@const best = getBestPrint(card)}
                    <button
                      type="button"
                      class="legend-item"
                      title={card.card_name_cn || card.card_name_en || card.card_no}
                      onclick={() => pickOppLegend(card)}
                    >
                      <CardSimpleImage
                        url={best?.url}
                        name={printCacheName(best)}
                        className="legend-thumb"
                      />
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <div class="field-group">
        <div class="field-group-title">{$t('match.sectionFormat')}</div>
        <div class="format-pills">
          {#each ['1', '3', '5'] as f (f)}
            <button
              type="button"
              class="format-pill"
              class:active={$scoreCounterState.bestOf === f}
              onclick={() => ($scoreCounterState.bestOf = f)}
            >
              BO{f}
            </button>
          {/each}
        </div>
        <label class="field">
          <span class="field-label">{$t('tools.targetScore')}</span>
          <input class="input" type="number" min="1" bind:value={$scoreCounterState.targetScore} />
        </label>
        <label class="field">
          <span class="field-label">{$t('tools.deckVersion')}</span>
          {#if $scoreCounterState.deckId}
            <select
              class="input select"
              bind:value={$scoreCounterState.deckVersionId}
              disabled={deckVersionLoading || !decksLoaded}
            >
              <option value="">{$t('tools.latestVersion')}</option>
              {#each deckVersions as v (v.id)}
                <option value={v.id}>
                  v{v.version_number}
                  {new Date(v.created_at ?? '').toLocaleDateString()}
                  {#if v.note}· {v.note}{/if}
                </option>
              {/each}
            </select>
          {:else}
            <input class="input" type="text" value={$t('tools.noDeckAssoc')} disabled />
          {/if}
        </label>
        <label class="field">
          <span class="field-label">{$t('tools.group')}</span>
          <input
            class="input"
            type="text"
            maxlength="50"
            list="gc-group-suggestions"
            placeholder={$t('tools.groupPlaceholder')}
            bind:value={$scoreCounterState.groupName}
          />
          <datalist id="gc-group-suggestions">
            {#each groupSuggestions as g (g)}
              <option value={g}></option>
            {/each}
          </datalist>
        </label>
        <label class="field">
          <span class="field-label">{$t('tools.matchNote')}</span>
          <textarea
            class="input textarea"
            rows="2"
            maxlength="500"
            placeholder={$t('tools.matchNotePlaceholder')}
            bind:value={$scoreCounterState.note}></textarea>
        </label>
      </div>

      <div class="field-group">
        <div class="field-group-title">{$t('tools.sectionTimer')}</div>
        <label class="field">
          <span class="field-label">{$t('tools.timerDurationLabel')}</span>
          <input class="input" type="number" min="1" max="180" bind:value={$matchTimerMinutes} />
        </label>
      </div>
    </div>

    {#snippet footer()}
      <button
        class="button button-danger-outline"
        onclick={() => {
          resetScore()
          settingsOpen = false
        }}
      >
        {$t('tools.resetScore')}
      </button>
      <button class="button button-primary" onclick={() => (settingsOpen = false)}>
        {$t('tools.done')}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={historyOpen}
    title={$t('tools.historyTitle')}
    subtitle={$t('tools.gameCount', { values: { count: games.length } })}
    width="min(600px, 100%)"
    onclose={() => (historyOpen = false)}
  >
    {#if games.length === 0 && mePoints === 0 && oppPoints === 0 && currentActions.length === 0 && $scoreCounterState.diceHistory.length === 0 && $scoreCounterState.coinHistory.length === 0}
      <p class="history-empty">{$t('tools.noGames')}</p>
    {:else}
      <ul class="history-list">
        <li class="history-item history-inprogress">
          <span class="history-time">{$t('tools.inProgress')}</span>
          <span class="history-desc">
            {$scoreCounterState.meName}
            {mePoints} :
            {oppPoints}
            {$scoreCounterState.oppName}
          </span>
        </li>
        {#if currentActions.length > 0}
          <li class="action-log">
            {#each currentActions as act, i (i)}
              <span
                class="action-entry"
                class:me={act.side === 'me'}
                class:opp={act.side === 'opp'}
              >
                <span class="action-delta">{act.delta > 0 ? '+' : ''}{act.delta}</span>
                <span class="action-side">
                  {act.side === 'me' ? $scoreCounterState.meName : $scoreCounterState.oppName}
                </span>
                <span class="action-score">{act.mePoints} : {act.oppPoints}</span>
                <span class="action-time">{act.time}</span>
              </span>
            {/each}
          </li>
        {/if}
        {#each [...games].reverse() as g, i (g.gameNumber)}
          <li class="history-item">
            <span class="history-time"
              >{$t('tools.gameNumber', { values: { number: g.gameNumber } })}</span
            >
            <span class="history-desc">
              <span class="history-side" class:me={g.winner === 'me'}>
                {g.winner === 'me'
                  ? $scoreCounterState.meName
                  : g.winner === 'opp'
                    ? $scoreCounterState.oppName
                    : $t('tools.draw')}
              </span>
              <span class="history-score">
                {g.myScore} : {g.oppScore}
              </span>
              <span
                class="history-result"
                class:win={g.winner === 'me'}
                class:draw={g.winner === 'draw'}
              >
                {g.winner === 'me'
                  ? $t('tools.win')
                  : g.winner === 'opp'
                    ? $t('tools.loss')
                    : $t('tools.draw')}
              </span>
              {#if g.winType === 'special'}
                <span class="history-type">{$t('tools.specialWin')}</span>
              {:else if g.winType === 'concede'}
                <span class="history-type">{$t('tools.oppConcede')}</span>
              {/if}
              <span class="history-time raw">· {g.time}</span>
            </span>
          </li>
          {#if g.actions && g.actions.length > 0}
            <li class="action-log">
              {#each g.actions as act, a (a)}
                <span
                  class="action-entry"
                  class:me={act.side === 'me'}
                  class:opp={act.side === 'opp'}
                >
                  <span class="action-delta">{act.delta > 0 ? '+' : ''}{act.delta}</span>
                  <span class="action-side">
                    {act.side === 'me' ? $scoreCounterState.meName : $scoreCounterState.oppName}
                  </span>
                  <span class="action-score">{act.mePoints} : {act.oppPoints}</span>
                  <span class="action-time">{act.time}</span>
                </span>
              {/each}
            </li>
          {/if}
        {/each}
        {#if $scoreCounterState.diceHistory.length > 0 || $scoreCounterState.coinHistory.length > 0}
          <li class="history-rng">
            {#if $scoreCounterState.diceHistory.length > 0}
              <div class="rng-row">
                <span class="rng-row-label">{$t('tools.dice')}</span>
                <div class="rng-row-chips">
                  {#each $scoreCounterState.diceHistory as item, i (i)}
                    <span class="chip dice-chip">{item}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if $scoreCounterState.coinHistory.length > 0}
              <div class="rng-row">
                <span class="rng-row-label">{$t('tools.coin')}</span>
                <div class="rng-row-chips">
                  {#each $scoreCounterState.coinHistory as item, i (i)}
                    <span class="chip coin-chip">{coinLabel(item)}</span>
                  {/each}
                </div>
              </div>
            {/if}
          </li>
        {/if}
      </ul>
    {/if}

    {#snippet footer()}
      <button class="button button-ghost" onclick={revertLastGame} disabled={games.length === 0}>
        {$t('tools.revertLast')}
      </button>
      <button
        class="button button-danger-outline"
        onclick={() => {
          resetScore()
          historyOpen = false
        }}
      >
        {$t('tools.clearRecords')}
      </button>
      <button class="button button-primary" onclick={() => (historyOpen = false)}>
        {$t('common.close')}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={diceOpen}
    title={$t('tools.dice')}
    subtitle={$t('tools.diceSubtitle')}
    width="min(400px, 100%)"
    onclose={() => (diceOpen = false)}
  >
    <div class="rng-body">
      <div class="rng-toggle">
        <button
          class="toggle-btn"
          class:active={rngMode === 'dice'}
          onclick={() => (rngMode = 'dice')}
        >
          {$t('tools.rollD20')}
        </button>
        <button
          class="toggle-btn"
          class:active={rngMode === 'coin'}
          onclick={() => (rngMode = 'coin')}
        >
          {$t('tools.flipCoin')}
        </button>
      </div>

      {#if rngMode === 'dice'}
        <button
          class="rng-faces dice"
          class:rolling={diceRolling}
          onclick={rollDice}
          aria-label={$t('tools.rollDiceAria')}
        >
          <span class="dice-face">{diceRolling ? '?' : (diceResult ?? '20')}</span>
        </button>
        <span class="rng-result" class:ready={diceResult !== null}>
          {diceResult !== null
            ? $t('tools.rolled', { values: { value: diceResult } })
            : $t('tools.clickRoll')}
        </span>
        <div class="rng-history">
          <span class="rng-history-label">{$t('tools.dice')}</span>
          {#if $scoreCounterState.diceHistory.length === 0}
            <span class="rng-history-empty">—</span>
          {:else}
            <div class="rng-history-chips">
              {#each $scoreCounterState.diceHistory as item, i (i)}
                <span class="chip dice-chip">{item}</span>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <button
          class="rng-faces coin"
          class:flipping={coinFlipping}
          onclick={flipCoin}
          aria-label={$t('tools.flipCoinAria')}
        >
          <span class="coin-face"
            >{coinFlipping ? '…' : coinResult ? coinLabel(coinResult) : '?'}</span
          >
        </button>
        <span class="rng-result" class:ready={coinResult !== null}>
          {coinResult ? coinLabel(coinResult) : $t('tools.clickFlip')}
        </span>
        <div class="rng-history">
          <span class="rng-history-label">{$t('tools.coin')}</span>
          {#if $scoreCounterState.coinHistory.length === 0}
            <span class="rng-history-empty">—</span>
          {:else}
            <div class="rng-history-chips">
              {#each $scoreCounterState.coinHistory as item, i (i)}
                <span class="chip coin-chip">{coinLabel(item)}</span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </CommonModal>

  <CommonModal
    open={settleModalOpen}
    title={$t('tools.settleTitle')}
    subtitle={$t('tools.settleDesc')}
    width="min(440px, 100%)"
    onclose={() => (settleModalOpen = false)}
  >
    <div class="settle-form">
      {#if gameOver}
        <div class="settle-score-line">
          <span>{$scoreCounterState.meName}</span>
          <b>{$scoreCounterState.mePoints} : {$scoreCounterState.oppPoints}</b>
          <span>{$scoreCounterState.oppName}</span>
        </div>
      {/if}
      <div class="settle-type-row">
        <button
          type="button"
          class="settle-type-btn"
          class:active={settleWinType === 'normal'}
          onclick={() => (settleWinType = 'normal')}
        >
          <Flag size={14} />
          {$t('match.normalScore')}
        </button>
        <button
          type="button"
          class="settle-type-btn"
          class:active={settleWinType === 'special'}
          onclick={() => (settleWinType = 'special')}
        >
          <Flag size={14} />
          {$t('tools.specialWin')}
        </button>
        <button
          type="button"
          class="settle-type-btn"
          class:active={settleWinType === 'concede'}
          onclick={() => (settleWinType = 'concede')}
        >
          <RotateCcw size={14} />
          {$t('tools.oppConcede')}
        </button>
        <button
          type="button"
          class="settle-type-btn"
          class:active={settleWinType === 'draw'}
          onclick={() => (settleWinType = 'draw')}
        >
          <Timer size={14} />
          {$t('tools.timeoutDraw')}
        </button>
      </div>
      {#if settleWinType === 'special' || settleWinType === 'concede'}
        <div class="settle-row">
          <span class="settle-label">{$t('tools.settleOwner')}</span>
          <button
            type="button"
            class="turn-btn"
            class:active={settleWinner === 'me'}
            onclick={() => (settleWinner = 'me')}
          >
            {$scoreCounterState.meName || $t('tools.mePlaceholder')}
          </button>
          <button
            type="button"
            class="turn-btn"
            class:active={settleWinner === 'opp'}
            onclick={() => (settleWinner = 'opp')}
          >
            {$scoreCounterState.oppName || $t('tools.oppPlaceholder')}
          </button>
        </div>
        <input
          class="input"
          type="text"
          maxlength="100"
          placeholder={$t('tools.gameReasonPlaceholder')}
          bind:value={settleReason}
        />
      {/if}
      <div class="settle-row">
        <span class="settle-label">{$t('match.turnOrder')}</span>
        <button
          type="button"
          class="turn-btn"
          class:active={settleFirst === true}
          onclick={() => (settleFirst = settleFirst === true ? null : true)}
        >
          {$t('tools.firstTurn')}
        </button>
        <button
          type="button"
          class="turn-btn"
          class:active={settleFirst === false}
          onclick={() => (settleFirst = settleFirst === false ? null : false)}
        >
          {$t('tools.secondTurn')}
        </button>
        <button type="button" class="turn-btn" onclick={() => (settleFirst = null)}>
          {$t('tools.skipTurn')}
        </button>
      </div>
      <textarea
        class="input textarea"
        rows="2"
        maxlength="2000"
        placeholder={$t('tools.reviewPlaceholder')}
        bind:value={settleLog}></textarea>
      {#if settleError}
        <div class="settle-error">{settleError}</div>
      {/if}
    </div>

    {#snippet footer()}
      {#if gameOver && !endBannerDismissed}
        <button class="button button-ghost" onclick={dismissEndBanner}>
          {$t('tools.keepScoring')}
        </button>
      {:else}
        <button class="button button-ghost" onclick={() => (settleModalOpen = false)}>
          {$t('common.cancel')}
        </button>
      {/if}
      <button class="button button-primary" onclick={confirmSettle}>
        {$t('tools.settleConfirm')}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={startModalOpen}
    title={$t('tools.startNewMatch')}
    width="min(440px, 100%)"
    onclose={() => (startModalOpen = false)}
  >
    {#if draftSummary}
      <div class="start-draft-body">
        <div class="draft-banner">
          <Gamepad2 size={16} />
          <span>{$t('tools.broughtFromDraft', { values: { summary: draftSummary } })}</span>
        </div>
        <p class="start-draft-hint">{$t('tools.emptyStateHint')}</p>
      </div>

      {#snippet footer()}
        <button class="button button-ghost" onclick={cancelDraft}>
          {$t('tools.cancelImport')}
        </button>
        <button class="button button-primary" onclick={startFromDraft}>
          <Gamepad2 size={16} />
          {$t('tools.startMatchBtn')}
        </button>
      {/snippet}
    {:else}
      <div class="start-empty-body">
        <Gamepad2 size={40} class="empty-icon" />
        <p class="empty-hint">{$t('tools.emptyStateHint')}</p>
      </div>

      {#snippet footer()}
        <button class="button button-ghost" onclick={() => (startModalOpen = false)}>
          {$t('common.cancel')}
        </button>
        <button
          class="button button-primary"
          onclick={() => {
            startModalOpen = false
            settingsOpen = true
          }}
        >
          <SlidersHorizontal size={16} />
          {$t('tools.emptyStateCta')}
        </button>
      {/snippet}
    {/if}
  </CommonModal>

  <CommonModal
    open={matchOverModalOpen}
    title={$t('tools.matchOverTitle')}
    width="min(460px, 100%)"
    onclose={() => (matchOverModalOpen = false)}
  >
    <div class="match-over-body">
      <Trophy size={40} class="match-over-trophy" />
      <div class="match-over-text">
        {#if matchWinner === 'both'}
          {$t('tools.bothMatchWins', {
            values: { count: bestOfTarget[$scoreCounterState.bestOf] },
          })}
        {:else if matchWinner === 'me'}
          {$t('tools.playerWonMatch', {
            values: { name: $scoreCounterState.meName, me: meWins, opp: oppWins },
          })}
        {:else if matchWinner === 'draw'}
          {$t('tools.matchDraw', { values: { me: meWins, opp: oppWins } })}
        {:else}
          {$t('tools.playerWonMatch', {
            values: { name: $scoreCounterState.oppName, me: meWins, opp: oppWins },
          })}
        {/if}
      </div>
    </div>

    {#snippet footer()}
      <button class="button button-danger-outline footer-left" onclick={resetScore}>
        {$t('tools.noSaveReset')}
      </button>
      {#if !$scoreCounterState.deckId}
        <span class="banner-hint footer-hint">{$t('tools.saveHint')}</span>
      {/if}
      <button class="button button-ghost" onclick={playAgain}>
        <RotateCcw size={16} />
        {$t('tools.playAgain')}
      </button>
      <button
        class="button button-primary"
        disabled={!$scoreCounterState.deckId}
        onclick={() => {
          matchOverModalOpen = false
          openSaveModal()
        }}
      >
        <Save size={16} />
        {$t('tools.saveToRecords')}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={saveModalOpen}
    title={$t('tools.saveConfirmTitle')}
    width="min(480px, 100%)"
    onclose={() => (saveModalOpen = false)}
  >
    <div class="save-summary">
      <div class="save-line">
        {$scoreCounterState.opponentName.trim() || $t('match.opponent')}
        <span class="save-sep">·</span>
        {deckNameLabel || $t('tools.noDeckAssoc')}
        {#if $scoreCounterState.oppLegendName}
          <span class="save-sep">·</span>
          {$scoreCounterState.oppLegendName}
        {/if}
      </div>
      <div class="save-line">
        {$t('tools.saveFormatLine', {
          values: {
            bestOf: $scoreCounterState.bestOf || '—',
            me: meWins,
            opp: oppWins,
            count: games.length,
          },
        })}
      </div>
      {#if !matchOver}
        <div class="save-warn">
          {$t('tools.savePartialWarn', {
            values: {
              bestOf: $scoreCounterState.bestOf || '—',
              me: meWins,
              opp: oppWins,
              count: games.length,
            },
          })}
        </div>
      {/if}
      <label class="field">
        <span class="field-label">{$t('match.date')}</span>
        <input class="input" type="date" bind:value={saveDate} />
      </label>
    </div>

    {#snippet footer()}
      <button class="button button-ghost" onclick={() => (saveModalOpen = false)}>
        {$t('tools.notNow')}
      </button>
      <button class="button button-primary" onclick={confirmSave}>
        <Save size={16} />
        {$t('tools.confirmSave')}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={saveDoneOpen}
    title={$t('tools.savedTitle')}
    width="min(420px, 100%)"
    onclose={() => (saveDoneOpen = false)}
  >
    <p class="save-done-message">{$t('tools.savedMessage')}</p>

    {#snippet footer()}
      <button class="button button-ghost" onclick={() => (saveDoneOpen = false)}>
        {$t('tools.finishLater')}
      </button>
      <button class="button button-primary" onclick={gotoRecords}>
        {$t('tools.viewRecords')}
      </button>
    {/snippet}
  </CommonModal>
</div>

<style>
  .tools-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: calc(24px + env(safe-area-inset-top)) 32px 24px;
    color: var(--text-primary);
  }

  .header-back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    flex-shrink: 0;
    border: 1px solid var(--border-color);
    border-radius: 50%;
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .header-back-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  @media (max-width: 767.99px) {
    .tools-page {
      padding: calc(24px + env(safe-area-inset-top)) 16px 80px;
    }
  }

  .section {
    margin-bottom: 36px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  /*.section-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }*/

  .section-actions {
    display: flex;
    gap: 8px;
  }

  .history-btn-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    color: white;
    background: var(--accent-color);
  }

  .settings-form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  /* 字段分组（与 MatchRecordModal 风格一致） */
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field-group-title {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .field-row {
    display: flex;
    gap: 12px;
  }

  .field-row .field {
    flex: 1;
    min-width: 0;
  }

  .legend-field {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* 传奇触发式选择（与 MatchRecordModal 风格一致） */
  .legend-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1.5px dashed var(--border-color);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.18s;
  }

  .legend-trigger:hover,
  .legend-trigger.open {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 6%, transparent);
  }

  :global(.legend-trigger-chevron) {
    transition: transform 0.2s;
  }

  :global(.legend-trigger-chevron.flipped) {
    transform: rotate(180deg);
  }

  .legend-picked {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    align-self: flex-start;
    max-width: 100%;
    padding: 6px 10px 6px 6px;
    background: var(--bg-hover);
    border: 1px solid color-mix(in oklab, var(--accent-color) 35%, transparent);
    border-radius: 10px;
  }

  :global(.legend-picked-thumb) {
    width: 30px;
    aspect-ratio: 744 / 1040;
    object-fit: cover;
    border-radius: 5px;
    flex-shrink: 0;
    background: var(--bg-secondary);
  }

  .legend-picked-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .legend-picked-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .legend-picked-clear:hover {
    background: var(--bg-active);
    color: var(--danger-color, #dc2626);
  }

  .legend-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-primary);
  }

  .legend-search {
    width: 100%;
  }

  .legend-hint {
    padding: 6px 2px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .legend-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    overflow-x: auto;
    padding: 6px 2px 10px;
    max-height: 176px;
    scrollbar-width: thin;
  }

  .legend-row::-webkit-scrollbar {
    height: 6px;
  }

  .legend-row::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 3px;
  }

  .legend-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    width: 64px;
    padding: 4px 4px 6px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .legend-item:hover {
    background: var(--bg-hover);
  }

  :global(.legend-thumb) {
    width: 44px;
    aspect-ratio: 744 / 1040;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  /* 赛制分段（与 MatchRecordModal 风格一致） */
  .format-pills {
    display: flex;
    gap: 8px;
  }

  .format-pill {
    flex: 1;
    padding: 9px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1.5px solid var(--border-color);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.18s;
  }

  .format-pill:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .format-pill.active {
    color: #fff;
    background: var(--accent-color);
    border-color: var(--accent-color);
    box-shadow: 0 2px 8px color-mix(in oklab, var(--accent-color) 30%, transparent);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .input {
    width: 100%;
    padding: 8px 12px;
    font-size: 14px;
    color: var(--text-primary);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    outline: none;
    box-sizing: border-box;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-color) 15%, transparent);
  }

  .input:disabled {
    opacity: 0.6;
  }

  .select {
    appearance: auto;
  }

  .banner-hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .score-tools-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .score-tools-hint {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .timer-bar {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    flex-shrink: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    color: var(--text-primary);
  }

  .timer-track {
    flex: 1;
    min-width: 0;
    height: 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color) 18%, transparent);
    overflow: hidden;
  }

  .timer-fill {
    height: 100%;
    width: calc(var(--pct) * 1%);
    background: var(--accent-color);
    border-radius: 999px;
    transition: width 0.3s linear;
  }

  .timer-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .timer-display {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .timer-expired-label {
    font-size: 12px;
    font-weight: 700;
    color: #e03e3e;
  }

  .timer-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .timer-bar.low .timer-meta {
    color: #d9730d;
  }

  .timer-bar.expired .timer-meta {
    color: #e03e3e;
  }

  .scoreboards {
    display: flex;
    flex-direction: column-reverse;
    gap: 16px;
    margin-bottom: 16px;
    max-width: 560px;
    margin-left: auto;
    margin-right: auto;
  }

  .opp-wrap {
    position: relative;
    display: flex;
  }

  .opp-wrap .scoreboard {
    flex: 1;
    width: 100%;
  }

  .opp-board.flipped {
    transform: rotate(180deg);
  }

  .flip-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .flip-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .flip-btn.active {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  }

  @media (max-width: 620px) {
    .field-row {
      flex-direction: column;
      gap: 14px;
    }

    .tools-page {
      height: 100%;
      padding: 0;
      max-width: none;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .section {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      margin: 0;
      overflow: hidden;
    }

    .section-header {
      flex-shrink: 0;
      justify-content: space-between;
      margin: 0;
      padding: calc(10px + env(safe-area-inset-top)) 12px 10px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-primary);
    }

    .section-actions {
      flex-wrap: wrap;
    }

    .timer-bar {
      width: 100%;
      border-left: none;
      border-right: none;
      border-radius: 0;
    }

    .scoreboards {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column-reverse;
      gap: 0;
      margin: 0;
      max-width: none;
    }

    .scoreboard {
      flex: 1;
      min-height: 0;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
    }

    .opp-wrap {
      flex: 1;
      min-height: 0;
    }

    .opp-wrap .scoreboard {
      border-top: none;
    }

    .score-main {
      padding: 12px 4px;
    }

    .score-number {
      font-size: 56px;
    }

    .zone-text {
      font-size: 28px;
    }

    .score-tools-row {
      flex-shrink: 0;
      margin: 0;
      padding: 8px 12px;
      border-top: 1px solid var(--border-color);
      background: var(--bg-primary);
    }

    .score-tools-hint {
      width: 100%;
    }
  }

  .scoreboard {
    display: flex;
    align-items: stretch;
    min-height: 200px;
    overflow: hidden;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    transition: border-color 0.15s;
  }

  .scoreboard.winner-side {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 15%, transparent);
  }

  .score-main {
    flex: 1.6;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 16px 8px;
  }

  .score-zone {
    flex: 1;
    min-width: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .score-zone.add:hover {
    background: color-mix(in srgb, #0f7b6c 12%, transparent);
    color: #0f7b6c;
  }

  .score-zone.add:active {
    background: color-mix(in srgb, #0f7b6c 20%, transparent);
  }

  .score-zone.minus:hover {
    background: color-mix(in srgb, #e03e3e 12%, transparent);
    color: #e03e3e;
  }

  .score-zone.minus:active {
    background: color-mix(in srgb, #e03e3e 20%, transparent);
  }

  .zone-text {
    font-size: 32px;
    font-weight: 700;
    line-height: 1;
    user-select: none;
  }

  .score-name-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    max-width: 260px;
  }

  .score-name {
    width: 100%;
    min-width: 0;
    text-align: center;
    font-size: var(--text-lg);
    font-weight: 600;
    padding: 6px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-primary);
    outline: none;
  }

  .score-name:focus {
    border-color: var(--border-color);
    background: var(--bg-primary);
  }

  .match-dots {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .match-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--border-color);
    background: transparent;
    transition: all 0.2s ease;
  }

  .match-dot.won {
    background: var(--accent-color);
    border-color: var(--accent-color);
  }

  .match-dot.draw {
    background: var(--text-tertiary);
    border-color: var(--text-tertiary);
  }

  .opp-board .match-dot.won {
    background: #e03e3e;
    border-color: #e03e3e;
  }

  .score-number {
    font-size: 64px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  @media (min-width: 768px) {
    .scoreboards {
      flex-direction: row;
      align-items: stretch;
      gap: 20px;
      max-width: none;
    }

    .scoreboards .me-board,
    .scoreboards .opp-wrap {
      flex: 1;
    }

    .opp-wrap .scoreboard {
      flex: 1;
    }

    .timer-bar {
      flex-direction: column;
      width: 64px;
      align-self: stretch;
      padding: 12px 8px;
    }

    .timer-track {
      flex: 1;
      min-height: 64px;
      height: auto;
      width: 12px;
    }

    .timer-fill {
      width: 100%;
      height: calc(var(--pct) * 1%);
      transition: height 0.3s linear;
    }

    .timer-meta {
      flex-direction: column;
      gap: 4px;
    }

    .timer-actions {
      flex-direction: column;
      gap: 4px;
    }

    .zone-text {
      font-size: 40px;
    }
  }

  .history-empty {
    margin: 0;
    padding: 12px 16px;
    font-size: 13px;
    color: var(--text-tertiary);
    border-top: 1px solid var(--border-color);
  }

  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    font-size: 14px;
  }

  .history-item + .history-item {
    border-top: 1px solid rgba(205, 205, 203, 0.4);
  }

  .history-time {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-tertiary);
    width: 52px;
  }

  .history-time.raw {
    width: auto;
    flex-shrink: 1;
    margin-left: auto;
    white-space: nowrap;
  }

  .history-desc {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .history-side {
    font-weight: 500;
  }
  .history-side.me {
    color: #0f7b6c;
  }

  .history-inprogress {
    color: var(--text-secondary);
    font-weight: 500;
  }
  .history-inprogress .history-time {
    color: #d9730d;
  }

  .history-score {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .history-result {
    font-size: 12px;
    font-weight: 700;
    padding: 1px 8px;
    border-radius: 999px;
    color: #e03e3e;
    background: color-mix(in srgb, #e03e3e 12%, transparent);
  }
  .history-result.win {
    color: #0f7b6c;
    background: color-mix(in srgb, #0f7b6c 12%, transparent);
  }
  .history-result.draw {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .history-type {
    font-size: 12px;
    font-weight: 500;
    padding: 1px 8px;
    border-radius: 999px;
    color: #d9730d;
    background: color-mix(in srgb, #d9730d 12%, transparent);
    white-space: nowrap;
  }

  .action-log {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 16px 10px 76px;
    font-size: 12px;
    border-top: 1px solid rgba(205, 205, 203, 0.3);
  }

  .action-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    font-variant-numeric: tabular-nums;
  }

  .action-delta {
    font-weight: 700;
    min-width: 18px;
  }
  .action-entry.me .action-delta {
    color: #0f7b6c;
  }
  .action-entry.opp .action-delta {
    color: #e03e3e;
  }

  .action-side {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-score {
    color: var(--text-primary);
    font-weight: 600;
  }

  .action-time {
    margin-left: auto;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  /* 历史弹窗：骰子/硬币记录 */
  .history-rng {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid rgba(205, 205, 203, 0.3);
  }

  .rng-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .rng-row-label {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    min-width: 32px;
  }

  .rng-row-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .rng-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .rng-toggle {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
  }

  .toggle-btn {
    padding: 6px 16px;
    min-height: 28px;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .toggle-btn:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  .toggle-btn.active {
    background-color: var(--accent-color);
    color: white;
  }

  .rng-faces {
    width: 108px;
    height: 108px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transition: transform 0.15s;
  }

  .rng-faces:hover {
    transform: translateY(-2px);
  }

  .rng-faces.rolling {
    animation: diceRoll 0.5s ease;
  }

  .rng-faces.flipping {
    animation: coinFlip 0.6s ease;
  }

  .rng-faces.coin {
    border-radius: 50%;
    border-color: #d3d1cb;
    background: linear-gradient(145deg, #faf9f7, #e4e3df);
  }

  .dice-face {
    font-size: 42px;
    font-weight: 700;
    color: var(--accent-color);
  }

  .coin-face {
    font-size: 16px;
    font-weight: 700;
    color: #3a5a3a;
  }

  @keyframes diceRoll {
    0%,
    100% {
      transform: rotate(0deg);
    }
    25% {
      transform: rotate(20deg);
    }
    50% {
      transform: rotate(-20deg);
    }
    75% {
      transform: rotate(10deg);
    }
  }

  @keyframes coinFlip {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(360deg);
    }
  }

  .rng-result {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .rng-result.ready {
    color: var(--accent-color);
  }

  .rng-history {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding-top: 12px;
    border-top: 1px solid var(--border-color);
  }

  .rng-history-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .rng-history-empty {
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .rng-history-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    padding: 3px 10px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 999px;
  }

  .coin-chip {
    background: color-mix(in srgb, #d9730d 15%, transparent);
    border: 1px solid color-mix(in srgb, #d9730d 35%, transparent);
    color: #d9730d;
  }

  .dice-chip {
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
    color: var(--accent-color);
  }

  /* ---------------- 空状态引导 ---------------- */

  :global(.empty-icon) {
    color: var(--text-tertiary);
  }

  .empty-hint {
    margin: 0;
    max-width: 420px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .draft-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
  }

  :global(.draft-banner svg) {
    color: var(--accent-color);
    flex-shrink: 0;
  }

  /* ---------------- 开始对局弹窗 ---------------- */

  .start-draft-body,
  .start-empty-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    text-align: center;
  }

  .start-draft-body {
    align-items: stretch;
    text-align: left;
  }

  .start-draft-hint {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  /* ---------------- 系列结束弹窗 ---------------- */

  .match-over-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    text-align: center;
  }

  :global(.match-over-trophy) {
    color: var(--accent-color);
  }

  .match-over-text {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.5;
  }

  /* 系列结束弹窗 footer：危险按钮（+提示）贴左，其余靠右 */
  .footer-left {
    margin-right: auto;
  }

  /* ---------------- 结束本局浮动按钮 ---------------- */

  .settle-fab {
    position: fixed;
    right: 20px;
    bottom: calc(20px + env(safe-area-inset-bottom));
    z-index: 5000;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    background: #d9730d;
    border: none;
    border-radius: 999px;
    box-shadow: 0 4px 16px rgba(217, 115, 13, 0.4);
    cursor: pointer;
    transition: transform 0.15s;
    animation: fab-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .settle-fab:hover {
    transform: translateY(-2px);
  }

  .settle-fab:active {
    transform: scale(0.96);
  }

  @keyframes fab-in {
    from {
      transform: scale(0.6);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* ---------------- 结算弹窗 ---------------- */

  .settle-score-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--bg-hover);
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .settle-score-line b {
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .settle-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .settle-label {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .turn-btn {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .turn-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .turn-btn.active {
    color: #fff;
    background: var(--accent-color);
    border-color: var(--accent-color);
    font-weight: 600;
  }

  /* ---------------- 手动结算弹窗 ---------------- */

  .settle-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .settle-type-row {
    display: flex;
    gap: 8px;
  }

  .settle-type-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1.5px solid var(--border-color);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.18s;
  }

  .settle-type-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .settle-type-btn.active {
    color: #fff;
    background: var(--accent-color);
    border-color: var(--accent-color);
  }

  .settle-error {
    padding: 8px 10px;
    font-size: 12px;
    color: #dc2626;
    background: rgba(220, 38, 38, 0.08);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 8px;
  }

  /* ---------------- 保存确认 / 保存成功 ---------------- */

  .save-summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .save-line {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .save-sep {
    margin: 0 4px;
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .save-warn {
    padding: 8px 10px;
    font-size: 12px;
    color: #d9730d;
    background: color-mix(in srgb, #d9730d 12%, transparent);
    border: 1px solid color-mix(in srgb, #d9730d 30%, transparent);
    border-radius: 8px;
  }

  .save-done-message {
    margin: 0;
    font-size: 14px;
    color: var(--text-primary);
  }
</style>
