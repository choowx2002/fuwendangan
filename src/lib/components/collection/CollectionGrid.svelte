<script lang="ts">
  import type { CardWithOwned } from '$lib/db'
  import CachedImage from '../cards/CachedImage.svelte'
  import { LoaderCircle, Plus, Minus, Check } from '@lucide/svelte'
  import SkeletonGrid from './SkeletonGrid.svelte'
  import EmptyState from './EmptyState.svelte'

  let {
    cards = [] as CardWithOwned[],
    isLoading = false,
    loadingMore = false,
    hasMore = false,
    onCardClick = undefined as ((card: CardWithOwned) => void) | undefined,
    onLoadMore = undefined as (() => void) | undefined,
    quickEdit = false,
    onQuickInc = undefined as ((card: CardWithOwned) => void) | undefined,
    onQuickDec = undefined as ((card: CardWithOwned) => void) | undefined,
    batchMode = false,
    selectedIds = new Set<string>() as Set<string>,
    onToggleSelect = undefined as ((card: CardWithOwned) => void) | undefined,
  } = $props()

  let sentinelEl = $state<HTMLElement | undefined>(undefined)

  $effect(() => {
    const el = sentinelEl
    if (!el || !onLoadMore) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && hasMore) onLoadMore()
      },
      { rootMargin: '300px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  })
</script>

<div class="collection-grid">
  {#if isLoading && cards.length === 0}
    <SkeletonGrid count={12} />
  {:else if cards.length === 0}
    <EmptyState
      title="未找到匹配卡牌"
      description="试试调整筛选条件或搜索关键词"
    />
  {:else}
    {#each cards as card (card.id)}
      {@const need = card.totalVariants}
      {@const owned = card.ownedVariants}
      {@const insufficient = owned < need}
      {@const selected = selectedIds.has(card.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tile"
        class:selected={selected}
        class:banned={card.is_banned}
        role="button"
        tabindex="0"
        onclick={() => {
          if (batchMode) {
            onToggleSelect?.(card)
          } else {
            onCardClick?.(card)
          }
        }}
      >
        <div class="img-wrap">
          <CachedImage
            src={card.card_prints?.[0]?.img_cdn ?? card.card_prints?.[0]?.tts_cdn ?? ''}
            name={`${card.id}-${card.card_prints?.[0]?.id || 'default'}`}
            borderRadius="6px"
            fit="cover"
            isLandscape={false}
          />
          {#if batchMode}
            <span class="select-badge" class:checked={selected}>
              {#if selected}<Check size={11} />{/if}
            </span>
          {:else}
            {#if card.ownedFoil > 0}
              <span class="foil-badge">闪</span>
            {/if}
            {#if card.ownedTotal > 0}
              <span class="owned-badge">×{card.ownedTotal}</span>
            {/if}
          {/if}

          {#if quickEdit && !batchMode}
            <div class="quick-stepper">
              {#if card.ownedTotal > 0}
                <button
                  class="step-btn"
                  title="普卡 -1"
                  onclick={(e) => {
                    e.stopPropagation()
                    onQuickDec?.(card)
                  }}
                  disabled={card.ownedTotal <= 0}
                >
                  <Minus size={12} />
                </button>
                <span class="step-qty">{card.ownedTotal}</span>
                <button
                  class="step-btn inc"
                  title="普卡 +1"
                  onclick={(e) => {
                    e.stopPropagation()
                    onQuickInc?.(card)
                  }}
                >
                  <Plus size={12} />
                </button>
              {:else}
                <button
                  class="step-btn inc wide"
                  title="标记拥有 1 张"
                  onclick={(e) => {
                    e.stopPropagation()
                    onQuickInc?.(card)
                  }}
                >
                  <Plus size={12} /> 拥有
                </button>
              {/if}
            </div>
          {/if}
        </div>
        <div class="tile-name">{card.card_name_cn}</div>
        <small class="tile-no">{card.card_no}</small>
        <div class="tile-owned" class:insufficient={insufficient}>
          持有 {owned} / 需 {need}
        </div>
      </div>
    {/each}

    {#if hasMore}
      <div bind:this={sentinelEl} class="sentinel">
        {#if loadingMore}
          <LoaderCircle class="animate-spin" size={16} />
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .collection-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
    padding: 4px 2px 24px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: center;
    position: relative;
    border-radius: 10px;
  }

  .tile:hover .img-wrap {
    transform: translateY(-2px);
  }

  .tile.selected {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
    border-radius: 10px;
  }

  .img-wrap {
    position: relative;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    transition: transform 0.15s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .foil-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    border-radius: 50%;
    background: linear-gradient(135deg, #facc15, #f59e0b, #fbbf24);
    color: #422006;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .owned-badge {
    position: absolute;
    bottom: 6px;
    right: 6px;
    padding: 2px 7px;
    font-size: var(--text-xs);
    border-radius: 99px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
  }

  .select-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 2px solid #fff;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
  }

  .select-badge.checked {
    background: var(--accent-color);
    border-color: var(--accent-color);
  }

  .tile-name {
    font-size: var(--text-sm);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tile-no {
    color: var(--text-secondary);
  }

  .tile-owned {
    font-size: var(--text-xs);
    color: #22c55e;
  }

  .tile-owned.insufficient {
    color: #ef4444;
  }

  .tile.banned .img-wrap {
    filter: grayscale(0.7);
  }

  .quick-stepper {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 99px;
    background: rgba(0, 0, 0, 0.72);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    z-index: 5;
    white-space: nowrap;
  }

  .tile:hover .quick-stepper {
    opacity: 1;
    pointer-events: auto;
  }

  .step-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    cursor: pointer;
  }

  .step-btn:hover {
    background: rgba(255, 255, 255, 0.32);
  }

  .step-btn.inc {
    background: var(--accent-color);
  }

  .step-btn.inc:hover {
    background: color-mix(in srgb, var(--accent-color) 80%, #000);
  }

  .step-btn.wide {
    width: auto;
    padding: 0 10px;
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .step-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .step-qty {
    min-width: 22px;
    text-align: center;
    font-size: var(--text-xs);
    font-weight: 700;
    color: #fff;
  }

  .sentinel {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 0;
    color: var(--text-secondary);
  }

  @media (max-width: 600.99px) {
    .collection-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }

    .quick-stepper {
      opacity: 1;
      pointer-events: auto;
    }
  }

  @media (hover: none) {
    .quick-stepper {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>
