<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    getDeckById,
    getDeckMatchStats,
    getMatchesByDeck,
    deleteMatch,
    type Deck,
    type MatchSummary,
    type MatchWithGames,
  } from '$lib/db/index.js'
  import MatchRecordModal from '$lib/components/decks/MatchRecordModal.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { onMount } from 'svelte'
  import { ArrowLeft, ChevronRight, PencilLine, Plus, Swords, Trash2 } from '@lucide/svelte'
  import { ask } from '@tauri-apps/plugin-dialog'

  let deck = $state<Deck>()
  let matches = $state<MatchWithGames[]>([])
  let stats = $state<MatchSummary | null>(null)
  let expandedMatchIds = $state<Set<string>>(new Set())
  let showMatchModal = $state(false)
  let editingMatch = $state<MatchWithGames | null>(null)

  let filterGroup = $state('all')
  let filterResult = $state('all')
  let searchText = $state('')

  const allGroups = $derived(
    Array.from(new Set(matches.map((m) => m.group_name).filter((g): g is string => !!g))).sort(
      (a, b) => a.localeCompare(b, 'zh')
    )
  )

  const filteredMatches = $derived.by(() => {
    let list = matches
    if (filterGroup !== 'all') {
      list = list.filter((m) => (m.group_name ?? '') === filterGroup)
    }
    if (filterResult !== 'all') {
      const wantWin = filterResult === 'win'
      list = list.filter((m) => {
        const wins = m.games.filter((g) => g.is_win).length
        const losses = m.games.filter((g) => !g.is_win).length
        if (filterResult === 'win') return wins > losses
        if (filterResult === 'loss') return losses > wins
        return true
      })
    }
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase()
      list = list.filter((m) => {
        if ((m.opponent_name ?? '').toLowerCase().includes(kw)) return true
        if ((m.group_name ?? '').toLowerCase().includes(kw)) return true
        if ((m.note ?? '').toLowerCase().includes(kw)) return true
        return m.games.some(
          (g) =>
            (g.log ?? '').toLowerCase().includes(kw) ||
            (g.win_reason ?? '').toLowerCase().includes(kw)
        )
      })
    }
    return list
  })

  function toggleMatchExpand(id: string) {
    const next = new Set(expandedMatchIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    expandedMatchIds = next
  }

  function matchSummaryText(match: MatchWithGames): string {
    const wins = match.games.filter((g) => g.is_win).length
    const losses = match.games.filter((g) => !g.is_win).length
    const draws = match.games.length - wins - losses
    if (draws > 0) return `${wins} 胜 ${losses} 负 ${draws} 平`
    return `${wins} : ${losses}`
  }

  const winRate = $derived(
    stats && stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0
  )

  async function loadData() {
    const deckId = page.params.deckid
    if (!deckId) {
      goto('/decks')
      return
    }
    const d = await getDeckById(deckId)
    if (!d) {
      goto('/decks')
      return
    }
    deck = d
    const [records, s] = await Promise.all([getMatchesByDeck(deckId), getDeckMatchStats(deckId)])
    matches = records
    stats = s
  }

  function openCreateMatch() {
    editingMatch = null
    showMatchModal = true
  }

  function openEditMatch(match: MatchWithGames) {
    editingMatch = match
    showMatchModal = true
  }

  async function confirmDeleteMatch(match: MatchWithGames) {
    const confirm = await ask(`确定删除这场对局吗？小局记录将一并删除。`, {
      kind: 'warning',
      okLabel: '删除',
      cancelLabel: '取消',
    })
    if (!confirm) return
    await deleteMatch(match.id)
    await loadData()
  }

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) goto(`/decks/${page.params.deckid}`)
  })

  onMount(() => {
    loadData()
  })
</script>

<div class="records-container">
  <div class="records-header">
    <div class="records-title-row">
      <button
        class="back-btn"
        onclick={() => goto(`/decks/${page.params.deckid}`)}
        title="返回卡组详情"
      >
        <ArrowLeft size={18} />
      </button>
      <div class="records-title">
        <h1>{deck?.name ? `${deck.name} · 对局记录` : '对局记录'}</h1>
        <span class="records-count">共 {matches.length} 场</span>
      </div>
    </div>
    <button class="button button-primary" onclick={openCreateMatch}>
      <Plus size={16} /> 记录对局
    </button>
  </div>

  {#if stats}
    <div class="records-stats">
      <div class="stat-card">
        <span class="stat-value">{stats.matches}</span>
        <span class="stat-label">场次</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{stats.games}</span>
        <span class="stat-label">小局</span>
      </div>
      <div class="stat-card">
        <span class="stat-value stat-win">{stats.wins}</span>
        <span class="stat-label">胜</span>
      </div>
      <div class="stat-card">
        <span class="stat-value stat-loss">{stats.losses}</span>
        <span class="stat-label">负</span>
      </div>
      {#if stats.draws > 0}
        <div class="stat-card">
          <span class="stat-value">{stats.draws}</span>
          <span class="stat-label">平</span>
        </div>
      {/if}
      <div class="stat-card">
        <span class="stat-value">{winRate}%</span>
        <span class="stat-label">胜率</span>
      </div>
      {#if stats.first_games > 0}
        <div class="stat-card">
          <span class="stat-value">
            {Math.round((stats.first_wins / stats.first_games) * 100)}%
          </span>
          <span class="stat-label">先手胜率</span>
        </div>
      {/if}
      {#if stats.second_games > 0}
        <div class="stat-card">
          <span class="stat-value">
            {Math.round((stats.second_wins / stats.second_games) * 100)}%
          </span>
          <span class="stat-label">后手胜率</span>
        </div>
      {/if}
    </div>
  {/if}

  <div class="records-filter">
    <div class="filter-group">
      <button
        class="filter-chip"
        class:active={filterGroup === 'all'}
        onclick={() => (filterGroup = 'all')}
      >
        全部分组
      </button>
      {#each allGroups as group (group)}
        <button
          class="filter-chip"
          class:active={filterGroup === group}
          onclick={() => (filterGroup = group)}
        >
          {group}
        </button>
      {/each}
    </div>

    <div class="filter-group">
      <button
        class="filter-chip"
        class:active={filterResult === 'all'}
        onclick={() => (filterResult = 'all')}
      >
        全部
      </button>
      <button
        class="filter-chip"
        class:active={filterResult === 'win'}
        onclick={() => (filterResult = 'win')}
      >
        胜场
      </button>
      <button
        class="filter-chip"
        class:active={filterResult === 'loss'}
        onclick={() => (filterResult = 'loss')}
      >
        负场
      </button>
    </div>

    <input
      class="search-input"
      type="text"
      placeholder="搜索对手 / 分组 / 备注 / 复盘……"
      bind:value={searchText}
    />
  </div>

  {#if filteredMatches.length > 0}
    <ul class="records-list">
      {#each filteredMatches as match (match.id)}
        {@const expanded = expandedMatchIds.has(match.id)}
        <li class="record-item">
          <div
            class="record-item-header"
            role="presentation"
            onclick={() => toggleMatchExpand(match.id)}
          >
            <div class="record-item-main">
              <span class="record-item-date">
                {match.played_at ? new Date(match.played_at).toLocaleDateString() : '未填日期'}
              </span>
              <span class="record-item-opponent">{match.opponent_name || '无名对手'}</span>
              {#if match.group_name}
                <span class="record-group-badge">{match.group_name}</span>
              {/if}
              {#if match.best_of}
                <span class="record-bestof-badge">BO{match.best_of}</span>
              {/if}
              {#if match.deck_version_number}
                <span class="record-version-badge">v{match.deck_version_number}</span>
              {/if}
            </div>
            <div class="record-item-side">
              <span class="record-item-result">{matchSummaryText(match)}</span>
              <span class="record-item-chevron" class:rotate={expanded}>
                <ChevronRight size={16} />
              </span>
            </div>
          </div>

          {#if expanded}
            <div class="record-item-detail">
              {#if match.note}
                <p class="record-note">{match.note}</p>
              {/if}
              {#if match.opp_legend_name}
                <div class="record-legend-row">
                  <CardSimpleImage
                    url={match.opp_legend_image}
                    name={`${match.opp_legend_print_code ?? match.opp_legend_id ?? 'none'}-${match.opp_legend_lang ?? match.opp_legend_print_id ?? 'none'}`}
                    className="record-legend-thumb"
                  />
                  <span class="record-legend-label">对手传奇：</span>
                  <span class="record-legend-name">{match.opp_legend_name}</span>
                </div>
              {/if}
              <ul class="record-game-list">
                {#each match.games as game (game.id)}
                  <li class="record-game-item">
                    <span class="game-number-badge">第 {game.game_number} 局</span>
                    {#if game.is_first !== null}
                      <span
                        class="game-turn-badge"
                        class:first={game.is_first}
                        class:second={!game.is_first}
                      >
                        {game.is_first ? '先手' : '后手'}
                      </span>
                    {/if}
                    <span class="game-score">
                      {#if game.my_score !== null && game.opp_score !== null}
                        {game.my_score} : {game.opp_score}
                      {:else}
                        未记比分
                      {/if}
                    </span>
                    <span class="game-result" class:win={game.is_win} class:loss={!game.is_win}>
                      {game.is_win ? '胜' : '负'}
                    </span>
                    {#if game.win_type === 'concede'}
                      <span class="game-special-badge">对方认输</span>
                    {:else if game.win_type === 'special'}
                      <span class="game-special-badge special">特殊胜利</span>
                    {/if}
                    {#if game.win_reason}
                      <span class="game-reason">{game.win_reason}</span>
                    {/if}
                  </li>
                  {#if game.log}
                    <li class="record-game-log">📝 {game.log}</li>
                  {/if}
                {/each}
              </ul>
              <div class="record-item-actions">
                <button class="button button-text button-sm" onclick={() => openEditMatch(match)}>
                  <PencilLine size={13} /> 编辑
                </button>
                <button
                  class="button button-text button-sm"
                  onclick={() => confirmDeleteMatch(match)}
                >
                  <Trash2 size={13} /> 删除
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="records-empty">
      <Swords size={40} />
      <p>暂无对局记录，点击「记录对局」开始记录吧。</p>
    </div>
  {/if}
</div>

<MatchRecordModal
  open={showMatchModal}
  deckId={page.params.deckid ?? ''}
  editing={editingMatch}
  onclose={() => (showMatchModal = false)}
  onSaved={() => loadData()}
/>

<style>
  .records-container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px;
    color: var(--text-primary);
  }

  .records-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
  }

  .records-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .back-btn:hover {
    background: var(--bg-hover);
  }

  .records-title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .records-title h1 {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .records-count {
    font-size: 13px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .records-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 16px;
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }

  .stat-value {
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
  }

  .stat-value.stat-win {
    color: #16a34a;
  }

  .stat-value.stat-loss {
    color: #dc2626;
  }

  .stat-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .records-filter {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .filter-chip {
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

  .filter-chip:hover {
    background: var(--bg-hover);
  }

  .filter-chip.active {
    color: #fff;
    background: var(--accent-color, #4f46e5);
    border-color: var(--accent-color, #4f46e5);
  }

  .search-input {
    flex: 1;
    min-width: 200px;
    padding: 7px 12px;
    font-size: 13px;
    color: var(--text-primary);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent-color, #4f46e5);
  }

  .records-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .record-item {
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    overflow: hidden;
  }

  .record-item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
  }

  .record-item-header:hover {
    background: var(--bg-hover);
  }

  .record-item-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .record-item-date {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .record-item-opponent {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .record-group-badge,
  .record-bestof-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .record-group-badge {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 14%, transparent);
  }

  .record-bestof-badge {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .record-version-badge {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color, #4f46e5) 25%, transparent);
  }

  .game-turn-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .game-turn-badge.first {
    color: #fff;
    background: #2563eb;
  }

  .game-turn-badge.second {
    color: #fff;
    background: #ea580c;
  }

  .record-item-side {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .record-item-result {
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
  }

  .record-item-side :global(svg) {
    color: var(--text-secondary);
  }

  .record-item-chevron {
    display: flex;
    color: var(--text-secondary);
    transition: transform 0.2s;
  }

  .record-item-chevron.rotate {
    transform: rotate(90deg);
  }

  .record-item-detail {
    padding: 14px 18px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
  }

  .record-note {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .record-legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 13px;
  }

  :global(.record-legend-thumb) {
    width: 28px;
    /* height: 38px; */
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .record-legend-label {
    color: var(--text-secondary);
  }

  .record-legend-name {
    font-weight: 600;
  }

  .record-game-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .record-game-item {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .game-number-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    color: var(--text-primary);
    background: var(--bg-hover);
    white-space: nowrap;
  }

  .game-score {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .game-result {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 700;
    border-radius: 999px;
    white-space: nowrap;
  }

  .game-result.win {
    color: #fff;
    background: #16a34a;
  }

  .game-result.loss {
    color: #fff;
    background: #dc2626;
  }

  .game-special-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    color: #92400e;
    background: #fef3c7;
    white-space: nowrap;
  }

  .game-special-badge.special {
    color: #7c3aed;
    background: #ede9fe;
  }

  .game-reason {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .record-game-log {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
    padding: 4px 0 2px 42px;
    white-space: pre-wrap;
  }

  .record-item-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 12px;
  }

  .records-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 60px 24px;
    text-align: center;
    color: var(--text-secondary);
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }

  @media (max-width: 640px) {
    .records-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
