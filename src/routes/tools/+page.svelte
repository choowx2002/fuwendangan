<script lang="ts">
  import { getDeckList, getDeckVersions, createMatch, type DeckListResult } from '$lib/db'
  import { scoreCounterState, type GameRecord, type ScoreCounterState } from '$lib/stores/tools'
  import { ask, message } from '@tauri-apps/plugin-dialog'
  import {
    Coins,
    Dice6,
    Undo2,
    Save,
    History,
    Trophy,
    RotateCcw,
    ChevronLeft,
    Flag,
  } from '@lucide/svelte'
  import { onMount } from 'svelte'

  let decks = $state<DeckListResult[]>([])
  let decksLoaded = $state(false)

  let historyOpen = $state(true)

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
  const mePoints = $derived($scoreCounterState.mePoints)
  const oppPoints = $derived($scoreCounterState.oppPoints)

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

  function adjustPoints(side: 'me' | 'opp', delta: number) {
    scoreCounterState.update((s) => {
      const next = Math.max(0, (side === 'me' ? s.mePoints : s.oppPoints) + delta)
      const updated: ScoreCounterState = { ...s }
      updated[side === 'me' ? 'mePoints' : 'oppPoints'] = next
      return updated
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
      }
      return { ...s, games: [...s.games, record], mePoints: 0, oppPoints: 0 }
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
          deck_version_id: deckVersionId,
          deck_version_number: deckVersionNumber,
          best_of: s.bestOf === '' ? null : Number(s.bestOf),
          played_at: playedAt,
        },
        gameInputs
      )
      await message('对局已保存到卡组记录！', { title: '保存成功', kind: 'info' })
      scoreCounterState.update((st) => ({ ...st, mePoints: 0, oppPoints: 0, games: [] }))
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
  })
</script>

<div class="tools-page">
  <header class="page-header">
    <h1 class="page-title">对战工具</h1>
    <p class="page-desc">计分器 · 掷币 / 掷骰</p>
  </header>

  <section class="section">
    <div class="section-header">
      <h2 class="section-title">计分器</h2>
      <div class="section-actions">
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

    <div class="config-bar">
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
        <span class="field-label">赛制</span>
        <select class="input select" bind:value={$scoreCounterState.bestOf}>
          <option value="1">BO1（1 胜）</option>
          <option value="3">BO3（2 胜）</option>
          <option value="5">BO5（3 胜）</option>
        </select>
      </label>
      <label class="field target-field">
        <span class="field-label">目标分</span>
        <input class="input" type="number" min="1" bind:value={$scoreCounterState.targetScore} />
      </label>
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

    <div class="match-score-strip">
      <span class="match-score-side" class:lead={meWins > oppWins} class:eq={meWins === oppWins}>
        {meWins}
      </span>
      <span class="match-score-sep">:</span>
      <span class="match-score-side" class:lead={oppWins > meWins} class:eq={meWins === oppWins}>
        {oppWins}
      </span>
    </div>

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

    <div class="scoreboards">
      <div class="scoreboard" class:winner-side={mePoints >= $scoreCounterState.targetScore}>
        <input
          class="score-name"
          type="text"
          maxlength="12"
          placeholder="我方"
          bind:value={$scoreCounterState.meName}
        />
        <span class="score-number">{$scoreCounterState.mePoints}</span>
        <div class="score-controls">
          <button class="score-btn add" onclick={() => adjustPoints('me', 1)}>+1</button>
          <button class="score-btn minus" onclick={() => adjustPoints('me', -1)}>-1</button>
        </div>
      </div>
      <div class="scoreboard" class:winner-side={oppPoints >= $scoreCounterState.targetScore}>
        <input
          class="score-name"
          type="text"
          maxlength="12"
          placeholder="对方"
          bind:value={$scoreCounterState.oppName}
        />
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

    <div class="history-panel">
      <div class="history-header" role="presentation" onclick={() => (historyOpen = !historyOpen)}>
        <div class="history-title">
          <History size={14} />
          <span>历史日志</span>
          <span class="history-count">{games.length} 局</span>
        </div>
        <span class="history-chevron-wrap" class:collapse={!historyOpen}>
          <ChevronLeft size={14} class="history-chevron" />
        </span>
      </div>
      {#if historyOpen}
        {#if games.length === 0 && mePoints === 0 && oppPoints === 0}
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
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h2 class="section-title">掷币 / 掷骰</h2>
    </div>

    <div class="rng-grid">
      <div class="rng-card">
        <div class="rng-icon"><Coins size={20} /></div>
        <h3 class="rng-title">掷硬币</h3>
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
      </div>

      <div class="rng-card">
        <div class="rng-icon"><Dice6 size={20} /></div>
        <h3 class="rng-title">投掷 d20</h3>
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
      </div>
    </div>

    <div class="history-panel">
      <div class="history-title">
        <History size={14} />
        <span>本轮记录</span>
      </div>
      <div class="rng-history">
        <div class="rng-history-col">
          <span class="rng-history-label">硬币</span>
          {#if coinHistory.length === 0}
            <span class="rng-history-empty">—</span>
          {:else}
            <div class="rng-history-chips">
              {#each coinHistory as item, i (i)}
                <span class="chip coin-chip">{item}</span>
              {/each}
            </div>
          {/if}
        </div>
        <div class="rng-history-col">
          <span class="rng-history-label">骰子</span>
          {#if diceHistory.length === 0}
            <span class="rng-history-empty">—</span>
          {:else}
            <div class="rng-history-chips">
              {#each diceHistory as item, i (i)}
                <span class="chip dice-chip">{item}</span>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </section>
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

  .page-header {
    margin-bottom: 28px;
  }

  .page-title {
    font-size: var(--text-hero);
    font-weight: 700;
    margin: 0 0 8px 0;
    letter-spacing: -0.5px;
  }

  .page-desc {
    font-size: var(--text-lg);
    color: var(--text-secondary);
    margin: 0;
  }

  .section {
    margin-bottom: 36px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .section-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .section-actions {
    display: flex;
    gap: 8px;
  }

  .config-bar {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    padding: 14px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    flex-wrap: wrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 160px;
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

  .target-field {
    max-width: 110px;
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

  .match-score-strip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    margin-bottom: 16px;
  }

  .match-score-side {
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .match-score-side.lead {
    color: var(--accent-color);
  }
  .match-score-side.eq {
    color: var(--text-primary);
  }

  .match-score-sep {
    font-size: 28px;
    font-weight: 600;
    color: var(--text-tertiary);
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
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }

  @media (max-width: 620px) {
    .scoreboards {
      grid-template-columns: 1fr;
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

  .score-name {
    width: 100%;
    max-width: 220px;
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

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    cursor: pointer;
  }

  .history-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .history-count {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-tertiary);
  }

  .history-chevron-wrap {
    display: inline-flex;
    transition: transform 0.2s;
  }
  .history-chevron-wrap.collapse {
    transform: rotate(-90deg);
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
    border-top: 1px solid var(--border-color);
    max-height: 220px;
    overflow-y: auto;
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

  .rng-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }

  @media (max-width: 620px) {
    .rng-grid {
      grid-template-columns: 1fr;
    }
  }

  .rng-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
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

  .rng-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
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
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
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
