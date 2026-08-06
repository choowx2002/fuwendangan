<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import type {
    CardPrint,
    CardWithOwned,
    CollectionSort,
    CollectionStats,
    CollectionItem,
    OwnershipType,
    SeriesStats,
    VariantWithOwned,
  } from '$lib/db'
  import {
    bulkDeleteCollection,
    bulkIncrement,
    bulkMarkOwned,
    getCardById,
    getCollectionStats,
    getPrintsByCardId,
    getVariantLangs,
    isTauri,
    searchCardVariants,
    upsertLangQty,
  } from '$lib/db'
  import { ArrowLeft, ListChecks, Save, X } from '@lucide/svelte'
  import type { VariantBucket } from '$lib/cards/utils/variant-utils'
  import BucketProgressBar from '$lib/components/collection/BucketProgressBar.svelte'
  import CollectionGrid from '$lib/components/collection/CollectionGrid.svelte'
  import CollectionModal from '$lib/components/collection/CollectionModal.svelte'
  import CollectionSortDropdown from '$lib/components/collection/CollectionSortDropdown.svelte'
  import BatchToolbar from '$lib/components/collection/BatchToolbar.svelte'

  const PAGE_SIZE = 42
  const seriesCode = (page.params.seriesCode ?? '').toUpperCase()

  let stats = $state<CollectionStats | null>(null)
  let ownership = $state<OwnershipType>('all')
  let sort = $state<CollectionSort>({ key: 'card_no', isAsc: true })
  let searchText = $state('')
  let activeBucket = $state<VariantBucket | null>(null)

  let cards = $state<VariantWithOwned[]>([])
  let pageNum = $state(1)
  let total = $state(0)
  let hasMore = $state(true)
  let isLoading = $state(false)
  let loadingMore = $state(false)
  let selectedCard = $state<(CardWithOwned & { card_prints?: CardPrint[] }) | null>(null)
  let initialVariant = $state('')

  let batchMode = $state(false)
  let selectedIds = $state<Set<string>>(new Set())
  let batchBusy = $state(false)

  let toastMsg = $state('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const OWNERSHIP_OPTIONS: { key: OwnershipType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'owned', label: '已拥有' },
    { key: 'missing', label: '未拥有' },
    { key: 'foil', label: '有闪卡' },
  ]

  const PREFS_KEY = `collection:prefs:${seriesCode}`

  const seriesStats = $derived<SeriesStats | undefined>(
    stats?.series.find((s) => s.code.toUpperCase() === seriesCode)
  )
  const seriesTitle = $derived(seriesStats?.nameCn ?? seriesCode)

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY)
      if (!raw) return
      const p = JSON.parse(raw) as {
        ownership?: OwnershipType
        sortKey?: CollectionSort['key']
        isAsc?: boolean
        bucket?: VariantBucket | null
      }
      if (p.ownership) ownership = p.ownership
      if (p.sortKey) sort = { key: p.sortKey, isAsc: p.isAsc ?? true }
      if (p.bucket) activeBucket = p.bucket
    } catch {
      // 忽略损坏的偏好
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          ownership,
          sortKey: sort.key,
          isAsc: sort.isAsc,
          bucket: activeBucket,
        })
      )
    } catch {
      // 存储不可用时忽略
    }
  }

  function showToast(msg: string) {
    toastMsg = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastMsg = ''), 2200)
  }

  async function loadStats() {
    stats = await getCollectionStats()
  }

  async function runSearch(reset: boolean) {
    if (reset) {
      pageNum = 1
      cards = []
    }
    isLoading = reset ? true : isLoading
    loadingMore = !reset
    try {
      const params: Record<string, unknown> = {
        page: pageNum,
        pageSize: PAGE_SIZE,
        ownership,
        collectionSort: sort,
        seriesCode,
      }
      if (searchText.trim()) params.searchText = searchText.trim()
      if (activeBucket) params.bucket = activeBucket
      const res = await searchCardVariants(params as never)
      total = res.total
      hasMore = res.page < res.totalPages
      cards = reset ? res.data : [...cards, ...res.data]
    } catch (err) {
      showToast(`加载失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      isLoading = false
      loadingMore = false
    }
  }

  function loadMore() {
    if (!hasMore || loadingMore || isLoading) return
    pageNum += 1
    void runSearch(false)
  }

  function refreshAll() {
    void loadStats()
    void runSearch(true)
  }

  function toggleBatchMode() {
    batchMode = !batchMode
    selectedIds = new Set()
  }

  function variantKey(card: VariantWithOwned): string {
    return `${card.cardId}:${card.cardNoExtend}`
  }

  function toggleSelect(card: VariantWithOwned) {
    const next = new Set(selectedIds)
    const key = variantKey(card)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    selectedIds = next
  }

  function selectedItems(): CollectionItem[] {
    const items: CollectionItem[] = []
    for (const card of cards) {
      if (!selectedIds.has(variantKey(card))) continue
      items.push({ cardNo: card.cardNo, cardNoExtend: card.cardNoExtend })
    }
    return items
  }

  async function batchMark() {
    const items = selectedItems()
    if (items.length === 0) return
    batchBusy = true
    try {
      const n = await bulkMarkOwned(items)
      showToast(`已标记 ${n} 张已拥有`)
    } catch (err) {
      showToast(`操作失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      batchBusy = false
      selectedIds = new Set()
      refreshAll()
    }
  }

  async function batchIncrement() {
    const items = selectedItems()
    if (items.length === 0) return
    batchBusy = true
    try {
      const n = await bulkIncrement(items)
      showToast(`已为 ${n} 张卡普卡 +1`)
    } catch (err) {
      showToast(`操作失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      batchBusy = false
      selectedIds = new Set()
      refreshAll()
    }
  }

  async function batchDelete() {
    const items = selectedItems()
    if (items.length === 0) return
    const confirmed = isTauri
      ? await (await import('@tauri-apps/plugin-dialog')).ask(
          `确定删除选中的 ${items.length} 张收藏记录？此操作不可恢复。`,
          { title: '删除收藏记录', kind: 'warning', okLabel: '删除', cancelLabel: '取消' }
        )
      : window.confirm(`确定删除选中的 ${items.length} 张收藏记录？此操作不可恢复。`)
    if (!confirmed) return
    batchBusy = true
    try {
      const n = await bulkDeleteCollection(items)
      showToast(`已删除 ${n} 条收藏记录`)
    } catch (err) {
      showToast(`操作失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      batchBusy = false
      selectedIds = new Set()
      refreshAll()
    }
  }

  function quickInc(card: VariantWithOwned) {
    card.ownedTotal += 1
    card.ownedNormal += 1
    void bulkIncrement([{ cardNo: card.cardNo, cardNoExtend: card.cardNoExtend }]).catch((err) => {
      showToast(`操作失败：${err instanceof Error ? err.message : '未知错误'}`)
      void runSearch(true)
    })
    void loadStats()
  }

  async function quickDec(card: VariantWithOwned) {
    try {
      const langs = await getVariantLangs(card.cardNo, card.cardNoExtend)
      const row = langs
        .filter((l) => l.status === 'owned' && (l.normal_qty > 0 || l.foil_qty > 0))
        .sort((a, b) => ((b.updated_at ?? '') as string).localeCompare((a.updated_at ?? '') as string))[0]
      if (!row) return
      const patch =
        row.normal_qty > 0 ? { normal: row.normal_qty - 1 } : { foil: row.foil_qty - 1 }
      if (row.normal_qty > 0) card.ownedNormal -= 1
      else card.ownedFoil -= 1
      card.ownedTotal -= 1
      await upsertLangQty(card.cardNo, card.cardNoExtend, row.language_code, patch)
      void loadStats()
    } catch (err) {
      showToast(`操作失败：${err instanceof Error ? err.message : '未知错误'}`)
      void runSearch(true)
    }
  }

  async function openCard(card: VariantWithOwned) {
    try {
      const [base, prints] = await Promise.all([
        getCardById(card.cardId),
        getPrintsByCardId(card.cardId),
      ])
      if (!base) return
      initialVariant = card.cardNoExtend
      selectedCard = {
        ...base,
        card_prints: prints,
        ownedNormal: card.ownedNormal,
        ownedFoil: card.ownedFoil,
        ownedTotal: card.ownedTotal,
        ownedVariants: card.ownedTotal > 0 ? 1 : 0,
        totalVariants: 1,
        lastEdited: card.lastEdited,
      }
    } catch (err) {
      showToast(`打开详情失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  onMount(() => {
    loadPrefs()
    void loadStats()
    void runSearch(true)
  })

  beforeNavigate(({ from, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) goto('/collection')
  })

  $effect(() => {
    void savePrefs()
  })
</script>

<div class="page-wrapper">
  <div class="page-header">
    <div class="header-left">
      <button class="back-btn" onclick={() => goto('/collection')} title="返回收藏总览">
        <ArrowLeft size={18} />
      </button>
      <h1 class="page-title">{seriesTitle}</h1>
      {#if seriesStats}
        <span class="header-progress">
          {seriesStats.totalOwned}/{seriesStats.totalCount}
          {seriesStats.totalCount > 0
            ? `（${Math.round((seriesStats.totalOwned / seriesStats.totalCount) * 100)}%）`
            : ''}
        </span>
      {/if}
    </div>
    <div class="header-right">
      <button
        class="button button-ghost"
        class:active={batchMode}
        onclick={toggleBatchMode}
        title="批量操作"
      >
        {#if batchMode}
          <X size={14} /> 退出批量
        {:else}
          <ListChecks size={14} /> 批量
        {/if}
      </button>
      <button
        class="button button-ghost"
        onclick={() =>
          void goto(
            `/collection/missing?seriesCode=${seriesCode}${activeBucket ? `&bucket=${activeBucket}` : ''}`
          )}
        title="缺卡清单"
      >
        <Save size={14} /> 缺卡清单
      </button>
    </div>
  </div>

  <div class="stats-area">
    <BucketProgressBar
      owned={seriesStats?.owned}
      counts={seriesStats?.counts}
      activeBucket={activeBucket}
      onSelect={(b) => {
        activeBucket = b
        void runSearch(true)
      }}
    />
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
      placeholder="搜索编号/画师/稀有度..."
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

  <div class="grid-area">
    <CollectionGrid
      {cards}
      {isLoading}
      {loadingMore}
      {hasMore}
      quickEdit
      {batchMode}
      selectedIds={selectedIds}
      onCardClick={openCard}
      onLoadMore={loadMore}
      onQuickInc={quickInc}
      onQuickDec={quickDec}
      onToggleSelect={toggleSelect}
    />
    <div class="total-hint">共 {total} 个变体</div>

    {#if batchMode}
      <BatchToolbar
        selectedCount={selectedIds.size}
        busy={batchBusy}
        onMark={batchMark}
        onIncrement={batchIncrement}
        onDelete={batchDelete}
        onCancel={toggleBatchMode}
      />
    {/if}
  </div>

  <CollectionModal
    card={selectedCard}
    isOpen={!!selectedCard}
    initialVariant={initialVariant}
    onClose={() => (selectedCard = null)}
    onChanged={refreshAll}
  />

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
    gap: 12px;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .back-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-progress {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    padding: 3px 10px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .header-right .button.active {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-secondary));
  }

  .stats-area {
    flex-shrink: 0;
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
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

    .search-input {
      max-width: none;
    }
  }
</style>
