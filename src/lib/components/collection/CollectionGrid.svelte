<script lang="ts">
  import type { VariantWithOwned } from '$lib/db'
  import CachedImage from '../cards/CachedImage.svelte'
  import { LoaderCircle, Plus, Minus, Check } from '@lucide/svelte'
  import SkeletonGrid from './SkeletonGrid.svelte'
  import EmptyState from './EmptyState.svelte'
  import { t } from '$lib/i18n'

  let {
    cards = [] as VariantWithOwned[],
    isLoading = false,
    loadingMore = false,
    hasMore = false,
    onCardClick = undefined as ((card: VariantWithOwned) => void) | undefined,
    onLoadMore = undefined as (() => void) | undefined,
    quickEdit = false,
    onQuickInc = undefined as ((card: VariantWithOwned) => void) | undefined,
    onQuickDec = undefined as ((card: VariantWithOwned) => void) | undefined,
    batchMode = false,
    selectedIds = new Set<string>() as Set<string>,
    onToggleSelect = undefined as ((card: VariantWithOwned) => void) | undefined,
  } = $props()

  let sentinelEl = $state<HTMLElement | undefined>(undefined)

  function cardKey(card: VariantWithOwned): string {
    return `${card.cardId}:${card.cardNoExtend}`
  }

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

<div class="collection-grid" class:is-loading-container={isLoading && cards.length === 0}>
  {#if isLoading && cards.length === 0}
    <SkeletonGrid count={12} />
  {:else if cards.length === 0}
    <EmptyState title={$t('cards.noResults')} description={$t('cards.adjustFilters')} />
  {:else}
    {#each cards as card (cardKey(card))}
      {@const selected = selectedIds.has(cardKey(card))}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tile"
        class:selected
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
            src={card.imgCdn ?? card.ttsCdn ?? ''}
            name={`${card.cardNoExtend}-${card.printLanguage ?? 'default'}`}
            borderRadius="6px"
            fit="cover"
            isLandscape={false}
          />
          {#if batchMode}
            <span class="select-badge" class:checked={selected}>
              {#if selected}<Check size={11} strokeWidth={'5'} />{/if}
            </span>
          {:else}
            {#if card.ownedFoil > 0}
              <span class="foil-badge">{$t('collection.foilBadge')}</span>
            {/if}
            {#if card.ownedTotal > 0}
              <span class="owned-badge">{card.ownedTotal}</span>
            {/if}
          {/if}

          {#if quickEdit && !batchMode}
            <div class="quick-stepper">
              {#if card.ownedTotal > 0}
                <button
                  class="step-btn"
                  title="-1"
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
                  title="+1"
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
                  title={$t('collection.markOne')}
                  onclick={(e) => {
                    e.stopPropagation()
                    onQuickInc?.(card)
                  }}
                >
                  <Plus size={12} strokeWidth={'5'} />
                </button>
              {/if}
            </div>
          {/if}
        </div>
        <div class="tile-no-row">
          <span class="tile-no">{card.cardNoExtend}</span>
          {#if card.isCustom}
            <span class="custom-chip">{$t('collection.customChip')}</span>
          {/if}
          {#if card.bucket !== 'base'}
            <span class="bucket-chip">{$t('collection.bucket' + card.bucket[0].toUpperCase() + card.bucket.slice(1))}</span>
          {/if}
        </div>
        <!-- <div class="tile-owned" class:insufficient={card.ownedTotal === 0}>
          {card.ownedTotal > 0 ? `持有 ${card.ownedTotal}` : '未拥有'}
        </div> -->
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
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 14px;
    padding: 4px 2px 24px;
  }

  .collection-grid.is-loading-container {
    display: initial;
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

  /*.tile.selected {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
    border-radius: 10px;
  }*/

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
    bottom: 0;
    right: 0;
    z-index: 2;
    min-width: 36px;
    height: 28px;
    padding: 8px 4px 8px 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-md);
    font-weight: 700;
    color: #ffffff;
    background: var(--accent-color);
    border-top-left-radius: 9999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
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

  .tile-no-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
  }

  .tile-no {
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bucket-chip {
    flex-shrink: 0;
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    background: var(--bg-secondary);
  }

  .custom-chip {
    flex-shrink: 0;
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 99px;
    border: 1px solid rgba(168, 85, 247, 0.4);
    color: #a855f7;
    background: color-mix(in srgb, #a855f7 8%, var(--bg-primary));
  }

  /*.tile-rarity {
    color: var(--text-secondary);
    min-height: 1em;
  }

  .tile-owned {
    font-size: var(--text-xs);
    color: #22c55e;
  }

  .tile-owned.insufficient {
    color: #ef4444;
  }*/

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
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--bg-primary);
  }

  .sentinel {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 0;
    color: var(--text-secondary);
  }

  @media (max-width: 479.99px) {
    .collection-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }

    .quick-stepper {
      opacity: 1;
      pointer-events: auto;
    }

    .owned-badge {
      display: none;
    }
  }

  @media (hover: none) {
    .quick-stepper {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>
