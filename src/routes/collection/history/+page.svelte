<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import type {
    CollectionHistory,
    CollectionHistoryItem,
    CollectionHistoryOpType,
    CollectionStatsSnapshot,
    RecentCollectionCard,
  } from '$lib/db'
  import {
    getHistory,
    getHistoryItems,
    undoHistory,
    getCollectionSnapshots,
    captureCollectionSnapshot,
    getRecentCollectionCards,
    languageDisplayName,
  } from '$lib/db'
  import { History, Undo2, ChevronDown, Search, Camera } from '@lucide/svelte'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import RecentCollectionList from '$lib/components/collection/RecentCollectionList.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import { locale } from '$lib/stores/settings'

  const PAGE_SIZE = 30

  const OP_TYPE_LABELS: Record<CollectionHistoryOpType, string> = {
    upsert: 'collection.opUpsert',
    bulk_mark_owned: 'collection.opBulkMarkOwned',
    bulk_increment: 'collection.opBulkIncrement',
    bulk_delete: 'collection.opBulkDelete',
    csv_import: 'collection.opCsvImport',
    custom_print_create: 'collection.opCustomPrintCreate',
    custom_print_delete: 'collection.opCustomPrintDelete',
    custom_print_migrate: 'collection.opCustomPrintMigrate',
  }

  let rows = $state<CollectionHistory[]>([])
  let total = $state(0)
  let loading = $state(true)
  let opType = $state<CollectionHistoryOpType | ''>('')
  let q = $state('')
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let expandedId = $state<string | null>(null)
  let expandedItems = $state<CollectionHistoryItem[]>([])
  let itemsLoading = $state(false)
  let undoingId = $state<string | null>(null)
  let snapshots = $state<CollectionStatsSnapshot[]>([])
  let chartLoading = $state(true)
  let recent = $state<RecentCollectionCard[]>([])

  function handleRecentSelect(c: RecentCollectionCard) {
    if (c.seriesCode) void goto(`/collection/${c.seriesCode}`)
  }

  async function load(reset = true) {
    loading = true
    try {
      const offset = reset ? 0 : rows.length
      const res = await getHistory({
        offset,
        limit: PAGE_SIZE,
        opType: opType || undefined,
        q: q.trim() || undefined,
      })
      rows = reset ? res.rows : [...rows, ...res.rows]
      total = res.total
    } finally {
      loading = false
    }
  }

  async function loadSnapshots() {
    chartLoading = true
    try {
      snapshots = await getCollectionSnapshots(200)
    } finally {
      chartLoading = false
    }
  }

  function debouncedSearch() {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void load(true), 300)
  }

  async function toggleExpand(row: CollectionHistory) {
    if (expandedId === row.id) {
      expandedId = null
      expandedItems = []
      return
    }
    expandedId = row.id
    itemsLoading = true
    try {
      expandedItems = await getHistoryItems(row.id)
    } finally {
      itemsLoading = false
    }
  }

  async function handleUndo(row: CollectionHistory) {
    undoingId = row.id
    try {
      await undoHistory(row.id)
      showToast(get(t)('collection.undoSuccess'), 'success')
      rows = rows.map((r) => (r.id === row.id ? { ...r, isUndoable: false } : r))
      void loadSnapshots()
    } catch (err) {
      showToast(
        get(t)('collection.undoFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    } finally {
      undoingId = null
    }
  }

  async function handleManualSnapshot() {
    await captureCollectionSnapshot('manual')
    showToast(get(t)('collection.snapshotSuccess'), 'success')
    void loadSnapshots()
  }

  const groups = $derived.by(() => {
    const map = new Map<string, CollectionHistory[]>()
    for (const r of rows) {
      const d = new Date(r.createdAt).toLocaleDateString($locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      if (!map.has(d)) map.set(d, [])
      map.get(d)!.push(r)
    }
    return [...map.entries()]
  })

  const chart = $derived.by(() => {
    if (snapshots.length < 2) return null
    const W = 600
    const H = 150
    const P = 10
    const vals = snapshots.map((s) => s.overallOwned)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const range = Math.max(max - min, 1)
    const stepX = (W - P * 2) / (vals.length - 1)
    const pts = vals.map((v, i) => ({
      x: +(P + i * stepX).toFixed(1),
      y: +(H - P - ((v - min) / range) * (H - P * 2)).toFixed(1),
      v,
    }))
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    const area = `${line} L${pts[pts.length - 1].x},${H - P} L${pts[0].x},${H - P} Z`
    return { pts, line, area, min, max, current: vals[vals.length - 1] }
  })

  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' })
  }

  function describe(it: CollectionHistoryItem, prefix: 'old' | 'new'): string {
    const parts: string[] = []
    const status = prefix === 'old' ? it.oldStatus : it.newStatus
    const n = prefix === 'old' ? it.oldNormalQty : it.newNormalQty
    const f = prefix === 'old' ? it.oldFoilQty : it.newFoilQty
    if (status) parts.push(status)
    if (n != null) parts.push(get(t)('collection.normalCount', { values: { count: n } }))
    if (f != null) parts.push(get(t)('collection.foilCount', { values: { count: f } }))
    return parts.join(' ')
  }

  function changeText(it: CollectionHistoryItem): string {
    const hasOld = it.oldNormalQty != null || it.oldFoilQty != null || it.oldStatus != null
    const hasNew = it.newNormalQty != null || it.newFoilQty != null || it.newStatus != null
    const before = describe(it, 'old')
    const after = describe(it, 'new')
    if (hasOld && hasNew) return `${before} → ${after}`
    if (hasOld) return `${before} → ${get(t)('collection.deleted')}`
    if (hasNew) return get(t)('collection.added', { values: { text: after } })
    return '—'
  }

  $effect(() => {
    setTopbar({
      title: $t('collection.history'),
      description: $t('collection.historyDesc'),
      onBack: () => void goto('/collection'),
      actions: [
        {
          key: 'snapshot',
          label: $t('collection.recordSnapshot'),
          icon: Camera,
          variant: 'ghost',
          title: $t('collection.recordSnapshotTitle'),
          onClick: () => void handleManualSnapshot(),
        },
      ],
    })
  })

  onMount(() => {
    void load(true)
    void loadSnapshots()
    void getRecentCollectionCards(6).then((r) => (recent = r)).catch(() => {})
  })
</script>

<div class="page-wrapper">
  <div class="filter-bar">
    <select class="type-select" bind:value={opType} onchange={() => void load(true)}>
      <option value="">{$t('collection.allTypes')}</option>
      {#each Object.entries(OP_TYPE_LABELS) as [key, labelKey]}
        <option value={key}>{$t(labelKey)}</option>
      {/each}
    </select>
    <div class="search-box search-bar search-bar--sm">
      <Search size={15} class="search-bar-icon" />
      <input class="search-bar-input" bind:value={q} oninput={debouncedSearch} placeholder={$t('collection.historySearchPlaceholder')} />
    </div>
  </div>

  <div class="recent-card">
    <RecentCollectionList {recent} onSelect={handleRecentSelect} />
  </div>

  <div class="chart-card">
    <div class="chart-header">
      <span class="chart-title">{$t('collection.progressTrend')}</span>
      <span class="chart-sub">{$t('collection.snapshotCount', { values: { count: snapshots.length } })}</span>
    </div>
    {#if chartLoading && snapshots.length === 0}
      <div class="chart-empty">{$t('common.loading')}</div>
    {:else if !chart}
      <div class="chart-empty">{$t('collection.notEnoughSnapshots')}</div>
    {:else}
      <svg class="trend-chart" viewBox="0 0 600 150" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent-color)" stop-opacity="0.3" />
            <stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0.02" />
          </linearGradient>
        </defs>
        <path d={chart.area} fill="url(#areaGrad)" />
        <path
          d={chart.line}
          fill="none"
          stroke="var(--accent-color)"
          stroke-width="2"
          stroke-linejoin="round"
        />
        {#each chart.pts as p}
          <circle cx={p.x} cy={p.y} r="2.5" fill="var(--accent-color)" />
        {/each}
      </svg>
      <div class="chart-meta">
        <span>{$t('collection.chartMin', { values: { count: chart.min } })}</span>
        <span>{$t('collection.chartCurrent', { values: { count: chart.current } })}</span>
      </div>
    {/if}
  </div>

  <div class="timeline">
    {#each groups as [date, items]}
      <div class="date-group">
        <div class="date-label">{date}</div>
        {#each items as row}
          <div class="history-row" class:expanded={expandedId === row.id}>
            <div
              class="row-main"
              role="button"
              tabindex="0"
              onclick={() => void toggleExpand(row)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') void toggleExpand(row)
              }}
            >
              <div class="row-title">
                <span class="row-icon"><History size={16} /></span>
                <span class="op-label">{$t(OP_TYPE_LABELS[row.opType] ?? '')}</span>
                {#if row.note}
                  <span class="note">{row.note}</span>
                {/if}
              </div>
              <div class="row-meta">
                {#if row.isUndoable}
                  <button
                    class="undo-btn"
                    title={$t('collection.undoTitle')}
                    disabled={undoingId === row.id}
                    onclick={(e) => {
                      e.stopPropagation()
                      void handleUndo(row)
                    }}
                  >
                    {#if undoingId === row.id}
                      <span class="undo-spin">…</span>
                    {:else}
                      <Undo2 size={14} />
                    {/if}
                    {$t('collection.undo')}
                  </button>
                {/if}
                <span class="item-count">{$t('collection.itemCount', { values: { count: row.itemCount } })}</span>
                <span class="time">{formatTime(row.createdAt)}</span>
                <span class={expandedId === row.id ? 'chevron rotate' : 'chevron'}>
                  <ChevronDown size={16} />
                </span>
              </div>
            </div>
            {#if expandedId === row.id}
              <div class="row-detail">
                {#if itemsLoading}
                  <div class="detail-loading">{$t('common.loading')}</div>
                {:else if expandedItems.length === 0}
                  <div class="detail-loading">{$t('collection.noDetail')}</div>
                {:else}
                  {#each expandedItems as it}
                    <div class="detail-row">
                      <span class="detail-name">
                        {it.cardNameCn ?? it.cardNo}
                        <span class="detail-sub">{it.cardNoExtend}</span>
                      </span>
                      <span class="detail-lang">{languageDisplayName(it.languageCode)}</span>
                      <span class="detail-change">{changeText(it)}</span>
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/each}

    {#if !loading && rows.length === 0}
      <div class="empty-tip">{$t('collection.noHistory')}</div>
    {/if}

    {#if rows.length < total}
      <div class="load-more-wrap">
        <button class="button button-ghost" onclick={() => void load(false)} disabled={loading}>
          {loading ? $t('common.loading') : $t('collection.loadMore', { values: { current: rows.length, total } })}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .page-wrapper {
    padding: 16px;
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .filter-bar {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .type-select {
    padding: 6px 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .search-box {
    flex: 1;
  }

  .recent-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 14px 16px;
  }

  .chart-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 14px 16px 10px;
  }

  .chart-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
  }

  .chart-title {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .chart-sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .trend-chart {
    width: 100%;
    height: 130px;
    display: block;
  }

  .chart-meta {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .chart-empty {
    padding: 40px 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .date-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .date-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .history-row {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .history-row.expanded {
    border-color: var(--accent-color);
  }

  .row-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    cursor: pointer;
  }

  .row-main:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: -2px;
  }

  .row-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .row-icon {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .op-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .note {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .undo-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .undo-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .undo-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .undo-spin {
    display: inline-block;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .item-count,
  .time {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .chevron {
    color: var(--text-tertiary);
    transition: transform 0.15s ease;
  }

  .chevron.rotate {
    transform: rotate(180deg);
  }

  .row-detail {
    border-top: 1px solid var(--border-color);
    padding: 8px 14px;
    max-height: 320px;
    overflow-y: auto;
  }

  .detail-loading {
    padding: 12px 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-align: center;
  }

  .detail-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px dashed var(--border-color);
    font-size: var(--text-sm);
  }

  .detail-row:last-child {
    border-bottom: none;
  }

  .detail-name {
    color: var(--text-primary);
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .detail-lang {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .detail-change {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .empty-tip {
    padding: 40px 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .load-more-wrap {
    display: flex;
    justify-content: center;
    padding: 8px 0;
  }
</style>
