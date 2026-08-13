<script lang="ts">
  import type { CardWithOwned } from '$lib/db'
  import { searchCards } from '$lib/db'
  import { Search, LoaderCircle, CornerDownLeft } from '@lucide/svelte'
  import CachedImage from '../cards/CachedImage.svelte'
  import { printCacheName } from '$lib/db/helper'
  import { seriesCodeOfCard } from '$lib/collection/collection-utils'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  let {
    placeholder = get(t)('collection.searchCards'),
    onSelect = undefined as ((card: CardWithOwned) => void) | undefined,
  } = $props()

  let text = $state('')
  let results = $state<CardWithOwned[]>([])
  let open = $state(false)
  let loading = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function scheduleSearch() {
    clearTimeout(timer)
    if (!text.trim()) {
      results = []
      open = false
      return
    }
    timer = setTimeout(() => void runSearch(), 250)
  }

  async function runSearch() {
    loading = true
    try {
      const res = await searchCards({ searchText: text.trim(), pageSize: 8, includeOwned: true })
      results = res.data
      open = true
    } finally {
      loading = false
    }
  }

  function pick(card: CardWithOwned) {
    text = ''
    results = []
    open = false
    onSelect?.(card)
  }
</script>

<div class="global-search">
  <div class="search-bar search-bar--sm">
    <Search size={15} class="search-bar-icon" />
    <input
      class="search-bar-input"
      bind:value={text}
      {placeholder}
      oninput={scheduleSearch}
      onfocus={() => {
        if (text.trim() && results.length > 0) open = true
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' && results.length > 0) pick(results[0])
        if (e.key === 'Escape') {
          text = ''
          results = []
          open = false
        }
      }}
    />
    {#if loading}
      <LoaderCircle size={14} class="animate-spin search-spin" />
    {/if}
  </div>

  {#if open}
    <div class="results">
      {#if results.length === 0}
        <p class="result-empty">{$t('cards.noResults')}</p>
      {:else}
        {#each results as card (card.id)}
          <button class="result-item" onclick={() => pick(card)}>
            <div class="result-img">
              <CachedImage
                src={card.card_prints?.[0]?.img_cdn ?? card.card_prints?.[0]?.tts_cdn ?? ''}
                name={printCacheName(card.card_prints?.[0])}
                borderRadius="5px"
                fit="cover"
                isLandscape={false}
              />
            </div>
            <div class="result-info">
              <span class="result-name">{card.card_name_cn}</span>
              <span class="result-no">{card.card_no}</span>
            </div>
            <span class="result-series">{seriesCodeOfCard(card)}</span>
          </button>
        {/each}
        <p class="result-hint">
          <CornerDownLeft size={11} /> {$t('collection.enterFirst')}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .global-search {
    position: relative;
    width: 100%;
    /* max-width: 340px; */
  }

  .results {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 50;
    max-height: 380px;
    overflow-y: auto;
    padding: 6px;
    border-radius: 12px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .result-item:hover {
    background: var(--bg-secondary);
  }

  .result-img {
    width: 34px;
    flex-shrink: 0;
    border-radius: 5px;
    overflow: hidden;
  }

  .result-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .result-name {
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-no {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .result-series {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .result-empty {
    margin: 0;
    padding: 18px 8px;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .result-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    margin: 4px 0 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
</style>
