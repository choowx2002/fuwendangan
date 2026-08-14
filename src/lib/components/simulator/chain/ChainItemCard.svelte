<script lang="ts">
  import type { ChainItem, DisplayMode } from '$lib/simulator/chain'
  import type { CardWithOwned } from '$lib/db'
  import { getBestPrint, printCacheName } from '$lib/db'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'

  let {
    item,
    mode = 'text',
    card = null,
    ownerColor = '',
    playerLabel = '',
    zoomable = false,
  }: {
    item: ChainItem
    mode?: DisplayMode
    card?: CardWithOwned | null
    ownerColor?: string
    playerLabel?: string
    zoomable?: boolean
  } = $props()

  const displayName = $derived(
    card
      ? card.card_name_cn || card.card_name_en || item.cardNo || ''
      : item.customName || item.cardNo || ''
  )
  const best = $derived(card ? getBestPrint(card) : null)
  const showImage = $derived(mode === 'image' || mode === 'both')
  const showText = $derived(mode === 'text' || mode === 'both')
</script>

<div class="chain-item-card" class:zoomable>
  {#if showImage && best?.url}
    <div class="item-img-wrap">
      <CardSimpleImage
        url={best.url}
        name={printCacheName(best)}
        className="item-img"
        fallback="/blue.jpg"
      />
    </div>
  {/if}

  {#if showText}
    <div class="item-text">
      {#if item.owner !== undefined && item.owner !== null && ownerColor}
        <span
          class="owner-chip"
          style="--owner-color: {ownerColor}"
          title={playerLabel}
        >
          {playerLabel}
        </span>
      {/if}
      <span class="item-name">{displayName || item.id}</span>
      {#if item.customNote}
        <span class="item-note">{item.customNote}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chain-item-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%; /* 完美适应 100px 的 grid cell */
    min-width: 0;
    pointer-events: auto;
  }

  .chain-item-card.zoomable {
    cursor: pointer;
  }

  .item-img-wrap {
    width: 100%;
    aspect-ratio: 3 / 4.2; /* 标准卡牌比例 */
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    background: var(--surface-muted);
    flex-shrink: 0;
  }

  :global(.item-img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .item-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .item-name {
    font-size: var(--text-xs); /* 在 100px 宽度下使用稍小的字体以防换行过多 */
    color: var(--text-primary);
    line-height: 1.3;
    word-break: break-all;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .item-note {
    font-size: 10px;
    color: var(--text-tertiary);
    line-height: 1.2;
    word-break: break-all;
  }

  .owner-chip {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 2px;
    padding: 1px 5px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    color: var(--owner-color);
    background: color-mix(in srgb, var(--owner-color) 15%, transparent);
    flex-shrink: 0;
  }
</style>
