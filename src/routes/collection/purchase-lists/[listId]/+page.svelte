<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { RefreshCw, Trash2 } from '@lucide/svelte'
  import { page } from '$app/state'
  import {
    getPurchaseList,
    getPurchaseListItems,
    updatePurchaseListItemStatus,
    removePurchaseListItem,
    refreshPurchaseListFromDeck,
    printCacheName,
    type PurchaseList,
    type PurchaseListItem,
    type PurchaseListItemStatus,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  const listId = $derived(page.params.listId ?? '')

  type ItemRow = Awaited<ReturnType<typeof getPurchaseListItems>>[number]

  let list = $state<PurchaseList | null>(null)
  let items = $state<ItemRow[]>([])
  let loading = $state(true)
  let refreshing = $state(false)
  let matchMode = $state<import('$lib/db').OwnershipMatchMode>('print')

  const STATUSES: PurchaseListItemStatus[] = ['pending', 'ordered', 'bought', 'skipped']

  const totalToBuy = $derived(items.reduce((sum, i) => sum + i.qty_to_buy, 0))

  async function load() {
    loading = true
    try {
      const [listRes, itemRes] = await Promise.all([
        getPurchaseList(listId),
        getPurchaseListItems(listId),
      ])
      list = listRes
      matchMode = listRes?.match_mode ?? 'print'
      items = itemRes
    } finally {
      loading = false
    }
  }

  async function refresh(mode?: import('$lib/db').OwnershipMatchMode) {
    if (!list?.deck_id) {
      showToast(get(t)('purchase.noDeckLinked'), 'error')
      return
    }
    refreshing = true
    try {
      const count = await refreshPurchaseListFromDeck(
        listId,
        mode ? { matchMode: mode } : undefined
      )
      showToast(get(t)('purchase.refreshed', { values: { count } }), 'success')
      void load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      refreshing = false
    }
  }

  async function switchMode(mode: import('$lib/db').OwnershipMatchMode) {
    if (mode === matchMode || refreshing) return
    matchMode = mode
    await refresh(mode)
  }

  async function setStatus(item: PurchaseListItem, status: PurchaseListItemStatus) {
    await updatePurchaseListItemStatus(item.id, status)
    void load()
  }

  async function remove(item: PurchaseListItem) {
    await removePurchaseListItem(item.id)
    void load()
  }

  function statusLabel(status: PurchaseListItemStatus): string {
    return get(t)(`purchase.itemStatus.${status}`)
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: list?.name ?? $t('purchase.detail'),
      onBack: () => void goto('/collection/purchase-lists'),
      actions: [
        {
          key: 'refresh',
          label: $t('purchase.refresh'),
          icon: RefreshCw,
          title: $t('purchase.refreshHint'),
          onClick: () => void refresh(),
        },
      ],
    })
  })
</script>

<div class="page">
  {#if loading}
    <div class="loading-tip">{$t('common.loading')}</div>
  {:else if !list}
    <EmptyState title={$t('purchase.notFound')} />
  {:else if items.length === 0}
    <EmptyState
      title={$t('purchase.itemsEmpty')}
      description={$t('purchase.refreshHint')}
      actionLabel={$t('purchase.refresh')}
      onAction={() => void refresh()}
    />
  {:else}
    <div class="toolbar">
      <div class="mode-toggle">
        <button
          class="mode-option"
          class:active={matchMode === 'card'}
          disabled={refreshing}
          onclick={() => void switchMode('card')}
        >
          {$t('purchase.byCard')}
        </button>
        <button
          class="mode-option"
          class:active={matchMode === 'print'}
          disabled={refreshing}
          onclick={() => void switchMode('print')}
        >
          {$t('purchase.byPrint')}
        </button>
      </div>
      <div class="summary">
        <span>{$t('purchase.items')} {items.length}</span>
        <span>{$t('purchase.totalToBuy')} {totalToBuy}</span>
      </div>
    </div>

    <div class="list">
      {#each items as item (item.id)}
        <div class="row" class:bought={item.status === 'bought'}>
          <div style="display: flex; justify-content: end; column-gap: 8px;">
            <CardSimpleImage
              url={item.img_cdn}
              name={printCacheName({
                card_no_extend: item.card_no_extend,
                language: item.img_lang,
                id: item.card_no,
              })}
              className="row-thumb"
            />
            <div class="row-main">
              <div class="row-title">
                <span class="row-name">{item.card_name_cn || item.card_no}</span>
                <span class="row-extend">
                  {item.card_no_extend ? item.card_no_extend : $t('purchase.anyVariant')}
                </span>
              </div>
              <div class="row-meta">
                <span class="meta-item">{$t('purchase.required')} {item.qty_required}</span>
                <span class="meta-item">{$t('purchase.owned')} {item.qty_owned}</span>
                <span class="meta-item to-buy">{$t('purchase.toBuy')} {item.qty_to_buy}</span>
              </div>
              <div class="status-row">
                {#each STATUSES as s (s)}
                  <button
                    class="status-chip"
                    class:active={item.status === s}
                    onclick={() => setStatus(item, s)}
                  >
                    {statusLabel(s)}
                  </button>
                {/each}
              </div>
            </div>
          </div>

          <button
            class="icon-btn danger"
            style="position: absolute; right: 1%; top 1%;"
            title={$t('common.delete')}
            onclick={() => remove(item)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px 4px;
    flex-wrap: wrap;
  }

  .mode-toggle {
    display: flex;
    gap: 8px;
  }

  .mode-option {
    padding: 5px 14px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .mode-option.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
  }

  .summary {
    display: flex;
    gap: 16px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .list {
    display: grid;
    flex-direction: column;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 8px;
    padding: 12px 16px 24px;
  }

  @media (max-width: 767.99px) {
    .list {
      display: flex;
      flex-direction: column;
    }
  }

  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    position: relative;
  }

  .row.bought {
    opacity: 0.55;
  }

  :global(.row-thumb) {
    width: 56px;
    height: 78px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .row-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row-title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .row-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .row-extend {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: monospace;
  }

  .row-meta {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .to-buy {
    color: #d97706;
    font-weight: 600;
  }

  .status-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .status-chip {
    padding: 3px 10px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .status-chip.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
  }

  .icon-btn.danger:hover {
    color: #e5484d;
  }

  .loading-tip {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }
</style>
