<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    getDeckById,
    getDeckMatchStats,
    getMatchesByDeck,
    gameResult,
    type Deck,
    type MatchSummary,
    type MatchWithGames,
  } from '$lib/db/index.js'
  import MatchRecordModal from '$lib/components/decks/MatchRecordModal.svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { onMount } from 'svelte'
  import { ChevronRight, Plus, Swords } from '@lucide/svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'

  let deck = $state<Deck>()
  let matches = $state<MatchWithGames[]>([])
  let stats = $state<MatchSummary | null>(null)
  let showMatchModal = $state(false)

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
      list = list.filter((m) => {
        const results = m.games.map((g) => gameResult(g))
        const wins = results.filter((r) => r === 'win').length
        const losses = results.filter((r) => r === 'loss').length
        const draws = results.filter((r) => r === 'draw').length
        if (filterResult === 'win') return wins > losses
        if (filterResult === 'loss') return losses > wins
        if (filterResult === 'draw') return draws > 0
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

  function matchSummaryText(match: MatchWithGames): string {
    const results = match.games.map((g) => gameResult(g))
    const wins = results.filter((r) => r === 'win').length
    const losses = results.filter((r) => r === 'loss').length
    const draws = results.filter((r) => r === 'draw').length
    if (draws > 0) return get(t)('records.summary', { values: { wins, losses, draws } })
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
    showMatchModal = true
  }

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) goto(`/decks/${page.params.deckid}`)
  })

  onMount(() => {
    loadData()
  })

  $effect(() => {
    setTopbar({
      title: deck?.name ? $t('records.titleWithDeck', { values: { name: deck.name } }) : $t('records.title'),
      description: $t('records.count', { values: { count: matches.length } }),
      onBack: () => goto(`/decks/${page.params.deckid}`),
      actions: [
        {
          key: 'record',
          label: $t('match.recordTitle'),
          icon: Plus,
          variant: 'primary',
          priority: 0,
          onClick: openCreateMatch,
        },
      ],
    })
  })
</script>

<div class="records-container">
  {#if stats}
    <div class="records-stats">
      <div class="stat-card">
        <span class="stat-value">{stats.matches}</span>
        <span class="stat-label">{$t('records.statMatches')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{stats.games}</span>
        <span class="stat-label">{$t('records.statGames')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value stat-win">{stats.wins}</span>
        <span class="stat-label">{$t('records.statWins')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value stat-loss">{stats.losses}</span>
        <span class="stat-label">{$t('records.statLosses')}</span>
      </div>
      {#if stats.draws > 0}
        <div class="stat-card">
          <span class="stat-value">{stats.draws}</span>
          <span class="stat-label">{$t('records.statDraws')}</span>
        </div>
      {/if}
      <div class="stat-card">
        <span class="stat-value">{winRate}%</span>
        <span class="stat-label">{$t('records.statWinRate')}</span>
      </div>
      {#if stats.first_games > 0}
        <div class="stat-card">
          <span class="stat-value">
            {Math.round((stats.first_wins / stats.first_games) * 100)}%
          </span>
          <span class="stat-label">{$t('records.statFirstWinRate')}</span>
        </div>
      {/if}
      {#if stats.second_games > 0}
        <div class="stat-card">
          <span class="stat-value">
            {Math.round((stats.second_wins / stats.second_games) * 100)}%
          </span>
          <span class="stat-label">{$t('records.statSecondWinRate')}</span>
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
        {$t('records.allGroups')}
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
        {$t('records.allResults')}
      </button>
      <button
        class="filter-chip"
        class:active={filterResult === 'win'}
        onclick={() => (filterResult = 'win')}
      >
        {$t('records.winMatches')}
      </button>
      <button
        class="filter-chip"
        class:active={filterResult === 'loss'}
        onclick={() => (filterResult = 'loss')}
      >
        {$t('records.lossMatches')}
      </button>
      <button
        class="filter-chip"
        class:active={filterResult === 'draw'}
        onclick={() => (filterResult = 'draw')}
      >
        {$t('records.drawMatches')}
      </button>
    </div>

    <div class="search-input search-bar search-bar--sm">
      <input
        class="search-bar-input"
        type="text"
        placeholder={$t('records.searchPlaceholder')}
        bind:value={searchText}
      />
    </div>
  </div>

  {#if filteredMatches.length > 0}
    <ul class="records-list">
      {#each filteredMatches as match (match.id)}
        <li class="record-item">
          <div
            class="record-item-header"
            role="presentation"
            onclick={() => goto(`/decks/${page.params.deckid}/records/${match.id}/logs`)}
          >
            <div class="record-item-main">
              <span class="record-item-date">
                {match.played_at ? new Date(match.played_at).toLocaleDateString() : $t('records.noDate')}
              </span>
              <span class="record-item-opponent">
                {match.player_name || $t('records.me')} vs {match.opponent_name || $t('records.unknownOpponent')}
              </span>
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
              <span class="record-item-chevron">
                <ChevronRight size={16} />
              </span>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="records-empty">
      <Swords size={40} />
      <p>{$t('records.empty')}</p>
    </div>
  {/if}
</div>

<MatchRecordModal
  open={showMatchModal}
  deckId={page.params.deckid ?? ''}
  editing={null}
  onclose={() => (showMatchModal = false)}
  onSaved={() => loadData()}
/>

<style>
  .records-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
    color: var(--text-primary);
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
    background: var(--surface);
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
    background: var(--surface);
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
    background: var(--surface);
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

  .records-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 60px 24px;
    text-align: center;
    color: var(--text-secondary);
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }
</style>
