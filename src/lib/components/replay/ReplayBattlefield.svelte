<script lang="ts">
  import { t } from '$lib/i18n'
  import type { ReplayCardMeta } from '$lib/replay/card-meta'
  import type { GamePlayer } from '$lib/replay/replay-engine'
  import ReplayCard from './ReplayCard.svelte'

  interface Props {
    me: GamePlayer | null
    opp: GamePlayer | null
    metas: Map<string, ReplayCardMeta>
    turnNumber: number | null | undefined
    phase: string | null | undefined
  }
  let { me, opp, metas, turnNumber, phase }: Props = $props()

  const lanes = [
    { zone: 'battlefieldA', label: $t('replay.battlefield', { values: { lane: 'A' } }) },
    { zone: 'battlefieldB', label: $t('replay.battlefield', { values: { lane: 'B' } }) },
    { zone: 'battlefieldC', label: $t('replay.battlefield', { values: { lane: 'C' } }) },
    { zone: 'battlefieldToken', label: $t('replay.battlefieldToken') },
  ]

  function zoneCards(player: GamePlayer | null, zone: string): Record<string, unknown>[] {
    const z = player?.board?.[zone]
    return Array.isArray(z) ? (z as Record<string, unknown>[]) : []
  }

  function metaOf(card: Record<string, unknown> | null | undefined): ReplayCardMeta | null {
    if (!card) return null
    const code = typeof card.cardCode === 'string' ? card.cardCode : ''
    return code ? (metas.get(code) ?? null) : null
  }

  function rowName(player: GamePlayer | null): string {
    return player?.name || player?.id || '?'
  }
</script>

<div class="bf">
  <div class="bf-turn">
    {#if turnNumber != null || phase}
      <span class="tt">{$t('replay.turn', { values: { number: turnNumber ?? '-' } })}</span>
      {#if phase}<span class="tp">{phase}</span>{/if}
    {/if}
  </div>

  <div class="bf-row opp">
    <span class="bf-owner">{rowName(opp)}</span>
    {#each lanes as row (row.zone)}
      {#if zoneCards(opp, row.zone).length > 0}
        <div class="zone">
          <span class="zlabel">{row.label}</span>
          <div class="zc">
            {#each zoneCards(opp, row.zone) as c (c.id)}
              <ReplayCard card={c} meta={metaOf(c)} width={64} />
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <div class="bf-row self">
    <span class="bf-owner">{rowName(me)}</span>
    {#each lanes as row (row.zone)}
      {#if zoneCards(me, row.zone).length > 0}
        <div class="zone">
          <span class="zlabel">{row.label}</span>
          <div class="zc">
            {#each zoneCards(me, row.zone) as c (c.id)}
              <ReplayCard card={c} meta={metaOf(c)} width={64} />
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .bf {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 8px 10px;
  }
  .bf-turn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-top: -8px;
    margin-bottom: 2px;
  }
  .bf-turn .tt {
    color: var(--text-primary);
    font-weight: 700;
    font-size: var(--text-base);
  }
  .bf-turn .tp {
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 1px 8px;
  }
  .bf-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    align-items: flex-start;
  }
  .bf-row.opp {
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 6px;
  }
  .bf-row.self {
    padding-top: 2px;
  }
  .bf-owner {
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-secondary);
    min-width: 64px;
    padding-top: 2px;
    align-self: center;
  }
  .zone {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .zlabel {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .zc {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
  }
</style>
