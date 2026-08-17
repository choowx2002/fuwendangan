<script lang="ts">
  import { t } from '$lib/i18n'
  import type { ReplayCardMeta } from '$lib/replay/card-meta'
  import type { GamePlayer } from '$lib/replay/replay-engine'
  import ReplayCard from './ReplayCard.svelte'

  interface Props {
    player: GamePlayer | null
    side: 'self' | 'opp'
    activeTurn: boolean
    metas: Map<string, ReplayCardMeta>
  }
  let { player, side, activeTurn, metas }: Props = $props()

  const board = $derived(player?.board ?? {})
  const name = $derived(player?.name || player?.id || '?')

  function zoneCards(zone: string): Record<string, unknown>[] {
    const z = board[zone]
    return Array.isArray(z) ? (z as Record<string, unknown>[]) : []
  }

  function metaOf(card: Record<string, unknown> | null | undefined): ReplayCardMeta | null {
    if (!card) return null
    const code = typeof card.cardCode === 'string' ? card.cardCode : ''
    return code ? (metas.get(code) ?? null) : null
  }

  const pills = $derived([
    {
      key: 'replay.energy',
      value: typeof board.floatingEnergy === 'number' ? Number(board.floatingEnergy) : 0,
      cls: 'g',
    },
    {
      key: 'replay.power',
      value: typeof board.floatingPower === 'number' ? Number(board.floatingPower) : 0,
      cls: 'o',
    },
    {
      key: 'replay.legendXp',
      value: typeof board.legendXp === 'number' ? Number(board.legendXp) : 0,
      cls: '',
    },
  ])

  const handCards = $derived(zoneCards('hand'))
  const deckCount = $derived(zoneCards('deck').length)
  const trashCards = $derived(zoneCards('trash'))
  const banishedCards = $derived(zoneCards('banished'))
  const runeAreaCards = $derived(zoneCards('runeArea'))
  const runeDeckCount = $derived(zoneCards('runeDeck').length)
</script>

<div class="board">
  <div class="phead">
    <span class="pname">
      {name}
      {#if activeTurn}<span class="turn-badge">{$t('replay.activeTurn')}</span>{/if}
    </span>
    <span class="pills">
      {#each pills as p (p.key)}
        <span class="pill"><b>{$t(p.key)}</b> <span class={p.cls}>{p.value}</span></span>
      {/each}
    </span>
  </div>

  <div class="zones">
    {#each [{ zone: 'champion', label: $t('replay.champion') }, { zone: 'legend', label: $t('replay.legend') }, { zone: 'base', label: $t('replay.base') }] as row (row.zone)}
      {#if zoneCards(row.zone).length > 0}
        <div class="zone">
          <span class="zlabel">{row.label}</span>
          <div class="zc">
            {#each zoneCards(row.zone) as c (c.id)}
              <ReplayCard card={c} meta={metaOf(c)} width={52} />
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <div class="zones">
    {#if runeAreaCards.length > 0}
      <div class="zone">
        <span class="zlabel">{$t('replay.runeArea')}</span>
        <div class="zc">
          {#each runeAreaCards as c (c.id)}
            <ReplayCard card={c} meta={metaOf(c)} width={44} showType={false} />
          {/each}
        </div>
      </div>
    {/if}
    <div class="zone">
      <span class="zlabel">{$t('replay.runeDeck')}</span>
      <div class="zc">
        {#if runeDeckCount > 0}
          <ReplayCard card={null} back width={44} />
          <span class="count">{runeDeckCount}</span>
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </div>
    </div>
    <div class="zone">
      <span class="zlabel">{$t('replay.deck')}</span>
      <div class="zc">
        {#if deckCount > 0}
          <ReplayCard card={null} back width={44} />
          <span class="count">{deckCount}</span>
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </div>
    </div>
    <div class="zone">
      <span class="zlabel">{$t('replay.trash')}</span>
      <div class="zc">
        {#if trashCards.length > 0}
          {#each trashCards.slice(-3) as c (c.id)}
            <ReplayCard card={c} meta={metaOf(c)} width={44} />
          {/each}
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </div>
    </div>
    <div class="zone">
      <span class="zlabel">{$t('replay.banished')}</span>
      <div class="zc">
        {#if banishedCards.length > 0}
          {#each banishedCards.slice(-3) as c (c.id)}
            <ReplayCard card={c} meta={metaOf(c)} width={44} />
          {/each}
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="hand">
    <span class="zlabel">{$t('replay.hand', { values: { count: handCards.length } })}</span>
    <div class="zc hand-cards">
      {#each handCards as c (c.id)}
        {#if side === 'self'}
          <ReplayCard card={c} meta={metaOf(c)} width={64} />
        {:else}
          <ReplayCard card={c} back width={48} />
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .board {
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 8px 10px;
  }
  .phead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .pname {
    font-weight: 600;
    font-size: var(--text-md);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .turn-badge {
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    background: var(--accent-color);
    padding: 1px 6px;
    border-radius: 8px;
  }
  .pills {
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pill {
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 1px 8px;
  }
  .pill b {
    color: var(--text-primary);
    font-weight: 600;
    margin-right: 3px;
  }
  .pill .g {
    color: #128378;
    font-weight: 600;
  }
  .pill .o {
    color: #d9730d;
    font-weight: 600;
  }
  .zones {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    align-items: flex-start;
    margin-bottom: 6px;
  }
  .zone {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .zlabel {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .zlabel.dim {
    color: var(--text-tertiary);
  }
  .zc {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
  }
  .count {
    font-size: 11px;
    color: var(--text-secondary);
    align-self: center;
    padding-left: 2px;
  }
  .hand {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 6px;
  }
  .hand-cards {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .hand-cards :global(.rc) {
    margin-right: -14px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
  }
  .hand-cards :global(.rc:last-child) {
    margin-right: 0;
  }
  .hand-cards :global(.rc:hover) {
    transform: translateY(-8px);
    transition: transform 0.12s ease;
    z-index: 2;
  }
</style>
