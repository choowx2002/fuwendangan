<script lang="ts">
  import { searchCards, getFilterOptions } from '$lib/db'
  import SearchBar from './SearchBar.svelte'
  import FilterPanel from './FilterPanel.svelte'
  import CardItem from './CardItem.svelte'
  import type {
    ActiveFilter,
    CardBase,
    CardPrint,
    FilterOptions,
    NumberRange,
    SortKeyItem,
  } from '$lib/db/types'
  import { LoaderCircle, SlidersHorizontal } from '@lucide/svelte'
  import { buildSearchParams } from '$lib/db/helper'
  import { onMount } from 'svelte'
  import SortModal from './SortModal.svelte'
  import { beforeNavigate } from '$app/navigation'
  type cardAndPrint = CardBase & { card_prints: CardPrint[] }
  // --- 组件 Props ---
  let {
    onCardClick, // 外部传入的点击回调（查看详情 or 加入卡组）
    deckCards = [], // 当前卡组卡牌（用于 Deck Builder 显示数量）
    showDeckCount = false, // 是否显示卡组中已有的数量
    displayedCards = $bindable<CardBase[]>([]),
  }: {
    onCardClick?: (arg0: cardAndPrint) => void
    deckCards?: cardAndPrint[]
    showDeckCount?: boolean
    displayedCards?: CardBase[]
  } = $props()

  // --- 基础状态 ---
  let filterOptions = $state<FilterOptions | null>(null)
  let activeFilters = $state<ActiveFilter[]>([])
  let currentSearchText = $state('')
  let isFilterOpen = $state(false)
  let energy = $state<NumberRange>({ min: 0, max: 12 })
  let power = $state<NumberRange>({ min: 0, max: 12 })
  let return_energy = $state<NumberRange>({ min: 0, max: 4 })

  // --- 无限滚动专属状态 ---
  let currentPage = $state(1)
  let hasMore = $state(true)
  let isLoading = $state(true)
  let isLoadingMore = $state(false)
  let pageSize = 36
  let totalCards = $state(0)

  // --- 排序方式 ---
  let sortList = $state<SortKeyItem[]>([{ id: 1, name: 'card_no', isAsc: true, order: 1 }])

  function onChangeSort() {
    performSearch()
  }

  function observeSentinel(node: HTMLDivElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isLoading) {
          performSearch(true)
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(node)
    return {
      destroy() {
        observer.disconnect()
      },
    }
  }

  // --- 初始化 ---
  $effect(() => {
    async function init() {
      filterOptions = await getFilterOptions()
      await performSearch()
    }
    init()
  })

  // --- 核心搜索逻辑 ---
  async function performSearch(isLoadMore = false) {
    if (isLoadingMore) return

    if (!isLoadMore) {
      currentPage = 1
      displayedCards = []
      hasMore = true
      isLoading = true
    } else {
      isLoadingMore = true
    }

    try {
      const params = buildSearchParams(
        activeFilters,
        currentSearchText,
        currentPage,
        pageSize,
        sortList,
        energy,
        return_energy,
        power
      )

      const result = await searchCards(params)
      totalCards = result.total
      if (isLoadMore) {
        displayedCards = [...displayedCards, ...result.data]
      } else {
        displayedCards = result.data
      }

      hasMore = displayedCards.length < result.total
      console.log($state.snapshot(displayedCards))
      currentPage++
    } catch (e) {
      console.error('搜索失败:', e)
    } finally {
      isLoading = false
      isLoadingMore = false
    }
  }

  // --- 事件处理 ---
  function handleTextSearch(text: string) {
    currentSearchText = text
    performSearch()
  }

  function handleToggleFilter(type: ActiveFilter['type'], value: string) {
    const existingIndex = activeFilters.findIndex((f) => f.type === type && f.value === value)
    let newFilters = [...activeFilters]

    if (existingIndex === -1) {
      newFilters.push({ type, value, mode: 'include' })
    } else {
      const current = newFilters[existingIndex]
      if (current.mode === 'include') newFilters[existingIndex] = { ...current, mode: 'require' }
      else if (current.mode === 'require')
        newFilters[existingIndex] = { ...current, mode: 'exclude' }
      else newFilters.splice(existingIndex, 1)
    }

    activeFilters = newFilters
  }

  function handleRemoveFilter(type: ActiveFilter['type'], value: string) {
    activeFilters = activeFilters.filter((f) => !(f.type === type && f.value === value))
  }

  function handleClearFilter() {
    activeFilters = []
  }

  function handleAddFromPopdown(filter: ActiveFilter) {
    if (!activeFilters.some((f) => f.value === filter.value && f.type === filter.type)) {
      activeFilters = [...activeFilters, { ...filter, mode: 'include' }]
      performSearch()
    }
  }

  // 处理卡牌点击，抛给外部
  function handleCardClick(card: cardAndPrint) {
    if (onCardClick) {
      onCardClick(card)
    }
  }

  // 计算卡组中该卡的数量
  function getDeckCount(cardId: string | number): number {
    if (!showDeckCount || !deckCards) return 0
    return deckCards.filter((c) => c.id === cardId).length
  }

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        isFilterOpen = !isFilterOpen
        if (!isFilterOpen) performSearch()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  })

  const totalActiveCount = $derived.by(() => {
    let count = activeFilters.length

    const isRangeActive = (current: NumberRange, globalRange?: { min: number; max: number }) => {
      if (!globalRange) return false
      return current.min > globalRange.min || current.max < globalRange.max
    }

    if (isRangeActive(energy, filterOptions?.energy_range)) count++
    if (isRangeActive(power, filterOptions?.power_range)) count++
    if (isRangeActive(return_energy, filterOptions?.return_energy_range)) count++

    return count
  })

  beforeNavigate(({ cancel }) => {
    if (isFilterOpen) {
      isFilterOpen = false
      cancel()
    }
  })
</script>

<div class="card-pool-wrapper">
  <header class="search-header">
    <div class="search-wrapper">
      <SearchBar
        {filterOptions}
        onAddFilter={handleAddFromPopdown}
        onTextSearch={handleTextSearch}
      />
    </div>
    <h2 style="font-size: var(--text-base);color: var(--text-secondary)">数量：{totalCards}</h2>
    <SortModal bind:sortByList={sortList} onChangeSubmit={onChangeSort}></SortModal>

    <button class="filter-toggle-btn" onclick={() => (isFilterOpen = true)}>
      <SlidersHorizontal size={18} />
      <span>筛选</span>
      {#if totalActiveCount > 0}
        <span class="badge">{totalActiveCount}</span>
      {/if}
    </button>
  </header>

  <section class="results-area">
    {#if isLoading && displayedCards.length === 0}
      <div class="loading-state">
        <LoaderCircle class="animate-spin" size={24} />
      </div>
    {:else if displayedCards.length > 0}
      <div class="card-grid">
        {#each displayedCards as card (card.id)}
          <div
            class:isBanned={card.is_banned}
            role="presentation"
            onclick={() => handleCardClick(card as any)}
          >
            <CardItem {card} />
            {#if showDeckCount}
              {@const count = getDeckCount(card.id)}
              {#if count > 0}
                <span class="deck-count">×{count}</span>
              {/if}
            {/if}
          </div>
        {/each}
      </div>

      <div class="bottom-status">
        {#if isLoadingMore}
          <div class="loading-more">
            <LoaderCircle class="animate-spin" size={16} />
            <span>正在加载更多...</span>
          </div>
        {:else if !hasMore}
          <div class="no-more">
            <span>—— 已经到底啦 ——</span>
          </div>
        {/if}

        <div use:observeSentinel class="sentinel"></div>
      </div>
    {:else}
      <div class="empty-state">
        <p>未找到匹配卡牌</p>
      </div>
    {/if}
  </section>

  <FilterPanel
    isOpen={isFilterOpen}
    {filterOptions}
    {activeFilters}
    onToggle={handleToggleFilter}
    onRemove={handleRemoveFilter}
    onClear={handleClearFilter}
    onClose={() => {
      isFilterOpen = false
      performSearch()
    }}
    bind:energy
    bind:power
    bind:return_energy
  />
</div>

<style>
  .card-pool-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .deck-count {
    position: absolute;
    top: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
  }

  .search-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-bottom: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .search-wrapper {
    flex: 1;
  }

  .filter-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
    box-shadow: 0 1px 4px 0px rgba(0, 0, 0, 0.05);
  }

  .filter-toggle-btn:hover {
    background: var(--bg-hover);
    border-color: #d3d1cb;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    background: var(--accent-color);
    color: white;
    border-radius: 9px;
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .results-area {
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
    padding-top: 12px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 16px;
    scroll-behavior: smooth;
  }

  .isBanned {
    filter: grayscale(80%);
  }

  /* ================= 底部状态与哨兵 ================= */
  .bottom-status {
    margin-top: 24px;
    padding-bottom: 24px; /* 留出底部安全距离 */
  }

  .loading-more,
  .no-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px 0;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  /* 哨兵元素：高度极小，不可见，仅用于被 Observer 监测 */
  .sentinel {
    height: 1px;
    width: 100%;
  }

  /* ================= 移动端适配 ================= */
  @media (max-width: 767.99px) {
    /* .main-content {
      padding: 16px;
      padding-bottom: 0;
    } */
    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }

    .search-wrapper {
      flex: 0 0 100%;
    }
  }

  @media (min-width: 1079.99px) {
    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    }
  }

  @media (min-width: 1919.99px) {
    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    }
  }

  .loading-state,
  .empty-state {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 300px;
    color: var(--text-tertiary);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  :global(.animate-spin) {
    animation: spin 1s linear infinite;
  }
</style>
