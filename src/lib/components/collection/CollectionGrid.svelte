<script lang="ts">
  import type { CardWithOwned } from '$lib/db'
  import CachedImage from '../cards/CachedImage.svelte'
  import { LoaderCircle } from '@lucide/svelte'

  let {
    cards = [] as CardWithOwned[],
    isLoading = false,
    loadingMore = false,
    hasMore = false,
    onCardClick = undefined as ((card: CardWithOwned) => void) | undefined,
    onLoadMore = undefined as (() => void) | undefined,
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
    <div class="loading-state">
      <LoaderCircle class="animate-spin" size={24} />
    </div>
  {:else if cards.length === 0}
    <div class="empty-state">
      <p>未找到匹配卡牌</p>
    </div>
  {:else}
    {#each cards as card (card.id)}
      {@const need = card.totalVariants}
      {@const owned = card.ownedVariants}
      {@const insufficient = owned < need}
      <button class="tile" onclick={() => onCardClick?.(card)} class:banned={card.is_banned}>
        <div class="img-wrap">
          <CachedImage
            src={card.card_prints?.[0]?.img_cdn ?? card.card_prints?.[0]?.tts_cdn ?? ''}
            name={`${card.id}-${card.card_prints?.[0]?.id || 'default'}`}
            borderRadius="6px"
            fit="cover"
            isLandscape={false}
          />
          {#if card.ownedFoil > 0}
            <span class="foil-badge">闪</span>
          {/if}
          {#if card.ownedTotal > 0}
            <span class="owned-badge">×{card.ownedTotal}</span>
          {/if}
        </div>
        <div class="tile-name">{card.card_name_cn}</div>
        <small class="tile-no">{card.card_no}</small>
        <div class="tile-owned" class:insufficient={insufficient}>
          持有 {owned} / 需 {need}
        </div>
      </button>
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
  }

  .tile:hover .img-wrap {
    transform: translateY(-2px);
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

  .loading-state,
  .empty-state {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: var(--text-secondary);
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
  }
</style>
