<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    CardWithOwned,
    CollectionSort,
    CollectionStats,
    OwnershipType,
  } from '$lib/db'
  import { getCollectionStats, searchCards } from '$lib/db'
  import CollectionStatsBar from '$lib/components/collection/CollectionStatsBar.svelte'
  import CollectionSortDropdown from '$lib/components/collection/CollectionSortDropdown.svelte'
  import CollectionGrid from '$lib/components/collection/CollectionGrid.svelte'
  import CollectionModal from '$lib/components/collection/CollectionModal.svelte'

  const PAGE_SIZE = 42

  let stats = $state<CollectionStats | null>(null)
  let selectedSeries = $state('all')
  let ownership = $state<OwnershipType>('all')
  let sort = $state<CollectionSort>({ key: 'card_no', isAsc: true })
  let searchText = $state('')

  let cards = $state<CardWithOwned[]>([])
  let page = $state(1)
  let total = $state(0)
  let hasMore = $state(true)
  let isLoading = $state(false)
  let loadingMore = $state(false)
  let selectedCard = $state<CardWithOwned | null>(null)
  let refreshKey = $state(0)

  const OWNERSHIP_OPTIONS: { key: OwnershipType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'owned', label: '已拥有' },
    { key: 'missing', label: '未拥有' },
    { key: 'foil', label: '有闪卡' },
  ]

  async function loadStats() {
    stats = await getCollectionStats()
  }

  async function runSearch(reset: boolean) {
    if (reset) {
      page = 1
      cards = []
    }
    isLoading = reset ? true : isLoading
    loadingMore = !reset
    try {
      const params: Record<string, unknown> = {
        page,
        pageSize: PAGE_SIZE,
        ownership,
        collectionSort: sort,
        includeOwned: true,
      }
      if (searchText.trim()) params.searchText = searchText.trim()
      if (selectedSeries !== 'all') {
        params.series_name = { include: [selectedSeries] }
      }
      const res = await searchCards(params as never)
      total = res.total
      hasMore = res.page < res.totalPages
      cards = reset ? res.data : [...cards, ...res.data]
    } finally {
      isLoading = false
      loadingMore = false
    }
  }

  function loadMore() {
    if (!hasMore || loadingMore || isLoading) return
    page += 1
    void runSearch(false)
  }

  $effect(() => {
    if (refreshKey === 0) return
    void loadStats()
    void runSearch(true)
  })

  onMount(() => {
    void loadStats()
    void runSearch(true)
  })

  function handleSelectSeries(code: string) {
    selectedSeries = code
    void runSearch(true)
  }

  function refreshAll() {
    void loadStats()
    void runSearch(true)
    refreshKey += 1
  }
</script>

<div class="page-wrapper">
  <div class="page-header">
    <h1 class="page-title">收藏与闪卡</h1>
  </div>

  <div class="toolbar">
    <div class="ownership-group">
      {#each OWNERSHIP_OPTIONS as opt (opt.key)}
        <button
          class="seg-btn"
          class:active={ownership === opt.key}
          onclick={() => {
            ownership = opt.key
            void runSearch(true)
          }}
        >
          {opt.label}
        </button>
      {/each}
    </div>

    <input
      class="search-input"
      placeholder="搜索卡牌..."
      bind:value={searchText}
      onkeydown={(e) => {
        if (e.key === 'Enter') void runSearch(true)
      }}
    />

    <CollectionSortDropdown
      {sort}
      onChange={(s) => {
        sort = s
        void runSearch(true)
      }}
    />
  </div>

  <div class="stats-area">
    <CollectionStatsBar stats={stats ?? undefined} {selectedSeries} onSelectSeries={handleSelectSeries} />
  </div>

  <div class="grid-area">
    <CollectionGrid
      {cards}
      {isLoading}
      {loadingMore}
      {hasMore}
      onCardClick={(card) => (selectedCard = card)}
      onLoadMore={loadMore}
    />
    <div class="total-hint">共 {total} 张卡</div>
  </div>

  <CollectionModal
    card={selectedCard}
    isOpen={!!selectedCard}
    onClose={() => (selectedCard = null)}
    onChanged={refreshAll}
  />
</div>

<style>
  .page-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px 24px 0;
    gap: 12px;
  }

  .page-header {
    display: flex;
    align-items: center;
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    color: var(--text-primary);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .ownership-group {
    display: flex;
    gap: 4px;
  }

  .seg-btn {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all 0.15s;
  }

  .seg-btn.active {
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
  }

  .search-input {
    flex: 1;
    min-width: 180px;
    max-width: 320px;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .stats-area {
    flex-shrink: 0;
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
  }

  .grid-area {
    flex: 1;
    overflow-y: auto;
    position: relative;
  }

  .total-hint {
    position: absolute;
    bottom: 8px;
    left: 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  @media (max-width: 600.99px) {
    .page-wrapper {
      padding: 12px 16px 0;
    }

    .search-input {
      max-width: none;
    }
  }
</style>