<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import type { CollectionStats, RecentCollectionCard } from '$lib/db'
  import { getCollectionStats, getRecentCollectionCards } from '$lib/db'
  import { Save } from '@lucide/svelte'
  import CollectionHero from '$lib/components/collection/CollectionHero.svelte'
  import SeriesCardGrid from '$lib/components/collection/SeriesCardGrid.svelte'
  import GlobalCollectionSearch from '$lib/components/collection/GlobalCollectionSearch.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import { deriveSeriesCode } from '$lib/collection/collection-utils'

  let stats = $state<CollectionStats | null>(null)
  let recent = $state<RecentCollectionCard[]>([])
  let loading = $state(true)
  let toastMsg = $state('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  function showToast(msg: string) {
    toastMsg = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastMsg = ''), 2200)
  }

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
</script>

<div class="page-wrapper">
  <div class="page-header">
    <h1 class="page-title">收藏与闪卡</h1>
    <div class="header-tools">
      <GlobalCollectionSearch onSelect={handleGlobalSelect} />
      <button
        class="button button-ghost"
        onclick={() => void goto('/collection/missing')}
        title="缺卡清单"
      >
        <Save size={14} /> 缺卡清单
      </button>
    </div>
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

  {#if toastMsg}
    <div class="toast">{toastMsg}</div>
  {/if}
</div>

<style>
  .page-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px 24px 0;
    gap: 14px;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    color: var(--text-primary);
  }

  .header-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .hero-area {
    flex-shrink: 0;
  }

  .series-area {
    flex: 1;
    overflow-y: auto;
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
  }

  .loading-tip {
    padding: 48px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1200;
    padding: 9px 18px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.82);
    color: #fff;
    font-size: var(--text-sm);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    animation: toast-in 0.2s ease;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @media (max-width: 600.99px) {
    .page-wrapper {
      padding: 12px 16px 0;
    }

    .header-tools {
      width: 100%;
    }
  }
</style>
