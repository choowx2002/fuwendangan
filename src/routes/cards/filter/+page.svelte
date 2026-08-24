<!-- src/routes/cards/filter/+page.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getFilterOptions } from '$lib/db'
  import type {
    ActiveFilter,
    FilterOptions,
    FilterMode,
    NumberRange,
    SortKeyItem,
  } from '$lib/db/types'
  import { sortOptions } from '$lib/cards/utils/options-utils'
  import NumberRangeSlider from '$lib/components/ui/NumberRangeSlider.svelte'
  import SearchBar from '$lib/components/cards/SearchBar.svelte'
  import {
    filterSyncStore,
    initFilterSync,
    setFilterSyncState,
    subscribeFilterClose,
    type FilterSyncState,
  } from '$lib/services/filter-bridge'
  import { isTauri } from '$lib/db/env'
  import { X, Minus, Pin, PinOff, RotateCcw, SlidersHorizontal } from '@lucide/svelte'
  import { t } from '$lib/i18n'

  let filterOptions = $state<FilterOptions | null>(null)
  let activeFilters = $state<ActiveFilter[]>([])
  let energy = $state<NumberRange>({ min: 0, max: 12 })
  let power = $state<NumberRange>({ min: 0, max: 12 })
  let return_energy = $state<NumberRange>({ min: 0, max: 4 })
  let searchText = $state('')
  let sortList = $state<SortKeyItem[]>([{ id: 1, name: 'card_no', isAsc: true, order: 1 }])
  let totalCards = $state(0)

  /** 已生效的筛选项数（activeFilters + 非全范围滑块 + 搜索词） */
  const activeFilterCount = $derived.by(() => {
    let n = activeFilters.length
    if (searchText) n++
    const isFull = (r: NumberRange, lo: number, hi: number) => r.min === lo && r.max === hi
    const er = filterOptions?.energy_range ?? { min: 0, max: 12 }
    const rr = filterOptions?.return_energy_range ?? { min: 0, max: 4 }
    const pr = filterOptions?.power_range ?? { min: 0, max: 12 }
    if (!isFull(energy, er.min, er.max)) n++
    if (!isFull(return_energy, rr.min, rr.max)) n++
    if (!isFull(power, pr.min, pr.max)) n++
    return n
  })

  let unsub: (() => void) | null = null
  let storeUnsub: (() => void) | null = null

  function snapshot(): FilterSyncState {
    return {
      activeFilters: [...activeFilters],
      energy: { ...energy },
      power: { ...power },
      return_energy: { ...return_energy },
      currentSearchText: searchText,
      sortList: sortList.map((s) => ({ ...s })),
      totalCards,
    }
  }

  function push() {
    void setFilterSyncState(snapshot())
  }

  // 筛选分类区块
  const sections = $derived.by(() => {
    if (!filterOptions) return []
    const map = (type: ActiveFilter['type'], options: string[] | undefined) => ({
      type,
      title:
        type === 'card_color_list'
          ? $t('cards.filterColor')
          : type === 'card_category'
            ? $t('cards.filterCategory')
            : type === 'region'
              ? $t('cards.filterRegion')
              : type === 'tag'
                ? $t('cards.filterTag')
                : type === 'keyword'
                  ? $t('cards.filterKeyword')
                  : type === 'advanced_tag'
                    ? $t('cards.filterAdvancedTag')
                    : type === 'series'
                      ? $t('cards.filterSeries')
                      : type === 'rarity'
                        ? $t('cards.filterRarity')
                        : type,
      options: options || [],
    })
    return [
      map('card_color_list', filterOptions.colors),
      map('card_category', filterOptions.categories),
      map('series', filterOptions.series),
      map('rarity', filterOptions.rarities),
      map('region', filterOptions.regions),
      map('tag', filterOptions.tags),
      map('keyword', filterOptions.keywords),
    ].filter((s) => s.options.length > 0)
  })

  /** 进阶标签按 `分区·详细` 分组：返回 { zone, items } */
  const advancedGroups = $derived.by(() => {
    const list = filterOptions?.advanced_tags || []
    const groups = new Map<string, string[]>()
    for (const tag of list) {
      const idx = tag.indexOf('·')
      const zone = idx > 0 ? tag.slice(0, idx) : '其他'
      const detail = idx > 0 ? tag.slice(idx + 1) : tag
      if (!groups.has(zone)) groups.set(zone, [])
      groups.get(zone)!.push(detail)
    }
    return Array.from(groups.entries())
      .map(([zone, items]) => ({ zone, items }))
      .sort((a, b) => a.zone.localeCompare(b.zone))
  })

  /** 由分区+详细还原完整标签值 */
  function advancedFull(zone: string, detail: string): string {
    return zone === '其他' ? detail : `${zone}·${detail}`
  }

  function getMode(type: string, value: string): FilterMode | null {
    return activeFilters.find((f) => f.type === type && f.value === value)?.mode || null
  }

  function handleToggle(type: ActiveFilter['type'], value: string) {
    const i = activeFilters.findIndex((f) => f.type === type && f.value === value)
    let next = [...activeFilters]
    if (i === -1) next.push({ type, value, mode: 'include' })
    else {
      const cur = next[i]
      if (cur.mode === 'include') next[i] = { ...cur, mode: 'require' }
      else if (cur.mode === 'require') next[i] = { ...cur, mode: 'exclude' }
      else next.splice(i, 1)
    }
    activeFilters = next
    push()
  }

  function handleRemove(e: MouseEvent, type: ActiveFilter['type'], value: string) {
    e.preventDefault()
    activeFilters = activeFilters.filter((f) => !(f.type === type && f.value === value))
    push()
  }

  function handleAddFilter(filter: ActiveFilter) {
    if (!activeFilters.some((f) => f.type === filter.type && f.value === filter.value)) {
      activeFilters = [...activeFilters, { ...filter, mode: 'include' }]
    }
    push()
  }

  function handleTextSearch(text: string) {
    searchText = text
    push()
  }

  function handleClearAll() {
    activeFilters = []
    if (filterOptions) {
      energy = {
        min: filterOptions.energy_range?.min ?? 0,
        max: filterOptions.energy_range?.max ?? 12,
      }
      power = {
        min: filterOptions.power_range?.min ?? 0,
        max: filterOptions.power_range?.max ?? 12,
      }
      return_energy = {
        min: filterOptions.return_energy_range?.min ?? 0,
        max: filterOptions.return_energy_range?.max ?? 4,
      }
    }
    searchText = ''
    push()
  }

  function closeWindow() {
    if (isTauri) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .close()
          .catch(() => {})
      )
    } else {
      window.close()
    }
  }

  function minimizeWindow() {
    if (!isTauri) return
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .minimize()
        .catch(() => {})
    )
  }

  let pinned = $state(false)

  function togglePin() {
    if (!isTauri) return
    pinned = !pinned
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .setAlwaysOnTop(pinned)
        .catch(() => {})
    )
  }

  let closeUnsub: (() => void) | null = null

  onMount(() => {
    void (async () => {
      filterOptions = await getFilterOptions()
      unsub = await initFilterSync()
      // 主窗口离开单卡库页时关闭本筛选窗口
      closeUnsub = await subscribeFilterClose(() => closeWindow())
      storeUnsub = filterSyncStore.subscribe((s) => {
        if (!s) return
        activeFilters = s.activeFilters
        energy = s.energy
        power = s.power
        return_energy = s.return_energy
        searchText = s.currentSearchText
        sortList = s.sortList
        totalCards = s.totalCards
      })
    })()
  })

  onDestroy(() => {
    unsub?.()
    storeUnsub?.()
    closeUnsub?.()
  })
</script>

<div class="filter-page">
  <header class="win-header" data-tauri-drag-region>
    <div class="header-left" data-tauri-drag-region>
      <SlidersHorizontal size={18} />
      <h2>{$t('cards.filterTitle')}</h2>
      <span class="header-count" class:active={activeFilterCount > 0}>{activeFilterCount}</span>
    </div>
    <div class="header-actions">
      <button
        class="icon-btn"
        onclick={minimizeWindow}
        aria-label={$t('showcase.minimize')}
        title={$t('showcase.minimize')}
      >
        <Minus size={18} />
      </button>
      <button
        class="icon-btn"
        class:active={pinned}
        onclick={togglePin}
        aria-label={$t(pinned ? 'showcase.uncardize' : 'showcase.cardize')}
        title={$t(pinned ? 'showcase.uncardize' : 'showcase.cardize')}
      >
        {#if pinned}<PinOff size={18} />{:else}<Pin size={18} />{/if}
      </button>
      <button class="icon-btn" onclick={closeWindow} aria-label={$t('common.close')}>
        <X size={20} />
      </button>
    </div>
  </header>

  <!-- 搜索词（复用 SearchBar） -->
  <div class="search-box">
    <SearchBar {filterOptions} onAddFilter={handleAddFilter} onTextSearch={handleTextSearch} />
  </div>

  <!-- 已应用筛选 chips -->
  {#if activeFilters.length > 0 || searchText}
    <div class="chips-bar">
      {#each activeFilters as f (f.type + ':' + f.value)}
        <span
          class="chip"
          class:include={f.mode === 'include'}
          class:require={f.mode === 'require'}
          class:exclude={f.mode === 'exclude'}
        >
          {f.value}
          <button
            class="chip-x"
            onclick={() => handleRemove(new MouseEvent('click'), f.type, f.value)}
            aria-label={$t('common.clear')}
          >
            <X size={12} />
          </button>
        </span>
      {/each}
      {#if searchText}
        <span class="chip search-chip">
          “{searchText}”
          <button
            class="chip-x"
            onclick={() => {
              searchText = ''
              push()
            }}
            aria-label={$t('common.clear')}
          >
            <X size={12} />
          </button>
        </span>
      {/if}
    </div>
  {/if}

  <!-- 卡片化两列筛选区 -->
  <main class="scroll-body">
    <div class="cards-grid">
      <!-- 数值范围卡 -->
      <section class="filter-card range-card">
        <h3 class="card-title">{$t('cards.filterRange')}</h3>
        <div class="range-list">
          <div class="range-item">
            <div class="range-label">
              <span>{$t('cards.energy')}</span>
              <span class="range-value"
                >{energy.min === energy.max ? energy.min : `${energy.min} - ${energy.max}`}</span
              >
            </div>
            <NumberRangeSlider
              bind:value={energy}
              min={filterOptions?.energy_range?.min ?? 0}
              max={filterOptions?.energy_range?.max ?? 12}
              step={1}
            />
          </div>

          <div class="range-item">
            <div class="range-label">
              <span>{$t('cards.runeEnergy')}</span>
              <span class="range-value"
                >{return_energy.min === return_energy.max
                  ? return_energy.min
                  : `${return_energy.min} - ${return_energy.max}`}</span
              >
            </div>
            <NumberRangeSlider
              bind:value={return_energy}
              min={filterOptions?.return_energy_range?.min ?? 0}
              max={filterOptions?.return_energy_range?.max ?? 4}
              step={1}
            />
          </div>

          <div class="range-item">
            <div class="range-label">
              <span>{$t('cards.power')}</span>
              <span class="range-value"
                >{power.min === power.max ? power.min : `${power.min} - ${power.max}`}</span
              >
            </div>
            <NumberRangeSlider
              bind:value={power}
              min={filterOptions?.power_range?.min ?? 0}
              max={filterOptions?.power_range?.max ?? 12}
              step={1}
            />
          </div>
        </div>
      </section>

      {#each sections as section}
        {@const sortedList = sortOptions(section.type, section.options)}
        {@const sectionActive = activeFilters.filter((f) => f.type === section.type).length}
        <section class="filter-card">
          <h3 class="card-title">
            {section.title}
            {#if sectionActive > 0}
              <span class="card-count">{sectionActive}</span>
            {/if}
          </h3>
          <div class="options-grid">
            {#each sortedList as option}
              {@const mode = getMode(section.type, option)}
              <button
                class="option-btn"
                class:include={mode === 'include'}
                class:require={mode === 'require'}
                class:exclude={mode === 'exclude'}
                onclick={() => handleToggle(section.type, option)}
                oncontextmenu={(e) => handleRemove(e, section.type, option)}
              >
                {#if section.type === 'card_color_list'}
                  {#if option !== 'colorless'}
                    <img
                      class:refelctIcon={mode}
                      src={`/runes/${option}.svg`}
                      alt={option}
                      width="20"
                    />
                  {:else}
                    {$t('cards.colorColorless')}
                  {/if}
                {:else}
                  {option}
                {/if}
              </button>
            {/each}
          </div>
        </section>
      {/each}

      <!-- 进阶标签卡：卡内简单分区（复用 .filter-card） -->
      {#if advancedGroups.length > 0}
        <section class="filter-card">
          <h3 class="card-title">{$t('cards.filterAdvancedTag')}</h3>
          {#each advancedGroups as group (group.zone)}
            <div class="advanced-zone-title">{group.zone}</div>
            <div class="options-grid">
              {#each group.items as detail (group.zone + ':' + detail)}
                {@const full = advancedFull(group.zone, detail)}
                {@const mode = getMode('advanced_tag', full)}
                <button
                  class="option-btn"
                  class:include={mode === 'include'}
                  class:require={mode === 'require'}
                  class:exclude={mode === 'exclude'}
                  onclick={() => handleToggle('advanced_tag', full)}
                  oncontextmenu={(e) => handleRemove(e, 'advanced_tag', full)}
                >
                  {detail}
                </button>
              {/each}
            </div>
          {/each}
        </section>
      {/if}
    </div>
  </main>

  <!-- 底部操作栏 -->
  <footer class="win-footer">
    <div class="footer-stats">
      <span class="count">{$t('cards.activeCount', { values: { count: activeFilterCount } })}</span>
      <span class="hit-count">{$t('cards.hitCount', { values: { count: totalCards } })}</span>
    </div>
    <div class="footer-actions">
      <button class="button button-text" onclick={handleClearAll}>
        <RotateCcw size={14} />
        {$t('common.reset')}
      </button>
      <button class="button button-primary" onclick={closeWindow}>{$t('cards.done')}</button>
    </div>
  </footer>
</div>

<style>
  .filter-page {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .win-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
    cursor: grab;
  }
  .header-left h2 {
    font-size: var(--text-lg);
    color: var(--text-primary);
    margin: 0;
  }
  .header-count {
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-xs);
    font-weight: 600;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
  }
  .header-count.active {
    background: color-mix(in srgb, var(--accent-color) 20%, transparent);
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .icon-btn.active {
    background: rgba(122, 162, 255, 0.35);
    color: #fff;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .search-box {
    padding: 12px 16px 4px;
    flex-shrink: 0;
  }
  .search-box :global(.search-wrapper) {
    max-width: none;
  }

  .chips-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 16px ;
    flex-shrink: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: var(--text-base);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }
  .chip.include {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }
  .chip.require {
    border-color: royalblue;
    color: royalblue;
  }
  .chip.exclude {
    border-color: #f5412a;
    color: #f5412a;
  }
  .chip-x {
    border: none;
    background: none;
    padding: 0;
    display: flex;
    align-items: center;
    color: inherit;
    cursor: pointer;
  }

  /* 可滚动区 */
  .scroll-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 16px 16px;
  }

  /* 卡片化两列网格 */
  .cards-grid {
    /*display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    align-items: start;*/
    column-gap: 12px;
    column-count: 2;
  }

  .filter-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 12px;
    min-width: 0;
    break-inside: avoid;

    /* Fallbacks for older browsers and maximum stability */
    -webkit-break-inside: avoid; /* Safari / Chrome fallback */
    page-break-inside: avoid; /* Firefox legacy fallback */
    /*display: inline-block;*/
    margin-bottom: 12px;
  }
  .card-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-md);
    color: var(--text-secondary);
    margin: 0 0 10px;
    font-weight: 600;
  }
  .card-count {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-2xs, 11px);
    background: color-mix(in srgb, var(--accent-color) 20%, transparent);
    color: var(--accent-color);
  }

  .range-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .range-item .range-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-bottom: 4px;
  }
  .range-value {
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  .options-grid {
    margin-bottom: 2px;
  }

  .advanced-zone-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-tertiary);
    margin: 6px 0 4px;
  }

  .option-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    margin: 0 6px 6px 0;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-md);
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s,
      color 0.12s;
  }
  .option-btn:hover {
    border-color: var(--text-tertiary);
  }
  .option-btn.include {
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    border-color: var(--accent-color);
    color: var(--accent-color);
  }
  .option-btn.require {
    background: color-mix(in srgb, royalblue 15%, transparent);
    border-color: royalblue;
    color: royalblue;
  }
  .option-btn.exclude {
    background: color-mix(in srgb, #f5412a 15%, transparent);
    border-color: #f5412a;
    color: #f5412a;
    text-decoration-line: line-through;
  }

  .refelctIcon {
    filter: brightness(0) invert(1);
  }

  .win-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }
  .footer-stats {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .count {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .hit-count {
    font-size: var(--text-sm);
    color: var(--accent-color);
    font-weight: 600;
  }
  .footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
