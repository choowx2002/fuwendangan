<script lang="ts">
  import { draggable, droppable, type DragDropState } from '@thisux/sveltednd'
  import { Search, Plus, Trash2 } from '@lucide/svelte'
  import { searchCards, getBestPrint, printCacheName, type CardWithOwned } from '$lib/db'
  import {
    newChainItem,
    SIDE_DECK_KEY,
    type CardInstance,
    type ChainDragPayload,
    type ChainItem,
    type SimState,
  } from '$lib/simulator/chain'
  import { t } from '$lib/i18n'
  import Card from './Card.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'

  let {
    zones,
    cards,
    currentState,
    currentOwner = $bindable(0),
    playerColors = [],
    onOwnerChange,
    onDropToZone,
    onAddCustom,
    onclear,
    onpreview,
    onremove,
    onremovecard,
    onduplicate,
    onrotate,
    ontagchange,
    onedit,
  }: {
    zones: Record<string, CardInstance[]>
    cards: Record<string, CardWithOwned | null>
    currentState: SimState
    currentOwner?: number
    playerColors?: string[]
    onOwnerChange?: (owner: number) => void
    onDropToZone?: (zoneKey: string, state: DragDropState<ChainDragPayload>) => void
    onAddCustom?: (partial: Partial<CardInstance>) => void
    onclear?: (zoneKey: string) => void
    onpreview?: (item: CardInstance) => void
    onremove?: (zoneKey: string, item: CardInstance, target: 'discard' | 'banish') => void
    onremovecard?: (zoneKey: string, item: CardInstance) => void
    onduplicate?: (zoneKey: string, item: CardInstance) => void
    onrotate?: (zoneKey: string, item: CardInstance) => void
    ontagchange?: (zoneKey: string, item: CardInstance, tags: string[]) => void
    onedit?: (zoneKey: string, item: CardInstance) => void
  } = $props()

  let searchText = $state('')
  let searching = $state(false)
  let cardResults = $state<CardWithOwned[]>([])
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  let customName = $state('')
  let customNote = $state('')

  const handKey = $derived(`p${currentOwner}-hand`)
  const handItems = $derived(zones[handKey] ?? [])
  const sideDeckItems = $derived(zones[SIDE_DECK_KEY] ?? [])

  async function runSearch() {
    const keyword = searchText.trim()
    if (!keyword) {
      cardResults = []
      return
    }

    searching = true
    try {
      const res = await searchCards({ searchText: keyword, pageSize: 30, is_banned: false })
      cardResults = res.data
    } catch (err) {
      console.error('[chain-sim] 搜索失败', err)
      cardResults = []
    } finally {
      searching = false
    }
  }

  function onSearchInput() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runSearch, 300)
  }

  function makeSearchItem(card: CardWithOwned): ChainItem {
    return newChainItem({ cardNo: card.card_no, owner: currentOwner })
  }

  function handleHandDrop(state: DragDropState<ChainDragPayload>) {
    onDropToZone?.(handKey, state)
  }

  function submitCustom() {
    const name = customName.trim()
    if (!name) return
    onAddCustom?.({
      customName: name,
      customNote: customNote.trim() || null,
      owner: currentOwner,
    })
    customName = ''
    customNote = ''
  }
</script>

<div class="sidebar">
  <section class="side-section">
    <div class="side-title">{$t('simulator.players')}</div>
    <div class="owner-row">
      {#each Array.from({ length: currentState.playerCount }, (_, p) => p) as p (p)}
        <button
          type="button"
          class="owner-chip"
          class:active={currentOwner === p}
          style="--owner-color: {playerColors[p] ?? '#888'}"
          onclick={() => onOwnerChange?.(p)}
        >
          {$t('simulator.playerLabel', { values: { n: p + 1 } })}
        </button>
      {/each}
    </div>
  </section>

  <section class="side-section">
    <div class="side-title">{$t('simulator.searchCards')}</div>
    <div class="search-box">
      <Search size={14} class="search-icon" />
      <input
        class="side-input"
        type="text"
        placeholder={$t('simulator.searchCardPlaceholder')}
        bind:value={searchText}
        oninput={onSearchInput}
      />
    </div>

    {#if searching}
      <span class="side-hint">{$t('simulator.loadCardsBusy')}</span>
    {:else if cardResults.length > 0}
      <div class="result-list">
        {#each cardResults as card (card.card_no)}
          {@const item = makeSearchItem(card)}
          {@const best = getBestPrint(card)}
          <div
            class="card-result-row"
            use:draggable={{ container: 'search-results', dragData: item }}
          >
            {#if best?.url}
              <CardSimpleImage
                url={best.url}
                name={printCacheName(best)}
                className="result-thumb"
              />
            {:else}
              <span class="result-thumb result-thumb-fallback"></span>
            {/if}
            <div class="result-text">
              <span class="result-name">
                {card.card_name_cn || card.card_name_en || card.card_no}
              </span>
              {#if card.sub_title_cn || card.sub_title_en}
                <span class="result-subtitle">
                  {card.sub_title_cn || card.sub_title_en}
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="side-section">
    <div class="side-title">{$t('simulator.customCard')}</div>
    <div class="custom-form">
      <input
        class="side-input"
        type="text"
        placeholder={$t('simulator.customCardNamePlaceholder')}
        bind:value={customName}
      />
      <input
        class="side-input"
        type="text"
        placeholder={$t('simulator.customCardNotePlaceholder')}
        bind:value={customNote}
      />
      <button type="button" class="add-custom-btn" onclick={submitCustom}>
        <Plus size={14} /> {$t('simulator.addCustomCard')}
      </button>
    </div>
  </section>

  <section class="side-section">
    <div class="section-header">
      <span class="side-title">{$t('simulator.hand')}（{$t('simulator.playerLabel', { values: { n: currentOwner + 1 } })}）</span>
      <button
        type="button"
        class="clear-icon"
        title={$t('simulator.clearZone')}
        onclick={() => onclear?.(handKey)}
      >
        <Trash2 size={14} />
      </button>
    </div>
    <div
      class="mini-zone"
      use:droppable={{
        container: handKey,
        callbacks: { onDrop: handleHandDrop },
      }}
    >
      {#each handItems as item (item.id)}
        <Card
          {item}
          zoneKey={handKey}
          mode="image"
          card={item.cardNo ? cards[item.cardNo] : null}
          ownerColor={item.owner !== null && item.owner !== undefined
            ? (playerColors[item.owner] ?? '#888')
            : '#888'}
          playerLabel={item.owner !== null && item.owner !== undefined
            ? $t('simulator.playerLabel', { values: { n: (item.owner ?? 0) + 1 } })
            : $t('simulator.unmarked')}
          {onpreview}
          {onremove}
          {onremovecard}
          {onduplicate}
          {onrotate}
          {ontagchange}
          {onedit}
          showLabel={false}
        />
      {/each}
      <!-- {#if handItems.length === 0}
        <span class="side-hint">{$t('simulator.boxDropHint')}</span>
      {/if} -->
    </div>
  </section>

  <section class="side-section">
    <div class="section-header">
      <span class="side-title">{$t('simulator.sideDeck')}</span>
      <button
        type="button"
        class="clear-icon"
        title={$t('simulator.clearZone')}
        onclick={() => onclear?.(SIDE_DECK_KEY)}
      >
        <Trash2 size={14} />
      </button>
    </div>
    <div
      class="mini-zone"
      use:droppable={{
        container: SIDE_DECK_KEY,
        callbacks: {
          onDrop: (state: DragDropState<ChainDragPayload>) => onDropToZone?.(SIDE_DECK_KEY, state),
        },
      }}
    >
      {#each sideDeckItems as item (item.id)}
        <Card
          {item}
          zoneKey={SIDE_DECK_KEY}
          mode="image"
          card={item.cardNo ? cards[item.cardNo] : null}
          ownerColor={item.owner !== null && item.owner !== undefined
            ? (playerColors[item.owner] ?? '#888')
            : '#888'}
          playerLabel={item.owner !== null && item.owner !== undefined
            ? $t('simulator.playerLabel', { values: { n: (item.owner ?? 0) + 1 } })
            : $t('simulator.unmarked')}
          {onpreview}
          {onremove}
          {onremovecard}
          {onduplicate}
          {onrotate}
          {ontagchange}
          {onedit}
          showLabel={false}
        />
      {/each}
      <!-- {#if sideDeckItems.length === 0}
        <span class="side-hint">{$t('simulator.boxDropHint')}</span>
      {/if} -->
    </div>
  </section>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px;
  }

  .side-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .side-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .clear-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .clear-icon:hover {
    color: var(--danger-color, #e5484d);
    background: var(--bg-hover);
  }

  .owner-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .owner-chip {
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--surface);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .owner-chip.active {
    color: var(--owner-color);
    border-color: var(--owner-color);
    background: color-mix(in srgb, var(--owner-color) 12%, transparent);
  }

  .search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  :global(.search-icon) {
    position: absolute;
    left: 8px;
    color: var(--text-tertiary);
    pointer-events: none;
  }

  .side-input {
    width: 100%;
    padding: 8px 10px 8px 30px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: var(--text-sm);
    outline: none;
  }

  .side-input:focus {
    border-color: var(--accent-color);
  }

  .side-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-align: center;
    padding: 6px 0;
  }

  .result-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 260px;
    overflow-y: auto;
  }

  .card-result-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: grab;
  }

  .card-result-row:hover {
    background: var(--bg-hover);
    border-color: var(--border-color);
  }

  :global(.result-thumb) {
    width: 44px;
    height: 62px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
    background: var(--surface-muted);
  }

  .result-thumb-fallback {
    display: block;
    width: 44px;
    height: 62px;
    border-radius: 4px;
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
  }

  .result-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .result-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-subtitle {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .custom-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .add-custom-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .add-custom-btn:hover {
    border-color: var(--accent-color);
  }

  .mini-zone {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
    gap: 6px;
    padding: 6px;
    min-height: 70px;
    border: 1px dashed var(--border-color);
    border-radius: 10px;
    background: var(--bg-secondary);
  }
</style>
