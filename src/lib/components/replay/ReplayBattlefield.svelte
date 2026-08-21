<script lang="ts">
  import { t } from '$lib/i18n'
  import type { ReplayCardMeta } from '$lib/replay/card-meta'
  import type { GamePlayer } from '$lib/replay/replay-engine'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import ReplayCard from './ReplayCard.svelte'

  interface Props {
    me: GamePlayer | null
    opp: GamePlayer | null
    metas: Map<string, ReplayCardMeta>
    /** 战场名元数据（key=英文名，如 "Shadow Temple"） */
    nameMetas: Map<string, ReplayCardMeta>
    turnNumber: number | null | undefined
    phase: string | null | undefined
    /** 当前行动玩家 id（用于横幅高亮） */
    activeTurnPlayerId?: string | null
    onHover?: (
      card: Record<string, unknown>,
      meta: ReplayCardMeta | null,
      side: 'self' | 'opp',
      zone: string
    ) => void
    onPick?: (
      card: Record<string, unknown>,
      meta: ReplayCardMeta | null,
      side: 'self' | 'opp',
      zone: string
    ) => void
  }
  let {
    me,
    opp,
    metas,
    nameMetas,
    turnNumber,
    phase,
    activeTurnPlayerId = null,
    onHover,
    onPick,
  }: Props = $props()

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

  /** 玩家选定的战场（英文名 → 本地库元数据，含中文名与最佳卡图） */
  function bfMeta(player: GamePlayer | null): ReplayCardMeta | null {
    const n = player?.selectedBattlefield
    if (typeof n !== 'string' || !n.trim()) return null
    return nameMetas.get(n.trim()) ?? null
  }

  function bfName(player: GamePlayer | null, fallback: string): string {
    const meta = bfMeta(player)
    if (meta?.name) return meta.name
    const n = player?.selectedBattlefield
    if (typeof n === 'string' && n.trim()) return n.trim()
    return fallback
  }

  const meScore = $derived(typeof me?.board?.score === 'number' ? Number(me.board.score) : 0)
  const oppScore = $derived(typeof opp?.board?.score === 'number' ? Number(opp.board.score) : 0)
  const meActive = $derived(me?.id != null && me.id === activeTurnPlayerId)
  const oppActive = $derived(opp?.id != null && opp.id === activeTurnPlayerId)

  // 列布局：A 左（对方战场）、C 中（有用才显示）、B 右（我方战场）、Token 兜底
  const columns = $derived.by(() => {
    const out: { zone: string; label: string; meta: ReplayCardMeta | null }[] = [
      {
        zone: 'battlefieldA',
        label: bfName(opp, $t('replay.battlefield', { values: { lane: 'A' } })),
        meta: bfMeta(opp),
      },
    ]
    if (zoneCards(opp, 'battlefieldC').length > 0 || zoneCards(me, 'battlefieldC').length > 0) {
      out.push({
        zone: 'battlefieldC',
        label: $t('replay.battlefield', { values: { lane: 'C' } }),
        meta: null,
      })
    }
    out.push({
      zone: 'battlefieldB',
      label: bfName(me, $t('replay.battlefield', { values: { lane: 'B' } })),
      meta: bfMeta(me),
    })
    if (
      zoneCards(opp, 'battlefieldToken').length > 0 ||
      zoneCards(me, 'battlefieldToken').length > 0
    ) {
      out.push({ zone: 'battlefieldToken', label: $t('replay.battlefieldToken'), meta: null })
    }
    return out
  })

  function pick(card: Record<string, unknown>, side: 'self' | 'opp', zone: string, click: boolean) {
    const fn = click ? onPick : onHover
    fn?.(card, metaOf(card), side, zone)
  }
</script>

<div class="bf">
  <div class="bf-banner">
    <span class="b-name opp" class:active={oppActive}>{rowName(opp)}</span>
    <span class="b-score">
      <b class="opp">{oppScore}</b>
      <i>:</i>
      <b class="self">{meScore}</b>
    </span>
    <span class="b-name self" class:active={meActive}>{rowName(me)}</span>
    <span class="b-turn">
      {#if turnNumber != null || phase}
        {#if turnNumber != null}
          <span class="tt">{$t('replay.turn', { values: { number: turnNumber } })}</span>
        {/if}
        {#if phase}<span class="tp">{phase}</span>{/if}
      {/if}
    </span>
  </div>

  <div class="bf-cols">
    {#each columns as col (col.zone)}
      <div class="bf-col">
        <div class="col-head">
          {#if col.meta?.imgCdn}
            <div class="bf-thumb">
              <CardSimpleImage
                url={col.meta.imgCdn}
                name={col.meta.cacheName ?? 'battlefield'}
                isLandscape
              />
            </div>
          {/if}
          <span class="col-name">{col.label}</span>
        </div>
        <div class="col-half opp">
          <span class="bf-owner">{rowName(opp)}</span>
          <div class="zc">
            {#each zoneCards(opp, col.zone) as c (c.id)}
              <button
                type="button"
                class="slot"
                onmouseenter={() => pick(c, 'opp', col.zone, false)}
                onclick={() => pick(c, 'opp', col.zone, true)}
              >
                <ReplayCard card={c} meta={metaOf(c)} fluid />
              </button>
            {/each}
          </div>
        </div>
        <div class="col-half self">
          <span class="bf-owner">{rowName(me)}</span>
          <div class="zc">
            {#each zoneCards(me, col.zone) as c (c.id)}
              <button
                type="button"
                class="slot"
                onmouseenter={() => pick(c, 'self', col.zone, false)}
                onclick={() => pick(c, 'self', col.zone, true)}
              >
                <ReplayCard card={c} meta={metaOf(c)} fluid />
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .bf {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bf-banner {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .b-name {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .b-name.active {
    color: var(--accent-color);
  }
  .b-name.active::after {
    content: ' •';
  }
  .b-score {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: color-mix(in srgb, var(--surface) 66%, transparent);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 1px 14px;
    font-weight: 800;
    font-size: var(--text-md);
    color: var(--text-primary);
    backdrop-filter: blur(8px);
  }
  .b-score b.opp {
    color: #e05252;
  }
  .b-score b.self {
    color: #4d9de0;
  }
  .b-score i {
    color: var(--text-tertiary);
    font-style: normal;
  }
  .b-turn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .b-turn .tt {
    color: var(--text-primary);
    font-weight: 700;
    font-size: var(--text-base);
  }
  .b-turn .tp {
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 1px 8px;
    font-size: var(--text-xs);
  }
  .bf-cols {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .bf-col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 4px 6px;
    background: color-mix(in srgb, var(--surface) 55%, transparent);
  }
  .col-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bf-thumb {
    width: 48px;
    aspect-ratio: 1040 / 744;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .col-name {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .col-half {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .col-half.opp {
    border-bottom: 1px dashed var(--border-subtle);
    padding-bottom: 3px;
  }
  .bf-owner {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
  }
  .slot {
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    display: block;
    flex: 1 1 0;
    min-width: 32px;
    max-width: 50px;
  }
  .zc {
    display: flex;
    gap: 4px;
    flex-wrap: nowrap;
    align-items: flex-start;
    width: 100%;
  }
  .slot:hover {
    outline: 2px solid var(--accent-color);
    outline-offset: 1px;
    z-index: 3;
  }
</style>
