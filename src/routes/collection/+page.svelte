<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import type { CollectionStats, RecentCollectionCard } from '$lib/db'
  import { getCollectionStats, getRecentCollectionCards } from '$lib/db'
  import { Save, Plus } from '@lucide/svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import CollectionHero from '$lib/components/collection/CollectionHero.svelte'
  import SeriesCardGrid from '$lib/components/collection/SeriesCardGrid.svelte'
  import GlobalCollectionSearch from '$lib/components/collection/GlobalCollectionSearch.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import CustomPrintCreator from '$lib/components/collection/CustomPrintCreator.svelte'
  import { deriveSeriesCode } from '$lib/collection/collection-utils'

  let stats = $state<CollectionStats | null>(null)
  let recent = $state<RecentCollectionCard[]>([])
  let loading = $state(true)
  let showCustomCreate = $state(false)

  async function loadAll() {
    loading = true
    try {
      const [statsRes, recentRes] = await Promise.all([
        getCollectionStats(),
        getRecentCollectionCards(6),
      ])
      stats = statsRes
      recent = recentRes
    } finally {
      loading = false
    }
  }

  function handleGlobalSelect(card: { card_prints?: { card_no_extend: string }[] }) {
    const code = deriveSeriesCode(card.card_prints?.[0]?.card_no_extend)
    if (code) {
      void goto(`/collection/${code}`)
    }
  }

  function handleRecentClick(c: RecentCollectionCard) {
    if (c.seriesCode) void goto(`/collection/${c.seriesCode}`)
  }

  onMount(() => {
    void loadAll()
  })

  $effect(() => {
    setTopbar({
      title: '收藏与闪卡',
      actions: [
        {
          key: 'custom',
          label: '自定义卡',
          icon: Plus,
          title: '新建自定义卡',
          onClick: () => (showCustomCreate = true),
        },
        {
          key: 'missing',
          label: '缺卡清单',
          icon: Save,
          onClick: () => void goto('/collection/missing'),
        },
      ],
    })
  })
</script>

<div class="page-wrapper">
  <div class="search-row">
    <GlobalCollectionSearch onSelect={handleGlobalSelect} />
  </div>

  <div class="hero-area">
    <CollectionHero stats={stats ?? undefined} {recent} onRecentClick={handleRecentClick} />
  </div>

  <div class="series-area">
    {#if loading && !stats}
      <div class="loading-tip">正在加载收藏进度...</div>
    {:else if stats && stats.series.length === 0}
      <EmptyState
        title="还没有收藏记录"
        description="去卡牌图鉴浏览全部卡牌，把拥有的卡录入收藏吧"
        actionLabel="浏览卡牌图鉴"
        onAction={() => void goto('/cards')}
      />
    {:else}
      <SeriesCardGrid
        series={stats?.series ?? []}
        onSelect={(code) => void goto(`/collection/${code}`)}
      />
    {/if}
  </div>

  <CustomPrintCreator
    isOpen={showCustomCreate}
    onClose={() => (showCustomCreate = false)}
    onSaved={() => void loadAll()}
  />
</div>

<style>
  .page-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px 24px 0;
    gap: 14px;
  }

  .search-row {
    flex-shrink: 0;
  }

  .hero-area {
    flex-shrink: 0;
  }

  .series-area {
    flex: 1;
    /* overflow-y: auto; */
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
  }

  .loading-tip {
    padding: 48px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  @media (max-width: 600.99px) {
    .page-wrapper {
      padding: 12px 16px 0;
    }
  }
</style>
