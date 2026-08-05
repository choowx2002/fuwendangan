<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import type { CollectionStats, RecentCollectionCard } from '$lib/db'
  import { getCollectionStats, getMissingCards, getRecentCollectionCards } from '$lib/db'
  import { ClipboardCopy, Save } from '@lucide/svelte'
  import {
    buildMissingListText,
    copyMissingList,
    saveMissingList,
  } from '$lib/collection/collection-export'
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

  async function exportList(action: 'copy' | 'save') {
    try {
      const missing = await getMissingCards()
      const text = buildMissingListText(
        missing,
        null,
        stats?.overallOwned ?? 0,
        stats?.overallCount ?? 0
      )
      const stamp = new Date().toISOString().slice(0, 10)
      if (action === 'copy') {
        const ok = await copyMissingList(text)
        showToast(ok ? `已复制 ${missing.length} 条缺卡清单` : '复制失败，请重试')
      } else {
        const ok = await saveMissingList(text, `缺卡清单-全部系列-${stamp}.txt`)
        if (ok) showToast(`已保存 ${missing.length} 条缺卡清单`)
      }
    } catch (err) {
      showToast(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
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
      <button class="button button-ghost" onclick={() => exportList('copy')} title="复制缺卡清单">
        <ClipboardCopy size={14} /> 复制清单
      </button>
      <button class="button button-ghost" onclick={() => exportList('save')} title="保存缺卡清单">
        <Save size={14} /> 保存清单
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
