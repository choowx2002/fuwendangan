<script lang="ts">
  import { searchCards, searchCardVariants, getFilterOptions, updateFilterOptions } from '$lib/db'
  import SearchBar from './SearchBar.svelte'
  import FilterPanel from './FilterPanel.svelte'
  import type {
    ActiveFilter,
    CardBase,
    CardLibraryMode,
    CardPrint,
    FilterOptions,
    NumberRange,
    SortKeyItem,
    VariantWithOwned,
  } from '$lib/db/types'
  import { ChevronDown, ChevronUp, LoaderCircle, SlidersHorizontal } from '@lucide/svelte'
  import { isTauri } from '$lib/db/env'
  import { filterSyncStore, initFilterSync, setFilterSyncState } from '$lib/services/filter-bridge'
  import { buildSearchParams, buildVariantSearchParams, printCacheName } from '$lib/db/helper'
  import { onMount, tick } from 'svelte'
  import SortModal from './SortModal.svelte'
  import { page } from '$app/state'
  import CachedImage from './CachedImage.svelte'
  import type { ZoneKey } from '$lib/decks/zone'
  import { cardLibraryMode, settingsStoreReady } from '$lib/stores/settings'
  import { resolveDefaultPrint } from '$lib/cards/utils/card-print-utils'
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
    filterSyncEnabled = false,
    modeSwitchEnabled = false,
    onVariantClick,
  }: {
    onCardClick?: (arg0: cardAndPrint) => void
    onMenuClick?: (id: string, zone: ZoneKey) => void
    deckCards?: cardAndPrint[]
    showDeckCount?: boolean
    displayedCards?: CardBase[]
    isFilterOpen?: boolean
    zone?: ZoneKey
    /** 是否开启与独立筛选窗口的实时双向同步 */
    filterSyncEnabled?: boolean
    /** 是否显示「基础卡 / 印刷」模式切换（仅卡牌库页开启） */
    modeSwitchEnabled?: boolean
    /** 印刷模式点击回调（一格 = 一个 card_no_extend） */
    onVariantClick?: (v: VariantWithOwned) => void
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

  // --- 印刷模式（card_prints 数据源，一格 = 一个 card_no_extend，语言合并、图优先 SC）---
  let variantCards = $state<VariantWithOwned[]>([])
  /** 实际生效模式：未开启切换的页面（卡组构建等）恒为 base */
  const mode = $derived<CardLibraryMode>(modeSwitchEnabled ? $cardLibraryMode : 'base')

  /** 按模式替换系列/稀有度选项来源（base=卡牌原始系列+基础稀有度；prints=打印级） */
  const modeFilterOptions = $derived.by<FilterOptions | null>(() => {
    if (!filterOptions) return null
    // 未启用模式切换的页面（卡组构建等）保持原有筛选口径
    if (!modeSwitchEnabled) return filterOptions
    if (mode === 'prints') {
      return {
        ...filterOptions,
        series: filterOptions.series ?? [],
        rarities: filterOptions.print_rarities ?? [],
      }
    }
    return {
      ...filterOptions,
      series: filterOptions.base_series ?? [],
      rarities: filterOptions.rarities ?? [],
    }
  })

  /** 数值范围是否被用户收窄（等于全局全范围视为未筛选） */
  function isRangeActive(
    current: NumberRange,
    globalRange?: { min: number; max: number }
  ): boolean {
    if (!globalRange) return false
    return current.min > globalRange.min || current.max < globalRange.max
  }

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
      // 等待 settings.json 读取完成，避免记忆的模式（prints）被默认 base 覆盖首次搜索
      await settingsStoreReady.catch(() => {})
      filterOptions = await getFilterOptions()
      // 老缓存缺 base_series/print_rarities（升级后首次启动）→ 重算一次
      if (filterOptions && (!filterOptions.base_series || !filterOptions.print_rarities)) {
        await updateFilterOptions()
        filterOptions = await getFilterOptions()
      }
      // 数值滑块对齐全局范围（硬编码默认值可能与数据不符，导致默认全范围被误当成筛选条件）
      resetRangeFilters()
      await performSearch()
    }
    init()
  })

  // --- 跨窗口筛选同步 ---
  let syncUnsub: (() => void) | null = null
  let storeUnsub: (() => void) | null = null
  /** 上次已广播/已应用的状态指纹，用于去抖避免回环 */
  let lastSyncJson = ''

  // 本地筛选状态指纹（作为 $effect 依赖；仅真正变化才触发广播）
  const localSyncState = $derived(
    JSON.stringify({
      activeFilters,
      energy,
      power,
      return_energy,
      currentSearchText,
      sortList,
      totalCards,
      mode,
    })
  )

  // 本地状态变化 → 广播到其它窗口
  $effect(() => {
    if (!filterSyncEnabled) return
    const json = localSyncState
    if (json === lastSyncJson) return
    lastSyncJson = json
    void setFilterSyncState({
      activeFilters: [...activeFilters],
      energy: { ...energy },
      power: { ...power },
      return_energy: { ...return_energy },
      currentSearchText,
      sortList: sortList.map((s) => ({ ...s })),
      totalCards,
      mode,
    })
  })

  // 订阅其它窗口广播 → 应用本地并重新搜索
  $effect(() => {
    if (!filterSyncEnabled) return
    let cancelled = false
    void (async () => {
      const unlisten = await initFilterSync()
      if (cancelled) {
        unlisten()
        return
      }
      syncUnsub = unlisten
      storeUnsub = filterSyncStore.subscribe((s) => {
        if (!s) return
        // 若与本地当前状态相同则忽略（可能来自自己的广播回写）
        const remoteJson = JSON.stringify(s)
        if (remoteJson === localSyncState) return
        lastSyncJson = remoteJson
        activeFilters = s.activeFilters
        energy = s.energy
        power = s.power
        return_energy = s.return_energy
        currentSearchText = s.currentSearchText
        sortList = s.sortList
        if (s.mode && s.mode !== $cardLibraryMode) cardLibraryMode.set(s.mode)
        void performSearch()
      })
    })()
    return () => {
      cancelled = true
      syncUnsub?.()
      syncUnsub = null
      storeUnsub?.()
      storeUnsub = null
    }
  })

  // --- 核心搜索逻辑 ---
  async function performSearch(isLoadMore = false) {
    if (isLoadingMore) return

    if (!isLoadMore) {
      currentPage = 1
      displayedCards = []
      variantCards = []
      hasMore = true
      isLoading = true
    } else {
      isLoadingMore = true
    }

    try {
      let total = 0
      let loaded = 0

      // 数值范围仅在被用户收窄时作为筛选条件；全范围不传，避免 NULL 数值卡（装备/法术等）被排除
      const energyParam = isRangeActive(energy, filterOptions?.energy_range) ? energy : undefined
      const returnEnergyParam = isRangeActive(return_energy, filterOptions?.return_energy_range)
        ? return_energy
        : undefined
      const powerParam = isRangeActive(power, filterOptions?.power_range) ? power : undefined

      if (mode === 'prints') {
        // prints 模式：数据源 card_prints，series/rarity 走打印级，收录 promo
        const params = buildVariantSearchParams(
          activeFilters,
          currentSearchText,
          currentPage,
          pageSize,
          sortList,
          energyParam,
          returnEnergyParam,
          powerParam
        )
        const result = await searchCardVariants({
          ...params,
          includePromo: true,
          champion_tag,
        })
        total = result.total
        variantCards = isLoadMore ? [...variantCards, ...result.data] : result.data
        loaded = variantCards.length
      } else {
        const params = buildSearchParams(
          activeFilters,
          currentSearchText,
          currentPage,
          pageSize,
          sortList,
          energyParam,
          returnEnergyParam,
          powerParam
        )
        const result = await searchCards({
          ...params,
          // 卡牌库 base 模式按卡牌原始系列筛选；其他页面（卡组构建等）保持打印级旧行为
          seriesScope: modeSwitchEnabled ? 'base' : undefined,
          champion_tag,
        })
        total = result.total
        if (isLoadMore) {
          displayedCards = [...displayedCards, ...result.data]
        } else {
          displayedCards = result.data
        }
        loaded = displayedCards.length
      }

      totalCards = total
      hasMore = loaded < total

      await tick()
      if (loaded > 0 && currentPage == 1) {
        const firstId =
          mode === 'prints'
            ? variantCards[0] && `${variantCards[0].cardId}:${variantCards[0].cardNoExtend}`
            : displayedCards[0]?.id
        if (firstId) {
          document.getElementById(firstId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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

  /** 重置数值范围筛选（模式切换时用，范围取当前选项缓存的极值） */
  function resetRangeFilters() {
    energy = {
      min: filterOptions?.energy_range?.min ?? 0,
      max: filterOptions?.energy_range?.max ?? 12,
    }
    power = {
      min: filterOptions?.power_range?.min ?? 0,
      max: filterOptions?.power_range?.max ?? 12,
    }
    return_energy = {
      min: filterOptions?.return_energy_range?.min ?? 0,
      max: filterOptions?.return_energy_range?.max ?? 4,
    }
  }

  /** 切换浏览模式：清空筛选条件（含数值范围）、保留搜索词，然后重新搜索 */
  function handleModeChange(next: CardLibraryMode) {
    if (next === $cardLibraryMode) return
    cardLibraryMode.set(next)
    activeFilters = []
    resetRangeFilters()
    void performSearch()
  }

  // 计算卡组中该卡的数量
  function getDeckCount(cardId: string | number): number {
    if (!showDeckCount || !deckCards) return 0
    return deckCards.filter((c) => c.id === cardId).length
  }

  let isLandscape = $derived.by(() => {
    if (mode === 'prints') {
      return (
        variantCards.length > 0 &&
        variantCards.every((v) => v.cardCategory?.findIndex((cat) => cat === '战场') !== -1)
      )
    }
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
    return resolveDefaultPrint(card.card_prints, card.card_no)
  }

  // --- 渲染卡片磁贴（base=基础卡，prints=card_no_extend）---
  interface PoolTile {
    key: string
    id: string
    imgSrc: string | null | undefined
    imgName: string
    title: string
    no: string
    isBanned: boolean
    card?: cardAndPrint
    variant?: VariantWithOwned
  }

  const tiles = $derived.by<PoolTile[]>(() => {
    if (mode === 'prints') {
      return variantCards.map((v) => ({
        key: `${v.cardId}:${v.cardNoExtend}`,
        id: `${v.cardId}:${v.cardNoExtend}`,
        imgSrc: v.imgCdn ?? v.ttsCdn,
        imgName: printCacheName({
          card_no_extend: v.cardNoExtend,
          language: v.printLanguage,
          id: v.printId,
        }),
        title: `${v.card_name_cn ?? ''} ${v.sub_title_cn || ''}`.trim(),
        no: v.cardNoExtend,
        isBanned: !!v.isBanned,
        variant: v,
      }))
    }
    return displayedCards.map((card) => {
      const p = getDefaultImg(card as cardAndPrint)
      return {
        key: card.id,
        id: card.id,
        imgSrc: p?.img_cdn ?? p?.tts_cdn,
        imgName: printCacheName(p),
        title: `${card.card_name_cn ?? ''} ${card.sub_title_cn || ''}`.trim(),
        no: card.card_no,
        isBanned: !!card.is_banned,
        card: card as cardAndPrint,
      }
    })
  })

  function handleTileClick(tile: PoolTile) {
    if (tile.variant) {
      onVariantClick?.(tile.variant)
      return
    }
    if (tile.card) handleCardClick(tile.card)
  }
</script>

<div class="card-pool-wrapper">
  <header class="search-header">
    {#if modeSwitchEnabled}
      <div class="library-mode-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mode === 'base'}
          class:active={mode === 'base'}
          onclick={() => handleModeChange('base')}>{$t('cards.modeBase')}</button
        >
        <button
          role="tab"
          aria-selected={mode === 'prints'}
          class:active={mode === 'prints'}
          onclick={() => handleModeChange('prints')}>{$t('cards.modePrints')}</button
        >
      </div>
    {/if}
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
        filterOptions={modeFilterOptions}
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
        <h2 style="font-size: var(--text-base);color: var(--text-secondary)">
          {$t('cards.countLabel')}：{totalCards}
        </h2>
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
    {#if isLoading && tiles.length === 0}
      <div class="loading-state">
        <LoaderCircle class="animate-spin" size={24} />
      </div>
    {:else if tiles.length > 0}
      <div class="card-grid">
        {#each tiles as tile (tile.key)}
          <div
            id={tile.id}
            class:isBanned={tile.isBanned}
            role="presentation"
            onclick={() => handleTileClick(tile)}
            oncontextmenu={(e) => {
              e.preventDefault()
              if (tile.card && onMenuClick) onMenuClick(tile.card.id, zone)
            }}
            style="position: relative; display: flex; align-items: center; justify-content: center; flex-direction: column"
          >
            <CachedImage
              src={tile.imgSrc!}
              name={tile.imgName}
              borderRadius="6px"
              fit="cover"
              {isLandscape}
            />
            <h5 style="color: var(--text-primary) ;margin: 0; text-align: center;">
              {tile.title}
            </h5>
            <small style="font-size: var(--text-xs)">{tile.no}</small>
            {#if showDeckCount && tile.card}
              {@const count = getDeckCount(tile.card.id)}
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
    filterOptions={modeFilterOptions}
    {activeFilters}
    onToggle={handleToggleFilter}
    onRemove={handleRemoveFilter}
    onClear={handleClearFilter}
    onClose={() => {
      isFilterOpen = false
      performSearch()
    }}
    showOpenInNewWindow={filterSyncEnabled}
    bind:energy
    bind:power
    bind:return_energy
  />
</div>

<style>
  .library-mode-tabs {
    display: flex;
    gap: 4px;
    padding: 3px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 8px 0px rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
  }

  .library-mode-tabs > button {
    all: unset;
    padding: 5px 12px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    border-radius: calc(var(--radius-md) - 3px);
    cursor: pointer;
    word-break: keep-all;
    transition: all 0.15s;
  }

  .library-mode-tabs > button:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .library-mode-tabs > button.active {
    color: var(--bg-secondary);
    background-color: var(--accent-color);
  }

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
