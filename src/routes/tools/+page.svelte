<script lang="ts">
  import { getDeckList, getDeckVersions, createMatch, searchCards, getBestPrint, printCacheName, type DeckListResult } from '$lib/db'
  import { scoreCounterState, type GameRecord, type ActionEntry } from '$lib/stores/tools'
  import type { CardBase } from '$lib/db/types'
  import { ask, message } from '@tauri-apps/plugin-dialog'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import {
    Coins,
    Dice6,
    Undo2,
    Save,
    History,
    Trophy,
    RotateCcw,
    Flag,
    SlidersHorizontal,
    Search,
    X,
    FlipVertical2,
  } from '@lucide/svelte'
  import { onMount } from 'svelte'

  let decks = $state<DeckListResult[]>([])
  let decksLoaded = $state(false)

  let historyOpen = $state(false)

  let settingsOpen = $state(false)
  let rngOpen = $state(false)
  let rngMode = $state<'dice' | 'coin'>('dice')
  let viewFlipped = $state(false)

  let allLegends = $state<CardBase[]>([])
  let legendLoading = $state(false)
  let oppLegendQuery = $state('')

  let coinResult = $state<'正面' | '反面' | null>(null)
  let coinFlipping = $state(false)
  let coinHistory = $state<string[]>([])

  let diceResult = $state<number | null>(null)
  let diceRolling = $state(false)
  let diceHistory = $state<number[]>([])

  const bestOfTarget: Record<string, number> = { '1': 1, '3': 2, '5': 3 }

  const games = $derived($scoreCounterState.games)
  const meWins = $derived(games.filter((g) => g.winner === 'me').length)
  const oppWins = $derived(games.filter((g) => g.winner === 'opp').length)
  const matchTargetWins = $derived(bestOfTarget[$scoreCounterState.bestOf] ?? 0)
  const mePoints = $derived($scoreCounterState.mePoints)
  const oppPoints = $derived($scoreCounterState.oppPoints)
  const currentActions = $derived($scoreCounterState.currentActions ?? [])

  const meReached = $derived($scoreCounterState.mePoints >= $scoreCounterState.targetScore)
  const oppReached = $derived($scoreCounterState.oppPoints >= $scoreCounterState.targetScore)
  const gameOver = $derived(meReached || oppReached)

  const reachedInfo = $derived.by(() => {
    if (meReached && oppReached) return 'both'
    if (meReached) return 'me'
    if (oppReached) return 'opp'
    return 'none'
  })

  const matchWinner = $derived.by(() => {
    const target = bestOfTarget[$scoreCounterState.bestOf] ?? 0
    if (target === 0) return null
    if (meWins >= target && oppWins >= target) return 'both'
    if (meWins >= target) return 'me'
    if (oppWins >= target) return 'opp'
    return null
  })

  const matchOver = $derived(matchWinner !== null)

  const oppLegendFiltered = $derived.by(() => {
    const q = oppLegendQuery.trim().toLowerCase()
    if (!q) return allLegends
    return allLegends
      .filter((c) =>
        [c.card_name_cn, c.card_name_en, c.card_no].some((v) => v && v.toLowerCase().includes(q))
      )
      .slice(0, 50)
  })

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

  function settleGame(winType: GameRecord['winType']) {
    scoreCounterState.update((s) => {
      const myScore = s.mePoints
      const oppScore = s.oppPoints
      const winner: GameRecord['winner'] =
        winType === 'normal' ? (myScore >= oppScore ? 'me' : 'opp') : 'me'
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

  function confirmNextGame() {
    const s = $scoreCounterState
    if (reachedInfo === 'both' && s.mePoints === s.oppPoints) {
      ask('双方比分相同无法判定胜者，请先调整比分或回退。', {
        title: '无法结算',
        kind: 'warning',
        okLabel: '知道了',
      })
      return
    }
    settleGame('normal')
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
    const confirm = await ask('确定要重置计分吗？当前积分和所有小局记录将被清空。', {
      title: '重置计分',
      kind: 'warning',
      okLabel: '重置',
      cancelLabel: '取消',
    })
    if (!confirm) return
    scoreCounterState.update((s) => ({
      ...s,
      mePoints: 0,
      oppPoints: 0,
      games: [],
      currentActions: [],
    }))
  }

  async function saveMatchRecord() {
    const s = $scoreCounterState
    if (!s.deckId) return
    if (!matchWinner) return

    const gameInputs = s.games.map((g) => ({
      game_number: g.gameNumber,
      my_score: g.myScore,
      opp_score: g.oppScore,
      win_type: g.winType,
      is_win: g.winner === 'me',
      is_first: null,
    }))

    let deckVersionId: string | null = null
    let deckVersionNumber: number | null = null
    try {
      const versions = await getDeckVersions(s.deckId)
      const latest = versions[0]
      if (latest) {
        deckVersionId = latest.id
        deckVersionNumber = latest.version_number
      }
    } catch (error) {
      deckVersionId = null
      deckVersionNumber = null
    }

    const today = new Date()
    const playedAt = new Date(
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate()
      ).padStart(2, '0')}T00:00:00`
    ).toISOString()

    try {
      await createMatch(
        {
          deck_id: s.deckId,
          opponent_name: s.opponentName.trim() || null,
          opponent_deck: s.opponentDeck.trim() || null,
          opp_legend_id: s.oppLegendId,
          opp_legend_print_id: s.oppLegendPrintId,
          opp_legend_name: s.oppLegendName,
          opp_legend_image: s.oppLegendImage,
          deck_version_id: deckVersionId,
          deck_version_number: deckVersionNumber,
          best_of: s.bestOf === '' ? null : Number(s.bestOf),
          played_at: playedAt,
        },
        gameInputs
      )
      await message('对局已保存到卡组记录！', { title: '保存成功', kind: 'info' })
      scoreCounterState.update((st) => ({
        ...st,
        mePoints: 0,
        oppPoints: 0,
        games: [],
        currentActions: [],
      }))
    } catch (error) {
      console.error('[Tools] 保存对局失败:', error)
      await message('保存失败，请重试', { title: '保存失败', kind: 'error' })
    }
  }

  function flipCoin() {
    if (coinFlipping) return
    coinFlipping = true
    coinResult = null
    setTimeout(() => {
      coinResult = Math.random() < 0.5 ? '正面' : '反面'
      coinHistory = [...coinHistory, coinResult as string]
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
      diceHistory = [...diceHistory, value]
      diceRolling = false
    }, 500)
  }

  onMount(() => {
    loadDecks()
    loadLegends()
  })
</script>

<div class="tools-page">
  <section class="section">
    <div class="section-header">
      <!-- <h2 class="section-title">计分器</h2> -->
      <div class="section-actions">
        <button class="button button-ghost button-sm" onclick={() => (rngOpen = true)}>
          <Dice6 size={16} /> 掷骰 / 掷币
        </button>
        <button class="button button-ghost button-sm" onclick={() => (settingsOpen = true)}>
          <SlidersHorizontal size={16} /> 设置
        </button>
        <button class="button button-ghost button-sm" onclick={() => (historyOpen = true)}>
          <History size={16} /> 历史记录
          {#if games.length > 0}<span class="history-btn-badge">{games.length}</span>{/if}
        </button>
        <button
          class="button button-ghost button-sm"
          class:active={viewFlipped}
          title="翻转视角"
          onclick={() => (viewFlipped = !viewFlipped)}
        >
          <FlipVertical2 size={16} /> 翻转
        </button>
        <button
          class="button button-ghost button-sm"
          onclick={revertLastGame}
          disabled={games.length === 0}
        >
          <Undo2 size={14} /> 回退上一局
        </button>
        <button class="button button-danger-outline button-sm" onclick={resetScore}>
          <RotateCcw size={14} /> 重置
        </button>
      </div>
    </div>

    {#if matchOver}
      <div class="match-end-banner">
        {#if matchWinner === 'both'}
          <Trophy size={18} />
          <span>双方均达到 {bestOfTarget[$scoreCounterState.bestOf]} 胜，请检查比分</span>
        {:else if matchWinner === 'me'}
          <Trophy size={18} />
          <span>{$scoreCounterState.meName} 获胜！大比分 {meWins} : {oppWins}</span>
        {:else}
          <Trophy size={18} />
          <span>{$scoreCounterState.oppName} 获胜！大比分 {meWins} : {oppWins}</span>
        {/if}
        <div class="banner-actions">
          {#if $scoreCounterState.deckId}
            <button class="button button-primary button-sm" onclick={saveMatchRecord}>
              <Save size={14} /> 保存到对局记录
            </button>
          {:else}
            <span class="banner-hint">选择我方卡组后可将对局保存到记录</span>
          {/if}
          <button class="button button-ghost button-sm" onclick={resetScore}> 不保存，重置 </button>
        </div>
      </div>
    {/if}

    {#if gameOver}
      <div class="game-end-banner">
        {#if reachedInfo === 'both' && $scoreCounterState.mePoints === $scoreCounterState.oppPoints}
          <span>双方同分，无法判定本局胜者，请调整比分</span>
        {:else if reachedInfo === 'me'}
          <span>{$scoreCounterState.meName} 已达 {$scoreCounterState.targetScore} 分！</span>
        {:else if reachedInfo === 'opp'}
          <span>{$scoreCounterState.oppName} 已达 {$scoreCounterState.targetScore} 分！</span>
        {:else}
          <span>双方均已达到目标分</span>
        {/if}
        <div class="banner-actions">
          <button class="button button-primary button-sm" onclick={confirmNextGame}>
            确认，下一局
          </button>
        </div>
      </div>
    {/if}

    <div class="scoreboards" class:flipped={viewFlipped}>
      <div class="scoreboard me-board" class:winner-side={mePoints >= $scoreCounterState.targetScore}>
        <div class="score-name-row">
          <input
            class="score-name"
            type="text"
            maxlength="12"
            placeholder="我方"
            bind:value={$scoreCounterState.meName}
          />
          <div class="match-dots">
            {#each Array(matchTargetWins) as _, i}
              <span class="match-dot" class:won={i < meWins}></span>
            {/each}
          </div>
        </div>
        <span class="score-number">{$scoreCounterState.mePoints}</span>
        <div class="score-controls">
          <button class="score-btn add" onclick={() => adjustPoints('me', 1)}>+1</button>
          <button class="score-btn minus" onclick={() => adjustPoints('me', -1)}>-1</button>
        </div>
      </div>
      <div class="scoreboard opp-board" class:winner-side={oppPoints >= $scoreCounterState.targetScore}>
        <div class="score-name-row">
          <input
            class="score-name"
            type="text"
            maxlength="12"
            placeholder="对方"
            bind:value={$scoreCounterState.oppName}
          />
          <div class="match-dots">
            {#each Array(matchTargetWins) as _, i}
              <span class="match-dot" class:won={i < oppWins}></span>
            {/each}
          </div>
        </div>
        <span class="score-number">{$scoreCounterState.oppPoints}</span>
        <div class="score-controls">
          <button class="score-btn add" onclick={() => adjustPoints('opp', 1)}>+1</button>
          <button class="score-btn minus" onclick={() => adjustPoints('opp', -1)}>-1</button>
        </div>
      </div>
    </div>

    <div class="score-tools-row">
      <button class="button button-ghost button-sm" onclick={() => settleGame('special')}>
        <Flag size={14} /> 特殊胜利
      </button>
      <button class="button button-ghost button-sm" onclick={() => settleGame('concede')}>
        <RotateCcw size={14} /> 对方认输
      </button>
      <span class="score-tools-hint">手动结算当前小局（记为胜，不影响目标分检测）</span>
    </div>
  </section>

  <CommonModal
    open={settingsOpen}
    title="计分器设置"
    subtitle="配置卡组、对手与赛制信息"
    width="min(520px, 100%)"
    onclose={() => (settingsOpen = false)}
  >
    <div class="settings-form">
      <label class="field">
        <span class="field-label">我方卡组</span>
        <select class="input select" bind:value={$scoreCounterState.deckId} disabled={!decksLoaded}>
          <option value="">不关联（仅记分）</option>
          {#each decks as deck (deck.id)}
            <option value={deck.id}>{deck.name}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="field-label">对手</span>
        <input
          class="input"
          type="text"
          placeholder="选填"
          maxlength="50"
          bind:value={$scoreCounterState.opponentName}
        />
      </label>
      <label class="field">
        <span class="field-label">对手卡组</span>
        <input
          class="input"
          type="text"
          placeholder="选填"
          maxlength="50"
          bind:value={$scoreCounterState.opponentDeck}
        />
      </label>
      <div class="field legend-field">
        <span class="field-label">对手传奇（选填）</span>
        <div class="legend-search">
          <Search size={14} class="legend-search-icon" />
          <input
            class="input"
            type="text"
            placeholder="搜索传奇卡牌…"
            maxlength="50"
            bind:value={oppLegendQuery}
          />
          {#if $scoreCounterState.oppLegendName}
            <button
              class="icon-btn legend-clear-btn"
              type="button"
              title="清除选择"
              onclick={clearOppLegend}
            >
              <X size={14} />
            </button>
          {/if}
        </div>
        {#if legendLoading}
          <span class="legend-hint">加载中…</span>
        {:else if oppLegendFiltered.length === 0}
          <span class="legend-hint">未找到匹配的传奇卡</span>
        {:else}
          <div class="legend-row">
            {#each oppLegendFiltered as card (card.id)}
              {@const best = getBestPrint(card)}
              <button
                type="button"
                class="legend-item"
                class:selected={$scoreCounterState.oppLegendId === card.id}
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
        {#if $scoreCounterState.oppLegendName}
          <span class="legend-selected-label">
            已选：{$scoreCounterState.oppLegendName}
          </span>
        {/if}
      </div>
      <label class="field">
        <span class="field-label">赛制</span>
        <select class="input select" bind:value={$scoreCounterState.bestOf}>
          <option value="1">BO1（1 胜）</option>
          <option value="3">BO3（2 胜）</option>
          <option value="5">BO5（3 胜）</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">目标分</span>
        <input class="input" type="number" min="1" bind:value={$scoreCounterState.targetScore} />
      </label>
    </div>
  </CommonModal>

  <CommonModal
    open={rngOpen}
    title="掷骰 / 掷币"
    subtitle={rngMode === 'dice' ? '投掷 d20' : '掷硬币'}
    width="min(480px, 100%)"
    onclose={() => (rngOpen = false)}
  >
    <div class="rng-card">
      <div class="rng-icon">{#if rngMode === 'dice'}<Dice6 size={20} />{:else}<Coins size={20} />{/if}</div>
      <div class="toggle-button-group rng-toggle">
        <button
          class="toggle-btn"
          class:active={rngMode === 'dice'}
          onclick={() => (rngMode = 'dice')}
        >
          投掷 d20
        </button>
        <button
          class="toggle-btn"
          class:active={rngMode === 'coin'}
          onclick={() => (rngMode = 'coin')}
        >
          掷硬币
        </button>
      </div>
      {#if rngMode === 'dice'}
        <button class="dice" class:rolling={diceRolling} onclick={rollDice} aria-label="投掷骰子">
          <span class="dice-face">
            {#if diceRolling}
              ?
            {:else}
              {diceResult ?? '20'}
            {/if}
          </span>
        </button>
        <span class="rng-result" class:ready={diceResult !== null}>
          {diceResult !== null ? `掷出 ${diceResult}` : '点击投掷'}
        </span>
      {:else}
        <button class="coin" class:flipping={coinFlipping} onclick={flipCoin} aria-label="掷硬币">
          <span class="coin-face">
            {#if coinFlipping}
              …
            {:else}
              {coinResult ?? '?'}
            {/if}
          </span>
        </button>
        <span class="rng-result" class:ready={coinResult !== null}>
          {coinResult ?? '点击掷币'}
        </span>
      {/if}
    </div>

    <div class="history-panel">
      <div class="history-title">
        <History size={14} />
        <span>本轮记录</span>
      </div>
      <div class="rng-history">
        <div class="rng-history-col">
          <span class="rng-history-label">{rngMode === 'dice' ? '骰子' : '硬币'}</span>
          {#if rngMode === 'dice'}
            {#if diceHistory.length === 0}
              <span class="rng-history-empty">—</span>
            {:else}
              <div class="rng-history-chips">
                {#each diceHistory as item, i (i)}
                  <span class="chip dice-chip">{item}</span>
                {/each}
              </div>
            {/if}
          {:else}
            {#if coinHistory.length === 0}
              <span class="rng-history-empty">—</span>
            {:else}
              <div class="rng-history-chips">
                {#each coinHistory as item, i (i)}
                  <span class="chip coin-chip">{item}</span>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </CommonModal>

  <CommonModal
    open={historyOpen}
    title="历史日志"
    subtitle={`${games.length} 局`}
    width="min(600px, 100%)"
    onclose={() => (historyOpen = false)}
  >
    {#if games.length === 0 && mePoints === 0 && oppPoints === 0 && currentActions.length === 0}
      <p class="history-empty">还没有对局记录，用 +1/-1 开始计分</p>
    {:else}
      <ul class="history-list">
        <li class="history-item history-inprogress">
          <span class="history-time">进行中</span>
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
              <span class="action-entry" class:me={act.side === 'me'} class:opp={act.side === 'opp'}>
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
            <span class="history-time">第 {g.gameNumber} 局</span>
            <span class="history-desc">
              <span class="history-side" class:me={g.winner === 'me'}>
                {g.winner === 'me' ? $scoreCounterState.meName : $scoreCounterState.oppName}
              </span>
              <span class="history-score">
                {g.myScore} : {g.oppScore}
              </span>
              <span class="history-result" class:win={g.winner === 'me'}>
                {g.winner === 'me' ? '胜' : '负'}
              </span>
              {#if g.winType === 'special'}
                <span class="history-type">特殊胜利</span>
              {:else if g.winType === 'concede'}
                <span class="history-type">对方认输</span>
              {/if}
              <span class="history-time raw">· {g.time}</span>
            </span>
          </li>
          {#if g.actions && g.actions.length > 0}
            <li class="action-log">
              {#each g.actions as act, a (a)}
                <span class="action-entry" class:me={act.side === 'me'} class:opp={act.side === 'opp'}>
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
      </ul>
    {/if}
  </CommonModal>
</div>

<style>
  .tools-page {
    max-width: 1000px;
    margin: 0 auto;
    padding: 24px 32px;
    color: var(--text-primary);
  }

  @media (max-width: 767.99px) {
    .tools-page {
      padding: 24px 16px 80px;
    }
  }

  .section {
    margin-bottom: 36px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: right;
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
    gap: 14px;
  }

  .button-ghost.active {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  }

  .legend-field {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .legend-search {
    position: relative;
    display: flex;
    align-items: center;
  }

  :global(.legend-search-icon) {
    position: absolute;
    left: 10px;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .legend-search .input {
    padding-left: 32px;
  }

  .legend-search .input:has(+ .legend-clear-btn) {
    padding-right: 36px;
  }

  .legend-clear-btn {
    position: absolute;
    right: 6px;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--danger-color, #dc2626);
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

  .legend-item.selected {
    border-color: var(--primary-color, #4f46e5);
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

  .legend-selected-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-color);
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
    transition: border-color 0.15s;
  }

  .input:focus {
    border-color: var(--accent-color);
  }

  .input:disabled {
    opacity: 0.6;
  }

  .select {
    appearance: auto;
  }

  .match-end-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 16px;
    margin-bottom: 16px;
    border: 1px solid var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
    border-radius: var(--radius-lg);
    color: var(--text-primary);
    font-weight: 600;
  }

  .match-end-banner span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .banner-hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .game-end-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 16px;
    margin-bottom: 16px;
    border: 1px solid #d9730d;
    background: color-mix(in srgb, #d9730d 12%, transparent);
    border-radius: var(--radius-lg);
    color: var(--text-primary);
    font-weight: 600;
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

  .scoreboards {
    display: flex;
    flex-direction: column-reverse;
    gap: 16px;
    margin-bottom: 16px;
    max-width: 560px;
    margin-left: auto;
    margin-right: auto;
  }

  .opp-board {
    transform: rotate(180deg);
  }

  .scoreboards.flipped {
    flex-direction: column;
  }

  .scoreboards.flipped .opp-board {
    transform: rotate(0deg);
  }

  .scoreboards.flipped .me-board {
    transform: rotate(180deg);
  }

  @media (max-width: 620px) {
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
      justify-content: flex-start;
      margin: 0;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-primary);
    }

    .section-actions {
      flex-wrap: wrap;
    }

    .match-end-banner,
    .game-end-banner {
      flex-shrink: 0;
      margin: 0;
      padding: 10px 12px;
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
      justify-content: center;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
    }

    .scoreboard + .scoreboard {
      border-top: none;
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
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 24px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    transition: border-color 0.15s;
  }

  .scoreboard.winner-side {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 15%, transparent);
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

  .opp-board .match-dot.won {
    background: #e03e3e;
    border-color: #e03e3e;
  }

  .score-number {
    font-size: 72px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .score-controls {
    display: flex;
    gap: 10px;
  }

  .score-btn {
    min-width: 56px;
    padding: 10px 0;
    font-size: var(--text-lg);
    font-weight: 600;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.15s;
  }

  .score-btn.add {
    background: var(--bg-primary);
    color: #0f7b6c;
  }
  .score-btn.add:hover {
    border-color: #0f7b6c;
    background: color-mix(in srgb, #0f7b6c 10%, white);
  }

  .score-btn.minus {
    background: var(--bg-primary);
    color: #e03e3e;
  }
  .score-btn.minus:hover {
    border-color: #e03e3e;
    background: color-mix(in srgb, #e03e3e 10%, white);
  }

  .history-panel {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .history-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
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

  .rng-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 24px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
  }

  .rng-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    color: var(--accent-color);
  }

  .toggle-button-group {
    display: flex;
    gap: 2px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
  }

  .toggle-btn {
    padding: 4px 14px;
    min-height: 26px;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .toggle-btn.active {
    background-color: var(--accent-color);
    color: white;
  }

  .toggle-btn.active:hover {
    background-color: color-mix(in oklab, var(--accent-color) 85%, black);
  }

  .coin {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 1px solid #d3d1cb;
    background: linear-gradient(145deg, #faf9f7, #e4e3df);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transition: transform 0.15s;
  }
  .coin:hover {
    transform: translateY(-2px);
  }
  .coin.flipping {
    animation: coinFlip 0.6s ease;
  }

  .coin-face {
    font-size: 18px;
    font-weight: 700;
    color: #3a5a3a;
  }

  @keyframes coinFlip {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(360deg);
    }
  }

  .dice {
    width: 120px;
    height: 120px;
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
  .dice:hover {
    transform: translateY(-2px);
  }
  .dice.rolling {
    animation: diceRoll 0.5s ease;
  }

  .dice-face {
    font-size: 46px;
    font-weight: 700;
    color: var(--accent-color);
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

  .rng-result {
    font-size: var(--text-base);
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
    padding: 14px 16px;
    border-top: 1px solid var(--border-color);
  }

  .rng-history-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
</style>
