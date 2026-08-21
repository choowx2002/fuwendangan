<script lang="ts">
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import type { ReplayCardMeta } from '$lib/replay/card-meta'
  import type { GamePlayer } from '$lib/replay/replay-engine'
  import ReplayCard from './ReplayCard.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'

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
  const legendCards = $derived(zoneCards('legend'))
  const championCards = $derived(zoneCards('champion'))
  const baseCards = $derived(zoneCards('base'))

  const isOpp = $derived(side === 'opp')

  // 基地血量（信息面板用 score 字段）
  const score = $derived(typeof board.score === 'number' ? Number(board.score) : null)

  // 手牌卡宽随数量自适应：保证横向总宽不超出半区可用宽度（画布内绝对无溢出）
  const handWidth = $derived.by(() => {
    const n = handCards.length
    if (n === 0) return isOpp ? 60 : 64
    const overlap = isOpp ? 24 : 30
    const avail = isOpp ? 560 : 640
    const w = (avail + overlap * (n - 1)) / n
    return Math.round(Math.max(isOpp ? 32 : 42, Math.min(80, w)))
  })

  // 敌方手牌：牌背叠放展示（上限 5 张，数量角标兜底）
  const oppBackCount = $derived(Math.min(handCards.length, 5))

  // ===== T3 折叠堆弹窗：废牌堆 / 放逐区（点击 → CommonModal 卡牌列表） =====
  let pileKind = $state<'trash' | 'banished' | null>(null)
  const pileCards = $derived(
    pileKind === 'trash' ? trashCards : pileKind === 'banished' ? banishedCards : []
  )
  const pileTitle = $derived(
    pileKind === 'trash'
      ? get(t)('replay.trashDetail', { values: { count: trashCards.length } })
      : pileKind === 'banished'
        ? get(t)('replay.banishedDetail', { values: { count: banishedCards.length } })
        : ''
  )
  function openPile(kind: 'trash' | 'banished') {
    if ((kind === 'trash' ? trashCards : banishedCards).length > 0) pileKind = kind
  }
  function closePile() {
    pileKind = null
  }
</script>

<div class="board-half" class:opp={isOpp} class:active={activeTurn}>
  <!-- ===== 手牌行（镜像：敌方在上 / 我方在下） ===== -->
  <div class="bh-hand">
    {#if isOpp}
      <div class="hand-stack">
        {#each handCards.slice(0, oppBackCount) as c, i (i)}
          <ReplayCard card={c} back width={handWidth} />
        {/each}
      </div>
      <span class="zlabel">{$t('replay.hand', { values: { count: handCards.length } })}</span>
    {:else}
      <span class="zlabel">{$t('replay.hand', { values: { count: handCards.length } })}</span>
      <div class="hand-fan">
        {#each handCards as c, i (c.id)}
          {@const angle = (i - (handCards.length - 1) / 2) * 5}
          <button
            type="button"
            class="slot hcard"
            style="--fan-rot: {angle.toFixed(1)}deg; --fan-lift: {Math.abs(angle) * 0.8}px"
            onmouseenter={() => pick(c, 'hand', false)}
            onclick={() => pick(c, 'hand', true)}
          >
            <ReplayCard card={c} meta={metaOf(c)} width={handWidth} />
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ===== 资源行：传奇 | 选定 | 符文区（计算宽度，最多12张） | 基地（占比最宽） | 废牌堆 | 放逐区 ===== -->
  <div class="bh-res">
    <div class="leg-slot">
      <span class="zlabel">{$t('replay.legend')}</span>
      {#if legendCards[0]}
        <button
          type="button"
          class="slot"
          onmouseenter={() => pick(legendCards[0], 'legend', false)}
          onclick={() => pick(legendCards[0], 'legend', true)}
        >
          <ReplayCard card={legendCards[0]} meta={metaOf(legendCards[0])} width={60} />
        </button>
      {:else}
        <span class="empty-slot"></span>
      {/if}
    </div>
    <div class="chp-slot">
      <span class="zlabel">{$t('replay.champion')}</span>
      {#if championCards[0]}
        <button
          type="button"
          class="slot"
          onmouseenter={() => pick(championCards[0], 'champion', false)}
          onclick={() => pick(championCards[0], 'champion', true)}
        >
          <ReplayCard card={championCards[0]} meta={metaOf(championCards[0])} width={60} />
        </button>
      {:else}
        <span class="empty-slot"></span>
      {/if}
    </div>
    <div class="bh-rune">
      <span class="zlabel">{$t('replay.runeArea')}</span>
      <div class="rune-row">
        {#each runeAreaCards.slice(0, 12) as c (c.id)}
          <button
            type="button"
            class="slot"
            onmouseenter={() => pick(c, 'runeArea', false)}
            onclick={() => pick(c, 'runeArea', true)}
          >
            <ReplayCard card={c} meta={metaOf(c)} width={50} showType={false} />
          </button>
        {/each}
      </div>
    </div>
    <div class="bh-base">
      <span class="zlabel base-tag">{$t('replay.base')}</span>
      {#if baseCards[0]}
        <button
          type="button"
          class="slot"
          onmouseenter={() => pick(baseCards[0], 'base', false)}
          onclick={() => pick(baseCards[0], 'base', true)}
        >
          <ReplayCard card={baseCards[0]} meta={metaOf(baseCards[0])} width={60} />
        </button>
      {:else}
        <span class="empty-slot wide"></span>
      {/if}
    </div>
    <button
      type="button"
      class="pile-btn"
      disabled={trashCards.length === 0}
      onclick={() => openPile('trash')}
      title={$t('replay.trash')}
    >
      <span class="zlabel">{$t('replay.trash')}</span>
      <span class="pile-stack">
        {#if trashCards.length > 0}
          <ReplayCard card={null} back width={50} />
          <span class="pile-count">{trashCards.length}</span>
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </span>
    </button>
    <button
      type="button"
      class="pile-btn"
      disabled={banishedCards.length === 0}
      onclick={() => openPile('banished')}
      title={$t('replay.banished')}
    >
      <span class="zlabel">{$t('replay.banished')}</span>
      <span class="pile-stack">
        {#if banishedCards.length > 0}
          <ReplayCard card={null} back width={50} />
          <span class="pile-count">{banishedCards.length}</span>
        {:else}
          <span class="zlabel dim">0</span>
        {/if}
      </span>
    </button>
  </div>

  <!-- ===== T3 弹窗：废牌堆 / 放逐区卡牌列表 ===== -->
  <CommonModal open={!!pileKind} title={pileTitle} onclose={closePile} width="min(640px, 100%)">
    {#if pileCards.length === 0}
      <p class="pile-empty">{$t('replay.pileEmpty')}</p>
    {:else}
      <div class="pile-grid">
        {#each pileCards as c (c.id)}
          <button
            type="button"
            class="slot pile-card"
            onmouseenter={() => pick(c, pileKind ?? 'trash', false)}
            onclick={() => {
              pick(c, pileKind ?? 'trash', true)
              closePile()
            }}
          >
            <ReplayCard card={c} meta={metaOf(c)} width={64} showType={false} />
          </button>
        {/each}
      </div>
    {/if}
  </CommonModal>
</div>

<style>
  /* ===== 半区骨架（镜像两行）：手牌行 + 资源行 =====
     敌方：手牌在上、资源在下；我方：资源在上、手牌在下。
     信息面板由 ReplayViewer 渲染在视口层顶部（与工具栏同行）。 */
  .board-half {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
    padding: 4px 8px;
  }
  .bh-hand {
    order: 1;
    flex: none;
    height: 120px;
  }
  .bh-res {
    order: 2;
    flex: none;
    height: 114px;
  }
  .board-half:not(.opp) .bh-hand {
    order: 2;
  }
  .board-half:not(.opp) .bh-res {
    order: 1;
  }

  /* ===== 通用 ===== */
  .zlabel {
    font-size: 10px;
    color: var(--text-tertiary);
    white-space: nowrap;
    line-height: 1.2;
  }
  .zlabel.dim {
    color: var(--text-tertiary);
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
    flex: none;
  }
  .slot:hover {
    outline: 2px solid var(--accent-color);
    outline-offset: 1px;
    z-index: 3;
  }
  .empty-slot {
    width: 60px;
    height: 84px;
    border: 1px dashed var(--border-color);
    border-radius: 6px;
    background: color-mix(in srgb, var(--surface-muted) 55%, transparent);
    flex: none;
  }
  .empty-slot.wide {
    width: 160px;
    height: 72px;
  }
  .pile-count {
    position: absolute;
    right: -4px;
    bottom: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--accent-color);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    box-shadow: 0 0 0 2px var(--bg-primary);
    font-variant-numeric: tabular-nums;
  }
  .pile-stack {
    position: relative;
    display: inline-flex;
    flex: none;
  }

  /* ===== 手牌行（全宽） ===== */
  .bh-hand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 0;
    padding: 0 8px;
  }
  /* 我方：弧形排列，hover 单张上浮放大 */
  .hand-fan {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    min-width: 0;
  }
  .hcard {
    transform: rotate(var(--fan-rot)) translateY(var(--fan-lift));
    transition: transform 0.15s ease;
    z-index: 1;
  }
  .hcard:hover {
    transform: rotate(0deg) translateY(-14px) scale(1.16);
    z-index: 5;
  }
  /* 敌方：牌背叠放（负 margin 错位） */
  .hand-stack {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    min-width: 0;
  }
  .hand-stack :global(.rc) {
    margin-left: -18px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  }
  .hand-stack :global(.rc:first-child) {
    margin-left: 0;
  }

  /* ===== 资源行（传奇 | 选定 | 符文区动态 | 基地最宽 | 废牌堆 | 放逐区） ===== */
  .bh-res {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-width: 0;
  }
  .leg-slot,
  .chp-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    flex: none;
    min-width: 0;
  }
  .bh-rune {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    flex: none;
    min-width: 0;
    max-width: 660px;
  }
  .rune-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 660px;
    overflow: hidden;
  }
  .bh-base {
    position: relative;
    flex: 1 1 auto;
    min-width: 170px;
    height: 88px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 14%, transparent);
  }
  .base-tag {
    position: absolute;
    top: 2px;
    left: 8px;
  }
  .pile-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
    flex: none;
    min-width: 0;
  }
  .pile-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ===== T3 弹窗：卡牌网格 ===== */
  .pile-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 52vh;
    overflow-y: auto;
  }
  .pile-empty {
    margin: 0;
    padding: 16px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-base);
  }
</style>
