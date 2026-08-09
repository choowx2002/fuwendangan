<script lang="ts">
  import { searchCards, getFilterOptions } from '$lib/db'
  import SearchBar from './SearchBar.svelte'
  import FilterPanel from './FilterPanel.svelte'
  import type {
    ActiveFilter,
    CardBase,
    CardPrint,
    FilterOptions,
    NumberRange,
    SortKeyItem,
  } from '$lib/db/types'
  import { ChevronDown, ChevronUp, LoaderCircle, SlidersHorizontal } from '@lucide/svelte'
  import { buildSearchParams, printCacheName } from '$lib/db/helper'
  import { onMount, tick } from 'svelte'
  import SortModal from './SortModal.svelte'
  import { page } from '$app/state'
  import CachedImage from './CachedImage.svelte'
  import type { ZoneKey } from '$lib/decks/zone'
  import { t } from '$lib/i18n'

  type cardAndPrint = CardBase & { card_prints: CardPrint[] }
  // --- 组件 Props ---
  let {
    onCardClick, // 外部传入的点击回调（查看详情 or 加入卡组）
    onMenuClick,
    deckCards = [], // 当前卡组卡牌（用于 Deck Builder 显示数量）
    showDeckCount = false, // 是否显示卡组中已有的数量
    displayedCards = $bindable<CardBase[]>([]),
    isFilterOpen = $bindable(false),
    zone = $bindable('legend'),
  }: {
    onCardClick?: (arg0: cardAndPrint) => void
    onMenuClick?: (id: string, zone: ZoneKey) => void
    deckCards?: cardAndPrint[]
    showDeckCount?: boolean
    displayedCards?: CardBase[]
    isFilterOpen?: boolean
    zone?: ZoneKey
  } = $props()

  // --- 基础状态 ---
  let filterOptions = $state<FilterOptions | null>(null)
  let activeFilters = $state<ActiveFilter[]>([])
  let currentSearchText = $state('')
  let champion_tag = $state('')
  let showZone = $state(false)
  let isMobileSmall = $state(false)
  let expandedFilter = $state(false)

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

      const result = await searchCards({ ...params, champion_tag })
      totalCards = result.total
      if (isLoadMore) {
        displayedCards = [...displayedCards, ...result.data]
      } else {
        displayedCards = result.data
      }

      hasMore = displayedCards.length < result.total

      await tick()
      if (displayedCards.length > 0 && currentPage == 1) {
        const firstItem = document.getElementById(displayedCards[0].id)
        if (firstItem) {
          firstItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      }

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

  let isLandscape = $derived.by(() => {
    return displayedCards.every((c) => c.card_category?.findIndex((cat) => cat === '战场') !== -1)
  })

  onMount(() => {
    async function updateLayoutMode() {
      isMobileSmall = window.innerWidth < 479.99
    }

    updateLayoutMode()

    if (['/decks/builder'].includes(page.url.pathname)) {
      showZone = true
      changeZone('legend')
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        isFilterOpen = !isFilterOpen
        if (!isFilterOpen) performSearch()
      }
    }

    window.addEventListener('resize', updateLayoutMode)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updateLayoutMode)
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

  let previousZone = $state(zone)

  $effect(() => {
    if (zone !== previousZone) {
      const needFilter = !(
        [previousZone, zone].includes('mainDeck') && [previousZone, zone].includes('sideboard')
      )

      if (needFilter) {
        addZoneFilter(zone)
      }

      const targetElement = document.getElementById(`zone-${zone}`)
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }

      previousZone = zone
    }
  })

  function changeZone(z: ZoneKey, e?: MouseEvent) {
    if (zone === z) return

    if (e) {
      const button = e.currentTarget as HTMLElement
      button.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    }

    zone = z
  }

  function addZoneFilter(z: string) {
    handleClearFilter()
    currentSearchText = ''
    champion_tag = ''
    switch (z) {
      case 'legend':
        activeFilters.push({ type: 'card_category', value: '传奇', mode: 'require' })
        break
      case 'champion': {
        activeFilters.push({ type: 'card_category', value: '英雄单位', mode: 'require' })
        const legend = deckCards.find((c) => c.card_category?.includes('传奇'))
        if (legend && legend?.champion_tag) {
          currentSearchText = legend.champion_tag
          legend.card_color_list?.forEach((color) => {
            activeFilters.push({ type: 'card_color_list', value: color, mode: 'include' })
          })
        }
        break
      }

      case 'mainDeck':
      case 'sideboard': {
        activeFilters.push(
          { type: 'card_category', value: '英雄单位', mode: 'include' },
          { type: 'card_category', value: '单位', mode: 'include' },
          { type: 'card_category', value: '法术', mode: 'include' },
          { type: 'card_category', value: '装备', mode: 'include' },
          { type: 'card_category', value: '专属单位', mode: 'include' },
          { type: 'card_category', value: '专属法术', mode: 'include' },
          { type: 'card_category', value: '专属装备', mode: 'include' }
        )
        const legend = deckCards.find((c) => c.card_category?.includes('传奇'))
        if (legend && legend?.champion_tag) {
          champion_tag = legend.champion_tag
          legend.card_color_list?.forEach((color) => {
            activeFilters.push({ type: 'card_color_list', value: color, mode: 'include' })
          })
        }
        break
      }

      case 'battlefields':
        activeFilters.push({ type: 'card_category', value: '战场', mode: 'require' })
        break

      case 'runes':
        {
          activeFilters.push({ type: 'card_category', value: '符文', mode: 'require' })
          const legend = deckCards.find((c) => c.card_category?.includes('传奇'))
          if (legend) {
            legend.card_color_list?.forEach((color) => {
              activeFilters.push({ type: 'card_color_list', value: color, mode: 'include' })
            })
          }
        }
        break

      default:
        break
    }

    performSearch()
  }

  const getDefaultImg = (card: cardAndPrint) => {
    return (
      card.card_prints?.find((p) => p.is_default) ??
      card.card_prints?.find((p) => p.card_no_extend === card.card_no && p.language === 'SC')
    )
  }
</script>

<div class="card-pool-wrapper">
  <header class="search-header">
    {#if showZone}
      <div class="deck-zone-tabs">
        <button
          class:active={zone === 'legend'}
          onclick={(e) => {
            changeZone('legend', e)
          }}>{$t('builder.legend')}</button
        >
        <button
          class:active={zone === 'champion'}
          onclick={(e) => {
            changeZone('champion', e)
          }}>{$t('builder.champion')}</button
        >
        <button
          class:active={zone === 'mainDeck'}
          onclick={(e) => {
            changeZone('mainDeck', e)
          }}>{$t('builder.mainDeck')}</button
        >
        <button
          class:active={zone === 'battlefields'}
          onclick={(e) => {
            changeZone('battlefields', e)
          }}>{$t('builder.battlefields')}</button
        >
        <button
          class:active={zone === 'runes'}
          onclick={(e) => {
            changeZone('runes', e)
          }}>{$t('builder.runes')}</button
        >
        <button
          class:active={zone === 'sideboard'}
          onclick={(e) => {
            changeZone('sideboard', e)
          }}>{$t('builder.sideboard')}</button
        >
      </div>
    {/if}
    <div class="search-wrapper">
      <SearchBar
        {filterOptions}
        onAddFilter={handleAddFromPopdown}
        onTextSearch={handleTextSearch}
      />
      {#if isMobileSmall}
        {#if expandedFilter}
          <ChevronUp
            style="user-select: none;"
            onclick={() => (expandedFilter = !expandedFilter)}
          />
        {:else}
          <ChevronDown
            style="user-select: none;"
            onclick={() => (expandedFilter = !expandedFilter)}
          />
        {/if}
      {/if}
    </div>
    {#if expandedFilter || !isMobileSmall}
      {#if !showDeckCount}
        <h2 style="font-size: var(--text-base);color: var(--text-secondary)">{$t('cards.countLabel')}：{totalCards}</h2>
      {/if}
      <SortModal bind:sortByList={sortList} onChangeSubmit={onChangeSort}></SortModal>

      <button class="button button-ghost" onclick={() => (isFilterOpen = true)}>
        <SlidersHorizontal size={18} />
        <span>{$t('cards.filter')}</span>
        {#if totalActiveCount > 0}
          <span class="badge">{totalActiveCount}</span>
        {/if}
      </button>
    {/if}
  </header>

  <section class="results-area">
    {#if isLoading && displayedCards.length === 0}
      <div class="loading-state">
        <LoaderCircle class="animate-spin" size={24} />
      </div>
    {:else if displayedCards.length > 0}
      <div class="card-grid">
        {#each displayedCards as card (card.id)}
          {@const defaultI = getDefaultImg(card as unknown as cardAndPrint)}
          <div
            id={card.id}
            class:isBanned={card.is_banned}
            role="presentation"
            onclick={() => handleCardClick(card as any)}
            oncontextmenu={(e) => {
              e.preventDefault()
              if (onMenuClick) onMenuClick(card.id, zone)
            }}
            style="position: relative; display: flex; align-items: center; justify-content: center; flex-direction: column"
          >
            <CachedImage
              src={defaultI?.img_cdn! ?? defaultI?.tts_cdn!}
              name={printCacheName(defaultI)}
              borderRadius="6px"
              fit="cover"
              {isLandscape}
            />
            <h5 style="color: var(--text-primary) ;margin: 0; text-align: center;">
              {`${card.card_name_cn} ${card.sub_title_cn || ''}`}
            </h5>
            <small style="font-size: var(--text-xs)">{card.card_no}</small>
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
            <span>{$t('cards.loadingMore')}</span>
          </div>
        {:else if !hasMore}
          <div class="no-more">
            <span>{$t('cards.noMore')}</span>
          </div>
        {/if}

        <div use:observeSentinel class="sentinel"></div>
      </div>
    {:else}
      <div class="empty-state">
        <p>{$t('cards.noResults')}</p>
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
  .deck-zone-tabs {
    width: 100%;
    display: flex;
    overflow: hidden;
    overflow-x: auto;
    gap: 5px;
  }

  .deck-zone-tabs > button {
    all: unset;
    text-transform: uppercase;
    font-weight: bolder;
    background-color: var(--bg-secondary);
    padding: 8px 12px;
    font-size: var(--text-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    word-break: keep-all;
    transition: all 0.15s;
    box-shadow: 0 4px 8px 0px rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }

  .deck-zone-tabs > button.active {
    color: var(--bg-secondary);
    background-color: var(--accent-color);
  }

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
    column-gap: 16px;
    row-gap: 10px;
    padding-bottom: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .search-wrapper {
    flex: 1;
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
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 16px;
    scroll-behavior: smooth;
  }

  .isBanned {
    filter: grayscale(80%);
  }

  /* ================= 底部状态与哨兵 ================= */
  .bottom-status {
    margin-top: 24px;
    padding-bottom: 24px;
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

  .sentinel {
    height: 1px;
    width: 100%;
  }

  /* ================= 移动端适配 ================= */
  @media (max-width: 767.99px) {
    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 10px;
    }

    .search-wrapper {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 5px;
      flex: 0 0 100%;
    }
  }

  @media (min-width: 1079.99px) {
    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
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
