<script lang="ts">
  import { flip } from 'svelte/animate'
  import { draggable, droppable, type DragDropState } from '@thisux/sveltednd'
  import { newChainItem, POOL_KEY, type ChainItem } from '$lib/simulator/chain'
  import { isCardPayload, type ChainDragPayload } from '$lib/simulator/chain'
  import type { CardWithOwned } from '$lib/db'
  import { searchCards } from '$lib/db'
  import { t } from '$lib/i18n'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import ChainItemCard from './ChainItemCard.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { getBestPrint, printCacheName } from '$lib/db'

  let {
    playerCount,
    currentOwner = $bindable(0),
    pool = $bindable([]),
    cards = {},
    playerColors = [],
    onAddCustom = null,
    onPoolDrop = null,
    onItemClick = null,
  }: {
    playerCount: number
    currentOwner?: number
    pool?: ChainItem[]
    cards?: Record<string, CardWithOwned | null>
    playerColors?: string[]
    onAddCustom?: ((p: Partial<ChainItem>) => void) | null
    onPoolDrop?: ((items: ChainItem[]) => void) | null
    onItemClick?: ((item: ChainItem) => void) | null
  } = $props()

  let searchText = $state('')
  let results = $state<CardWithOwned[]>([])
  let searching = $state(false)
  let searched = $state(false)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  let customName = $state('')
  let customNote = $state('')

  const owners = $derived(Array.from({ length: playerCount }, (_, i) => i))

  interface SearchResult {
    card: CardWithOwned
    item: ChainItem
  }

  async function runSearch() {
    const keyword = searchText.trim()
    if (!keyword) {
      results = []
      searched = false
      return
    }
    searching = true
    try {
      const res = await searchCards({ searchText: keyword, pageSize: 30, is_banned: false })
      results = res.data
      searched = true
    } catch (err) {
      console.error('[chain-sim] 搜索失败:', err)
      results = []
      searched = true
    } finally {
      searching = false
    }
  }

  function onSearchInput() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runSearch, 300)
  }

  // 搜索结果拖拽条目：随搜索结果 / 当前玩家更新重建
  let searchResults = $state<SearchResult[]>([])

  $effect(() => {
    searchResults = results.map((card) => ({
      card,
      item: newChainItem({ cardNo: card.card_no, owner: currentOwner }),
    }))
  })

  // 本地状态，用于平滑拖拽体验
  let poolItems = $state([...pool])

  $effect(() => {
    if (poolItems.length !== pool.length || poolItems.some((it, i) => it.id !== pool[i]?.id)) {
      poolItems = [...pool]
    }
  })

  function handlePoolDrop(state: DragDropState<ChainDragPayload>) {
    const { draggedItem, targetContainer, dropPosition } = state

    // 从看板列拖回时载荷为 { card, columnId }，归一为裸 ChainItem
    const item = isCardPayload(draggedItem) ? draggedItem.card : draggedItem

    // 拖拽源在池内的索引；从外部容器（搜索结果/看板列）拖入时为 -1
    const dragIndex = poolItems.findIndex((i) => i.id === item.id)

    // 目标为池内某个条目时，其 container 即索引；拖到空白区 / 外部容器时追加到末尾
    const target = targetContainer === null ? NaN : Number.parseInt(targetContainer, 10)
    let dropIndex = Number.isNaN(target) ? poolItems.length : target
    if (dropPosition === 'after') dropIndex++

    let next: ChainItem[]
    if (dragIndex !== -1) {
      // 池内排序：splice 移出后再插入，dragIndex < dropIndex 时需偏移 -1
      const [moved] = poolItems.splice(dragIndex, 1)
      const adjusted = dragIndex < dropIndex ? dropIndex - 1 : dropIndex
      poolItems.splice(adjusted, 0, moved)
      next = [...poolItems]
    } else {
      // 从外部拖入，插入到目标位置
      next = [...poolItems.slice(0, dropIndex), item, ...poolItems.slice(dropIndex)]
      poolItems = next
    }
    onPoolDrop?.(next) // 通知父组件更新全局状态
  }

  function removePoolItem(item: ChainItem) {
    const newItems = poolItems.filter((i) => i.id !== item.id)
    poolItems = newItems
    onPoolDrop?.(newItems)
  }

  function submitCustom() {
    const name = customName.trim()
    if (!name) {
      showToast($t('simulator.customNamePlaceholder'), 'info')
      return
    }
    onAddCustom?.({
      customName: name,
      customNote: customNote.trim() || null,
    })
    customName = ''
    customNote = ''
  }
</script>

<div class="chain-sidebar">
  <section class="side-section">
    <div class="side-title">{$t('simulator.players')}</div>
    <div class="owner-row">
      {#each owners as p (p)}
        <button
          type="button"
          class="owner-chip"
          class:active={currentOwner === p}
          style="--owner-color: {playerColors[p] ?? '#888'}"
          onclick={() => (currentOwner = p)}
        >
          {$t('simulator.playerLabel', { values: { n: p + 1 } })}
        </button>
      {/each}
    </div>
  </section>

  <section class="side-section">
    <div class="side-title">{$t('simulator.searchCards')}</div>
    <input
      class="side-input"
      type="text"
      placeholder={$t('simulator.searchPlaceholder')}
      bind:value={searchText}
      oninput={onSearchInput}
    />
    {#if searching}
      <span class="side-hint">{$t('simulator.loadCardsBusy')}</span>
    {:else if results.length > 0}
      <span class="side-hint">{$t('simulator.dragToAddHint')}</span>
      <div class="result-list">
        {#each searchResults as r (r.item.id)}
          {@const best = getBestPrint(r.card)}
          <div class="result-row" use:draggable={{ container: 'search-results', dragData: r.item }}>
            {#if best?.url}
              <CardSimpleImage
                url={best.url}
                name={printCacheName(best)}
                className="result-thumb"
              />
            {:else}
              <span class="result-thumb result-thumb-fallback"></span>
            {/if}
            <span class="result-name">
              {r.card.card_name_cn || r.card.card_name_en || r.card.card_no}
            </span>
          </div>
        {/each}
      </div>
    {:else if searched && searchText.trim()}
      <span class="side-hint">{$t('simulator.noResult')}</span>
    {/if}
  </section>

  <section class="side-section">
    <div class="side-title">{$t('simulator.customPool')}</div>
    <div class="custom-form">
      <input
        class="side-input"
        type="text"
        placeholder={$t('simulator.customNamePlaceholder')}
        bind:value={customName}
      />
      <input
        class="side-input"
        type="text"
        placeholder={$t('simulator.customNotePlaceholder')}
        bind:value={customNote}
      />
      <button type="button" class="button button-primary button-sm" onclick={submitCustom}>
        {$t('simulator.addCustom')}
      </button>
    </div>

    <!-- 拖拽区域：允许从外部拖入，也允许拖出 -->
    <div
      class="pool-list"
      class:is-empty={poolItems.length === 0}
      use:droppable={{
        container: POOL_KEY,
        callbacks: { onDrop: handlePoolDrop },
      }}
    >
      {#each poolItems as item, index (item.id)}
        <div
          class="pool-item"
          use:draggable={{ container: index.toString(), dragData: item }}
          use:droppable={{
            container: index.toString(),
            direction: 'grid',
            callbacks: { onDrop: handlePoolDrop },
          }}
          animate:flip={{ duration: 200 }}
          role="button"
          tabindex="0"
          onclick={() => onItemClick?.(item)}
          oncontextmenu={(e) => {
            e.preventDefault()
            removePoolItem(item)
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onItemClick?.(item)
            }
          }}
        >
          <ChainItemCard
            {item}
            mode="text"
            card={item.cardNo ? cards[item.cardNo] : null}
            ownerColor={item.owner !== null && item.owner !== undefined
              ? (playerColors[item.owner] ?? '')
              : ''}
            playerLabel={item.owner !== null && item.owner !== undefined
              ? $t('simulator.playerLabel', { values: { n: item.owner + 1 } })
              : ''}
          />
        </div>
      {/each}

      <!-- 视觉提示：当卡池为空时，提示用户可以拖拽卡牌到这里 -->
      {#if poolItems.length === 0}
        <span class="side-hint drop-zone-hint">
          <span class="icon">⇅</span>
          {$t('simulator.dragHereToRemove') || '拖拽卡牌到此处回收'}
        </span>
      {/if}
    </div>
  </section>
</div>

<style>
  /* ... 保持之前的样式不变 ... */
  .chain-sidebar {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .side-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .side-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
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
  .side-input {
    width: 100%;
    padding: 8px 10px;
    font-size: var(--text-sm);
    font-family: inherit;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
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
    max-height: 300px;
    overflow-y: auto;
  }
  .result-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    cursor: grab;
    text-align: left;
    user-select: none;
  }
  .result-row:hover {
    background: var(--bg-hover);
    border-color: var(--border-color);
  }
  .result-row:active {
    cursor: grabbing;
  }
  .result-thumb-fallback {
    display: block;
  }
  :global(.result-thumb) {
    width: 40px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
    background: var(--surface-muted);
  }
  .result-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .custom-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pool-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, 100px);
    gap: 8px;
    padding: 10px;
    min-height: 80px; /* 增加最小高度，让空状态下的拖拽提示更容易被触发 */
    max-height: 300px;
    overflow-y: auto;
    border: 2px dashed transparent;
    border-radius: 8px;
    transition:
      border-color 0.2s,
      background-color 0.2s;
    align-content: start;
    justify-content: start;
  }

  /* 拖拽视觉反馈：当卡池为空时，显示虚线框提示 */
  .pool-list.is-empty {
    border-color: var(--border-subtle);
    background: var(--bg-hover);
  }

  .drop-zone-hint {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 16px 0;
    color: var(--text-tertiary);
    pointer-events: none; /* 让鼠标事件穿透，确保 droppable 能接收到 drop */
  }

  .drop-zone-hint .icon {
    font-size: 20px;
    opacity: 0.6;
  }

  .pool-item {
    width: 100%;
    border-radius: 8px;
    background: var(--surface);
    cursor: grab;
    user-select: none;
    border: 1px solid var(--border-subtle);
  }
  .pool-item:hover {
    border-color: var(--accent-color);
  }
  .pool-item:active {
    cursor: grabbing;
  }
</style>
