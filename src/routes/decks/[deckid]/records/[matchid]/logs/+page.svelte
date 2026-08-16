<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    getMatchById,
    getDeckById,
    deleteMatch,
    gameResult,
    type Deck,
    type MatchWithGames,
  } from '$lib/db/index.js'
  import MatchRecordModal from '$lib/components/decks/MatchRecordModal.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { onMount } from 'svelte'
  import { Clock, PencilLine, Swords, Trash2 } from '@lucide/svelte'
  import { ask } from '@tauri-apps/plugin-dialog'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'

  let deck = $state<Deck>()
  let match = $state<MatchWithGames | null>(null)
  let showMatchModal = $state(false)

  function matchSummaryText(m: MatchWithGames): string {
    const results = m.games.map((g) => gameResult(g))
    const wins = results.filter((r) => r === 'win').length
    const losses = results.filter((r) => r === 'loss').length
    const draws = results.filter((r) => r === 'draw').length
    if (draws > 0) return get(t)('records.summary', { values: { wins, losses, draws } })
    return `${wins} : ${losses}`
  }

  async function loadData() {
    const deckId = page.params.deckid
    const matchId = page.params.matchid
    if (!deckId || !matchId) {
      goto('/decks')
      return
    }
    const m = await getMatchById(matchId)
    if (!m) {
      goto(`/decks/${deckId}/records`)
      return
    }
    match = m
    const d = await getDeckById(deckId)
    if (d) deck = d
  }

  function openEdit() {
    showMatchModal = true
  }

  async function confirmDelete() {
    const m = match
    if (!m) return
    const confirm = await ask(get(t)('records.deleteConfirm'), {
      kind: 'warning',
      okLabel: get(t)('common.delete'),
      cancelLabel: get(t)('common.cancel'),
    })
    if (!confirm) return
    await deleteMatch(m.id)
    goto(`/decks/${page.params.deckid}/records`)
  }

  beforeNavigate(({ type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) goto(`/decks/${page.params.deckid}/records`)
  })

  onMount(() => {
    loadData()
  })

  $effect(() => {
    setTopbar({
      title: deck?.name
        ? $t('records.logsTitleWithDeck', { values: { name: deck.name } })
        : $t('records.logsTitle'),
      description: match ? matchSummaryText(match) : '',
      onBack: () => goto(`/decks/${page.params.deckid}/records`),
      actions: [
        {
          key: 'edit',
          label: $t('common.edit'),
          icon: PencilLine,
          priority: 0,
          onClick: openEdit,
        },
        {
          key: 'delete',
          label: $t('common.delete'),
          icon: Trash2,
          variant: 'danger',
          priority: 1,
          onClick: confirmDelete,
        },
      ],
    })
  })
</script>

{#if match}
  <div class="logs-container">
    <div class="match-card">
      <div class="match-header">
        <div class="match-title-row">
          <span class="match-date">
            {match.played_at
              ? new Date(match.played_at).toLocaleDateString()
              : $t('records.noDate')}
          </span>
          <span class="match-opponent">
            {match.player_name || $t('records.me')} vs {match.opponent_name ||
              $t('records.unknownOpponent')}
          </span>
          {#if match.group_name}
            <span class="match-badge group">{match.group_name}</span>
          {/if}
          {#if match.best_of}
            <span class="match-badge">BO{match.best_of}</span>
          {/if}
          {#if match.deck_version_number}
            <span class="match-badge version">v{match.deck_version_number}</span>
          {/if}
        </div>
        <div class="match-summary">
          <span class="match-summary-text">{matchSummaryText(match)}</span>
          <span class="match-games-count">
            {$t('records.statGames')} · {match.games.length}
          </span>
        </div>
      </div>

      {#if match.note}
        <p class="match-note">{match.note}</p>
      {/if}

      {#if match.opp_legend_name}
        <div class="match-legend">
          <CardSimpleImage
            url={match.opp_legend_image}
            name={`${match.opp_legend_print_code ?? match.opp_legend_id ?? 'none'}-${match.opp_legend_lang ?? match.opp_legend_print_id ?? 'none'}`}
            className="match-legend-thumb"
          />
          <span class="match-legend-label">{$t('records.oppLegend')}</span>
          <span class="match-legend-name">{match.opp_legend_name}</span>
        </div>
      {/if}
    </div>

    <div class="games-section">
      <h3 class="games-title">{$t('match.gamesList')}</h3>
      <div class="game-cards">
        {#each match.games as game (game.id)}
          <div class="game-card">
            <div class="game-card-header">
              <span class="game-number">
                {$t('match.gameNumber', { values: { number: game.game_number } })}
              </span>
              {#if game.is_first !== null}
                <span class="game-turn" class:first={game.is_first} class:second={!game.is_first}>
                  {game.is_first ? $t('records.first') : $t('records.second')}
                </span>
              {/if}
              <span
                class="game-result"
                class:win={gameResult(game) === 'win'}
                class:loss={gameResult(game) === 'loss'}
                class:draw={gameResult(game) === 'draw'}
              >
                {gameResult(game) === 'win'
                  ? $t('match.win')
                  : gameResult(game) === 'loss'
                    ? $t('match.loss')
                    : $t('match.draw')}
              </span>
              {#if game.win_type === 'concede'}
                <span class="game-type">{$t('match.oppConcede')}</span>
              {:else if game.win_type === 'special'}
                <span class="game-type special">{$t('match.specialWin')}</span>
              {/if}
              <span class="game-score">
                {game.my_score !== null && game.opp_score !== null
                  ? `${game.my_score} : ${game.opp_score}`
                  : $t('records.noScore')}
              </span>
            </div>

            {#if game.win_reason}
              <p class="game-reason">{game.win_reason}</p>
            {/if}

            <div class="game-review">
              <span class="game-review-label">{$t('records.gameReview')}</span>
              {#if game.log}
                <p class="game-review-text">{game.log}</p>
              {:else}
                <p class="game-review-text empty">{$t('records.noReview')}</p>
              {/if}
            </div>

            {#if game.created_at}
              <span class="game-time">
                <Clock size={12} />
                {$t('records.recordedAt', {
                  values: { time: new Date(game.created_at).toLocaleString() },
                })}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{:else}
  <div class="logs-empty">
    <Swords size={40} />
    <p>{$t('common.loading')}</p>
  </div>
{/if}

<MatchRecordModal
  open={showMatchModal}
  deckId={page.params.deckid ?? ''}
  editing={match}
  onclose={() => (showMatchModal = false)}
  onSaved={async () => {
    await loadData()
  }}
/>

<style>
  .logs-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
    color: var(--text-primary);
  }

  .match-card {
    padding: 18px;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    margin-bottom: 20px;
  }

  .match-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .match-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .match-date {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .match-opponent {
    font-size: 16px;
    font-weight: 700;
  }

  .match-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    white-space: nowrap;
  }

  .match-badge.group {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 14%, transparent);
  }

  .match-badge.version {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color, #4f46e5) 25%, transparent);
  }

  .match-summary {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .match-summary-text {
    font-size: 15px;
    font-weight: 700;
  }

  .match-games-count {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .match-note {
    margin: 12px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--border-color);
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .match-legend {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    font-size: 13px;
  }

  :global(.match-legend-thumb) {
    width: 32px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .match-legend-label {
    color: var(--text-secondary);
  }

  .match-legend-name {
    font-weight: 600;
  }

  .games-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .games-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .game-card {
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }

  .game-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .game-number {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    border-radius: 999px;
    color: var(--text-primary);
    background: var(--bg-hover);
    white-space: nowrap;
  }

  .game-turn {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .game-turn.first {
    color: #fff;
    background: #2563eb;
  }

  .game-turn.second {
    color: #fff;
    background: #ea580c;
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

  .game-result.draw {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .game-type {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    color: #92400e;
    background: color-mix(in srgb, #f59e0b 18%, transparent);
    white-space: nowrap;
  }

  .game-type.special {
    color: #7c3aed;
    background: color-mix(in srgb, #a855f7 18%, transparent);
  }

  .game-score {
    margin-left: auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .game-reason {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .game-review {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
  }

  .game-review-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
    margin-bottom: 6px;
  }

  .game-review-text {
    margin: 0;
    font-size: 14px;
    line-height: 1.7;
    white-space: pre-wrap;
  }

  .game-review-text.empty {
    color: var(--text-tertiary);
  }

  .game-time {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .logs-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 60px 24px;
    text-align: center;
    color: var(--text-secondary);
  }
</style>
