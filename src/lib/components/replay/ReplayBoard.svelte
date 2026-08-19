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
    /** 悬停卡牌 → 阅读器预览 */
    onHover?: (
      card: Record<string, unknown>,
      meta: ReplayCardMeta | null,
      side: 'self' | 'opp',
      zone: string
    ) => void
    /** 点击卡牌 → 阅读器固定 */
    onPick?: (
      card: Record<string, unknown>,
      meta: ReplayCardMeta | null,
      side: 'self' | 'opp',
      zone: string
    ) => void
  }
  let { player, side, activeTurn, metas, onHover, onPick }: Props = $props()

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

  function pick(card: Record<string, unknown>, zone: string, click: boolean) {
    const fn = click ? onPick : onHover
    fn?.(card, metaOf(card), side, zone)
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

  const isOpp = $derived(side === 'opp')
  // 手牌：我方大卡扇形重叠；对方牌背小卡
  const handWidth = $derived(isOpp ? 58 : 92)
</script>

<div class="board" class:opp={isOpp}>
  {#if isOpp}
    <!-- 对手：手牌在最上（镜像），名字/资源在最下，卡牌与文字全部正立 -->
    <div class="hand">
      <span class="zlabel">{$t('replay.hand', { values: { count: handCards.length } })}</span>
      <div class="zc hand-cards opp-hand">
        {#each handCards as c (c.id)}
          <ReplayCard card={c} back width={handWidth} />
        {/each}
      </div>
    </div>
  {/if}

  <div class="zones">
    {#each [{ zone: 'champion', label: $t('replay.champion') }, { zone: 'legend', label: $t('replay.legend') }, { zone: 'base', label: $t('replay.base') }] as row (row.zone)}
      {#if zoneCards(row.zone).length > 0}
        <div class="zone">
          <span class="zlabel">{row.label}</span>
          <div class="zc fill">
            {#each zoneCards(row.zone) as c (c.id)}
              <button
                type="button"
                class="slot"
                onmouseenter={() => pick(c, row.zone, false)}
                onclick={() => pick(c, row.zone, true)}
              >
                <ReplayCard card={c} meta={metaOf(c)} fluid />
              </button>
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
        <div class="zc fill">
          {#each runeAreaCards as c (c.id)}
            <button
              type="button"
              class="slot"
              onmouseenter={() => pick(c, 'runeArea', false)}
              onclick={() => pick(c, 'runeArea', true)}
            >
              <ReplayCard card={c} meta={metaOf(c)} fluid showType={false} />
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="zone">
      <span class="zlabel">{$t('replay.runeDeck')}</span>
      <div class="zc">
        {#if runeDeckCount > 0}
          <ReplayCard card={null} back width={56} />
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
          <ReplayCard card={null} back width={56} />
          <span class="count">{deckCount}</span>
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </div>
    </div>
    <div class="zone">
      <span class="zlabel">{$t('replay.trash')}</span>
      <div class="zc fill">
        {#if trashCards.length > 0}
          {#each trashCards.slice(-4) as c (c.id)}
            <button
              type="button"
              class="slot"
              onmouseenter={() => pick(c, 'trash', false)}
              onclick={() => pick(c, 'trash', true)}
            >
              <ReplayCard card={c} meta={metaOf(c)} fluid showType={false} />
            </button>
          {/each}
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </div>
    </div>
    <div class="zone">
      <span class="zlabel">{$t('replay.banished')}</span>
      <div class="zc fill">
        {#if banishedCards.length > 0}
          {#each banishedCards.slice(-4) as c (c.id)}
            <button
              type="button"
              class="slot"
              onmouseenter={() => pick(c, 'banished', false)}
              onclick={() => pick(c, 'banished', true)}
            >
              <ReplayCard card={c} meta={metaOf(c)} fluid showType={false} />
            </button>
          {/each}
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </div>
    </div>
  </div>

  {#if !isOpp}
    <!-- 我方：手牌在最下 -->
    <div class="hand">
      <span class="zlabel">{$t('replay.hand', { values: { count: handCards.length } })}</span>
      <div class="zc hand-cards">
        {#each handCards as c (c.id)}
          <button
            type="button"
            class="slot"
            onmouseenter={() => pick(c, 'hand', false)}
            onclick={() => pick(c, 'hand', true)}
          >
            <ReplayCard card={c} meta={metaOf(c)} width={handWidth} />
          </button>
        {/each}
      </div>
    </div>
  {/if}

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
</div>

<style>
  .board {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
  .board.opp .phead {
    margin-top: 6px;
    margin-bottom: 0;
    border-top: 1px solid var(--border-subtle);
    padding-top: 6px;
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
    font-size: var(--text-xs);
    font-weight: 600;
    color: #fff;
    background: var(--accent-color);
    padding: 1px 6px;
    border-radius: 8px;
  }
  .pills {
    font-size: var(--text-xs);
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
    min-width: 0;
    flex: 1 1 auto;
  }
  .zlabel {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .zlabel.dim {
    color: var(--text-tertiary);
  }
  .zc {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  /* 卡图尽量撑满可用宽度：slot 弹性伸展，上限 100px */
  .zc.fill .slot {
    flex: 1 1 0;
    min-width: 58px;
    max-width: 100px;
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
  }
  .slot:hover {
    outline: 2px solid var(--accent-color);
    outline-offset: 1px;
    z-index: 3;
  }
  .count {
    font-size: var(--text-xs);
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
  .board.opp .hand {
    border-top: none;
    border-bottom: 1px solid var(--border-subtle);
    padding-top: 0;
    padding-bottom: 6px;
  }
  .hand-cards {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .hand-cards .slot {
    flex: none;
  }
  .hand-cards :global(.rc) {
    margin-right: -18px;
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
  .opp-hand :global(.rc) {
    margin-right: -8px;
  }
  .opp-hand :global(.rc:hover) {
    transform: none;
  }
</style>
