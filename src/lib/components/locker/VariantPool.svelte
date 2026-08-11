<script lang="ts">
  /**
   * 变体级卡池（供储物柜抽屉使用）：
   * 以 searchCardVariants 为数据源（一行 = 一个 card_no_extend 变体），
   * 提供系列/变体类型/搜索/排序筛选 + 无限滚动 + 多选勾选 + 已收录徽标。
   * 仅展示已收藏变体（ownership = 'owned'）。
   */
  import { onMount } from 'svelte'
  import type { VariantWithOwned, Series } from '$lib/db'
  import { searchCardVariants, getAllSeries } from '$lib/db'
  import type { VariantPoolFilters } from './variant-pool-types'
  import { Minus, Plus } from '@lucide/svelte'
  import CachedImage from '../cards/CachedImage.svelte'
  import CollectionSortDropdown from '../collection/CollectionSortDropdown.svelte'
  import type { VariantBucket } from '$lib/cards/utils/variant-utils'
  import { t } from '$lib/i18n'

  let {
    filters = $bindable({
      seriesCode: '',
      bucket: '',
      searchText: '',
      sort: { key: 'card_no', isAsc: true },
    } as VariantPoolFilters),
    existingQty = new Map<string, number>() as Map<string, number>,
    globalQty = new Map<string, number>() as Map<string, number>,
    selectable = false,
    selectedIds = new Set<string>() as Set<string>,
    variants = $bindable([] as VariantWithOwned[]),
    total = $bindable(0),
    quickEdit = false,
    onQuickInc = undefined as ((v: VariantWithOwned) => void) | undefined,
    onQuickDec = undefined as ((v: VariantWithOwned) => void) | undefined,
    onToggleSelect = undefined as ((v: VariantWithOwned) => void) | undefined,
    onCardClick = undefined as ((v: VariantWithOwned) => void) | undefined,
  } = $props()

  const BUCKET_ORDER: VariantBucket[] = ['base', 'alt', 'overnum', 'rune', 'token']
  const BUCKET_LABEL_KEYS: Record<VariantBucket, string> = {
    base: 'collection.bucketBase',
    alt: 'collection.bucketAlt',
    overnum: 'collection.bucketOvernum',
    rune: 'collection.bucketRune',
    token: 'collection.bucketToken',
  }

  let seriesOptions = $state<Series[]>([])
  let page = $state(0)
  let hasMore = $state(true)
  let loading = $state(false)
  let loadingMore = $state(false)
  let listEl = $state<HTMLDivElement | null>(null)
  let searchDebounce: ReturnType<typeof setTimeout> | null = null

  const variantKey = (v: VariantWithOwned) =>
    `${v.cardNo}:${v.cardNoExtend}:${v.printLanguage ?? ''}`

  async function loadSeries() {
    seriesOptions = await getAllSeries()
  }

  async function runSearch(reset: boolean) {
    const nextPage = reset ? 1 : page + 1
    if (reset) {
      loading = true
    } else {
      loadingMore = true
    }
    try {
      const res = await searchCardVariants({
        page: nextPage,
        pageSize: 48,
        searchText: filters.searchText.trim() || undefined,
        ownership: 'owned',
        seriesCode: filters.seriesCode || undefined,
        bucket: filters.bucket || undefined,
        collectionSort: filters.sort,
      })
      variants = reset ? res.data : [...variants, ...res.data]
      total = res.total
      page = res.page
      hasMore = page < res.totalPages
    } catch (err) {
      console.warn('[VariantPool] 搜索失败:', err)
      if (reset) variants = []
    } finally {
      loading = false
      loadingMore = false
    }
  }

  function onFilterChange() {
    if (searchDebounce) clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => void runSearch(true), 250)
  }

  function resetAndSearch() {
    void runSearch(true)
  }

  onMount(() => {
    void loadSeries()
    void runSearch(true)
  })

  $effect(() => {
    const el = listEl
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          void runSearch(false)
        }
      },
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  })

  function handleTileClick(v: VariantWithOwned) {
    if (selectable) {
      onToggleSelect?.(v)
    } else {
      onCardClick?.(v)
    }
  }

  /** 全局（所有抽屉合计）数量是否已达收藏上限 */
  function isGlobalAtLimit(v: VariantWithOwned): boolean {
    const qty = globalQty.get(variantKey(v)) ?? 0
    return v.ownedTotal > 0 && qty >= v.ownedTotal
  }

  /**
   * 显示过滤：全局已满 且 本抽屉没有这张卡 → 隐藏（无法再加，也不属于本抽屉）。
   * 本抽屉有的卡（含满额灰显）始终显示，可查看与移除。
   */
  const visibleVariants = $derived(
    variants.filter((v) => !(isGlobalAtLimit(v) && (existingQty.get(variantKey(v)) ?? 0) === 0))
  )
</script>

<div class="pool">
  <div class="pool-toolbar">
    <select class="filter-select" bind:value={filters.seriesCode} onchange={onFilterChange}>
      <option value="">{$t('locker.allSeries')}</option>
      {#each seriesOptions as s (s.code)}
        <option value={s.code}>{s.name_cn ?? s.code}</option>
      {/each}
    </select>

    <div class="bucket-chips">
      <button
        class="bucket-chip"
        class:active={filters.bucket === ''}
        onclick={() => {
          filters.bucket = ''
          onFilterChange()
        }}
      >
        {$t('locker.allTypes')}
      </button>
      {#each BUCKET_ORDER as bucket (bucket)}
        <button
          class="bucket-chip"
          class:active={filters.bucket === bucket}
          onclick={() => {
            filters.bucket = bucket
            onFilterChange()
          }}
        >
          {$t(BUCKET_LABEL_KEYS[bucket])}
        </button>
      {/each}
    </div>

    <input
      class="search-input"
      bind:value={filters.searchText}
      placeholder={$t('locker.searchVariantPlaceholder')}
      oninput={onFilterChange}
    />

    <CollectionSortDropdown
      sort={filters.sort}
      onChange={(s) => {
        filters.sort = s
        resetAndSearch()
      }}
    />
  </div>

  {#if loading}
    <div class="pool-tip">{$t('common.loading')}</div>
  {:else if visibleVariants.length === 0}
    <div class="pool-tip">
      {variants.length > 0 ? $t('locker.allAtLimit') : $t('locker.noResults')}
    </div>
  {:else}
    <div class="pool-grid" bind:this={listEl}>
      {#each visibleVariants as v (variantKey(v))}
        {@const key = variantKey(v)}
        {@const inDrawer = existingQty.get(key) ?? 0}
        {@const selected = selectedIds.has(key)}
        {@const atLimit = isGlobalAtLimit(v)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="variant-tile"
          class:selected={selectable && selected}
          class:at-limit={atLimit}
          role="button"
          tabindex="0"
          onclick={() => handleTileClick(v)}
        >
          <div class="tile-img">
            <CachedImage
              src={v.imgCdn ?? v.ttsCdn ?? ''}
              name={`${v.cardNoExtend}-${v.printLanguage ?? 'default'}`}
              borderRadius="0"
              fit="cover"
              isLandscape={false}
              isHover={false}
            />
            {#if selectable}
              <span class="select-mark" class:checked={selected}>
                {selected ? '✓' : ''}
              </span>
            {/if}

            {#if quickEdit && !selectable}
              <div class="quick-stepper">
                <button
                  class="step-btn dec"
                  title={$t('locker.quickRemove')}
                  onclick={(e) => {
                    e.stopPropagation()
                    onQuickDec?.(v)
                  }}
                >
                  <Minus size={12} />
                </button>
                <span class="step-qty">{inDrawer}</span>
                <button
                  class="step-btn inc"
                  title={$t('locker.quickAdd')}
                  disabled={isGlobalAtLimit(v)}
                  onclick={(e) => {
                    e.stopPropagation()
                    onQuickInc?.(v)
                  }}
                >
                  <Plus size={12} />
                </button>
              </div>
            {/if}
          </div>
          <div class="tile-info">
            <span class="tile-name">{v.card_name_cn ?? v.cardNo}</span>
            <span class="tile-no">
              {v.cardNo}{v.cardNoExtend ? ` · ${v.cardNoExtend}` : ''}
            </span>
            <span class="tile-owned"
              >{$t('locker.ownedBadge', { values: { count: v.ownedTotal } })}</span
            >
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if loadingMore}
    <div class="pool-tip">{$t('common.loadingMore')}</div>
  {/if}
</div>

<style>
  .pool {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }

  .pool-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .filter-select {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    max-width: 180px;
  }

  .bucket-chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .bucket-chip {
    padding: 5px 10px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .bucket-chip.active {
    border-color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-secondary));
    color: var(--accent-color);
    font-weight: 600;
  }

  .search-input {
    flex: 1;
    min-width: 160px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent-color);
  }

  .pool-tip {
    padding: 32px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .pool-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 10px;
  }

  .variant-tile {
    display: flex;
    flex-direction: column;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    transition: all 0.15s ease;
  }

  .variant-tile:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
  }

  .variant-tile.selected {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 35%, transparent);
  }

  /* 已达收藏上限：置灰表示不可再加（仍可查看与移除） */
  /* .variant-tile.at-limit {
    opacity: 0.55;
    filter: saturate(0.6);
  } */

  .tile-img {
    position: relative;
    width: 100%;
    aspect-ratio: 744 / 1040;
    background: var(--bg-hover);
  }

  .select-mark {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.85);
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }

  .select-mark.checked {
    background: var(--accent-color);
    border-color: var(--accent-color);
  }

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
    z-index: 5;
    white-space: nowrap;
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

  .step-btn.dec {
    background: #e03e3e;
  }

  .step-btn.dec:hover {
    background: color-mix(in srgb, #e03e3e 80%, #000);
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

  .tile-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
  }

  .tile-name {
    font-size: var(--text-xs);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile-no {
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile-owned {
    font-size: 10px;
    color: var(--accent-color);
    font-weight: 600;
  }

  @media (max-width: 600.99px) {
    .pool-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
