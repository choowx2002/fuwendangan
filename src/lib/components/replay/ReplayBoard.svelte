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

  // ===== 流体缩放：半区高度 → 缩放因子 k（设计基准高度 150px） =====
  // 所有内部尺寸（行高/卡宽/占位槽）以 k 缩放，随可用高度自适应。
  const BASE_H = 150
  let k = $state(1)
  let halfEl: HTMLElement | null = null
  $effect(() => {
    const el = halfEl
    if (!el) return
    const update = () => {
      const h = el.clientHeight || 0
      k = Math.max(0.4, Math.min(2.4, h / BASE_H))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  })
  // 资源行各卡宽（px，随 k 缩放）：卡高 = 宽×1039/744，须 ≤ 资源行高 66k
  const cwBig = $derived(Math.round(44 * k)) // 传奇 / 选定 / 基地（高≈61k）
  const cwRune = $derived(Math.round(32 * k)) // 符文区（高≈45k）
  const cwPile = $derived(Math.round(28 * k)) // 废牌堆 / 放逐区（高≈39k）

  // 手牌卡宽随数量自适应（基准 px），再随 k 缩放；保证横向总宽不超出可用宽度
  const baseHandWidth = $derived.by(() => {
    const n = handCards.length
    if (n === 0) return isOpp ? 40 : 46
    const overlap = isOpp ? 18 : 20
    const avail = isOpp ? 420 : 520
    const w = (avail + overlap * (n - 1)) / n
    return Math.round(Math.max(isOpp ? 26 : 36, Math.min(isOpp ? 42 : 48, w)))
  })
  const handWidth = $derived(Math.round(baseHandWidth * k))

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

<div
  class="board-half"
  class:opp={isOpp}
  class:active={activeTurn}
  bind:this={halfEl}
  style="--k: {k}"
>
  <!-- ===== 上行：符文区 | 基地   ·   传奇 | 英雄（双方同构） ===== -->
  <div class="bh-res">
    <div class="res-left">
      <div class="bh-rune">
        <span class="rune-tag">{$t('replay.runeArea')}</span>
        <div class="rune-row">
          {#each runeAreaCards.slice(0, 12) as c (c.id)}
            <button
              type="button"
              class="slot"
              data-card-id={String(c.id)}
              onmouseenter={() => pick(c, 'runeArea', false)}
              onclick={() => pick(c, 'runeArea', true)}
            >
              <ReplayCard card={c} meta={metaOf(c)} width={cwRune} showType={false} />
            </button>
          {/each}
        </div>
      </div>
      <div class="bh-base">
        <span class="zlabel base-tag">{$t('replay.base')}</span>
        {#if baseCards.length > 0}
          <div class="base-row">
            {#each baseCards as c (c.id)}
              <button
                type="button"
                class="slot"
                data-card-id={String(c.id)}
                onmouseenter={() => pick(c, 'base', false)}
                onclick={() => pick(c, 'base', true)}
              >
                <ReplayCard card={c} meta={metaOf(c)} width={cwBig} />
              </button>
            {/each}
          </div>
        {:else}
          <span class="empty-slot wide"></span>
        {/if}
      </div>
    </div>
    <div class="res-right">
      <div class="leg-slot">
        <span class="zlabel">{$t('replay.legend')}</span>
        {#if legendCards[0]}
          <button
            type="button"
            class="slot"
            data-card-id={String(legendCards[0].id)}
            onmouseenter={() => pick(legendCards[0], 'legend', false)}
            onclick={() => pick(legendCards[0], 'legend', true)}
          >
            <ReplayCard card={legendCards[0]} meta={metaOf(legendCards[0])} width={cwBig} />
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
            data-card-id={String(championCards[0].id)}
            onmouseenter={() => pick(championCards[0], 'champion', false)}
            onclick={() => pick(championCards[0], 'champion', true)}
          >
            <ReplayCard card={championCards[0]} meta={metaOf(championCards[0])} width={cwBig} />
          </button>
        {:else}
          <span class="empty-slot"></span>
        {/if}
      </div>
    </div>
  </div>

  <!-- ===== 下行：手牌（宽） · 废牌 | 驱逐（双方同构） ===== -->
  <div class="bh-hand">
    <div class="hand-main">
      <span class="zlabel">{$t('replay.hand', { values: { count: handCards.length } })}</span>
      <div class="hand-stack">
        {#each handCards as c, i (isOpp ? i : c.id)}
          {#if isOpp}
            <ReplayCard card={c} back width={handWidth} />
          {:else}
            <button
              type="button"
              class="slot hand-slot"
              data-card-id={String(c.id)}
              onmouseenter={() => pick(c, 'hand', false)}
              onclick={() => pick(c, 'hand', true)}
            >
              <ReplayCard card={c} meta={metaOf(c)} width={handWidth} />
            </button>
          {/if}
        {/each}
      </div>
    </div>
    <div class="hand-right">
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
            <ReplayCard card={null} back width={cwPile} />
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
            <ReplayCard card={null} back width={cwPile} />
            <span class="pile-count">{banishedCards.length}</span>
          {:else}
            <span class="zlabel dim">0</span>
          {/if}
        </span>
      </button>
    </div>
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
  /* ===== 半区骨架（两行，双方同构）：
     上行 bh-res：符文区|基地 · 传奇|英雄
     下行 bh-hand：手牌(宽) · 废牌|驱逐
     半区总高 150px（k=1 基准）：手牌 70 + 资源 76 + gap 4 */
  .board-half {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: relative;
    padding: 0 8px;
    overflow: hidden;
  }
  .bh-hand {
    flex: none;
    height: calc(70px * var(--k, 1));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .bh-res {
    flex: none;
    height: calc(76px * var(--k, 1));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  /* 左组：符文区 | 基地；右组：传奇 | 英雄 */
  .res-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .res-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    min-width: 0;
  }
  /* 手牌（宽） + 废牌/驱逐 */
  .hand-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .hand-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    min-width: 0;
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
  .empty-slot {
    width: calc(44px * var(--k, 1));
    height: calc(61px * var(--k, 1));
    border: 1px dashed var(--border-color);
    border-radius: 6px;
    background: color-mix(in srgb, var(--surface-muted) 55%, transparent);
    flex: none;
  }
  .empty-slot.wide {
    width: calc(92px * var(--k, 1));
    height: calc(56px * var(--k, 1));
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

  /* ===== 手牌叠放（负 margin 错位） ===== */
  .hand-stack {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    min-width: 0;
  }
  .hand-stack :global(.rc),
  .hand-slot {
    margin-left: -18px;
  }
  .hand-stack :global(.rc) {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  }
  .hand-stack :global(.rc:first-child),
  .hand-stack .hand-slot:first-child {
    margin-left: 0;
  }

  /* ===== 上行资源：符文区 | 基地 · 传奇 | 英雄 ===== */
  .leg-slot,
  .chp-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: none;
    min-width: 0;
  }
  .bh-rune {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: calc(62px * var(--k, 1));
    padding: 0 10px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 14%, transparent);
  }
  .rune-tag {
    position: absolute;
    top: 2px;
    left: 8px;
    font-size: 10px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  /* 半叠排布：后续符文错位重叠；整体宽度按 12 张计算固定（12×32k − 11×16k 重叠） */
  .rune-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: calc((12 * 32px - 11 * 16px) * var(--k, 1));
    min-width: 0;
    padding-top: calc(8px * var(--k, 1));
    overflow: hidden;
  }
  .rune-row .slot {
    margin-left: calc(-16px * var(--k, 1));
    z-index: 1;
  }
  .rune-row .slot:first-child {
    margin-left: 0;
  }
  .bh-base {
    position: relative;
    flex: 1 1 auto;
    min-width: calc(150px * var(--k, 1));
    height: calc(62px * var(--k, 1));
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 14%, transparent);
  }
  /* 基地内单位：横排铺满基地框，过多时截断 */
  .base-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    min-width: 0;
    overflow: hidden;
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
