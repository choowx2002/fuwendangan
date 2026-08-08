<script lang="ts">
  import type { VariantWithOwned } from '$lib/db'
  import { BUCKET_LABELS } from '$lib/cards/utils/variant-utils'
  import { LoaderCircle, Plus, Minus, Check } from '@lucide/svelte'
  import EmptyState from './EmptyState.svelte'

  let {
    cards = [] as VariantWithOwned[],
    isLoading = false,
    loadingMore = false,
    hasMore = false,
    onCardClick = undefined as ((card: VariantWithOwned) => void) | undefined,
    onLoadMore = undefined as (() => void) | undefined,
    quickEdit = false,
    onQuickInc = undefined as ((card: VariantWithOwned) => void) | undefined,
    onQuickDec = undefined as ((card: VariantWithOwned) => void) | undefined,
    batchMode = false,
    selectedIds = new Set<string>() as Set<string>,
    onToggleSelect = undefined as ((card: VariantWithOwned) => void) | undefined,
  } = $props()

  let sentinelEl = $state<HTMLElement | undefined>(undefined)

  function cardKey(card: VariantWithOwned): string {
    return `${card.cardId}:${card.cardNoExtend}`
  }

  $effect(() => {
    const el = sentinelEl
    if (!el || !onLoadMore) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && hasMore) onLoadMore()
      },
      { rootMargin: '300px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  })
</script>

<div class="collection-table">
  {#if isLoading && cards.length === 0}
    <div class="skeleton-rows">
      {#each Array(8) as _, i (i)}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if cards.length === 0}
    <EmptyState title="未找到匹配变体" description="试试调整筛选条件或搜索关键词" />
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {#if batchMode}<th class="col-check"></th>{/if}
            <th class="col-no">变体</th>
            <th class="col-rarity">稀有度</th>
            <th class="col-qty">普卡</th>
            <th class="col-qty">闪卡</th>
            <th class="col-qty">合计</th>
            {#if quickEdit && !batchMode}<th class="col-actions">操作</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each cards as card (cardKey(card))}
            {@const selected = selectedIds.has(cardKey(card))}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <tr
              class:selected
              class:custom={card.isCustom}
              class:missing={card.ownedTotal === 0}
              onclick={() => {
                if (batchMode) {
                  onToggleSelect?.(card)
                } else {
                  onCardClick?.(card)
                }
              }}
            >
              {#if batchMode}
                <td class="col-check">
                  <span class="check" class:checked={selected}>
                    {#if selected}<Check size={12} strokeWidth={'5'} />{/if}
                  </span>
                </td>
              {/if}
              <td>
                <div class="no-row">
                  <span class="no">{card.cardNoExtend}</span>
                  {#if card.isCustom}
                    <span class="custom-chip">自定</span>
                  {/if}
                  {#if card.bucket !== 'base'}
                    <span class="bucket-chip">{BUCKET_LABELS[card.bucket]}</span>
                  {/if}
                </div>
              </td>
              <td class="col-rarity">{card.extendRarityName ?? card.rarityName ?? '—'}</td>
              <td class="col-qty">{card.ownedNormal > 0 ? card.ownedNormal : 0}</td>
              <td class="col-qty foil">{card.ownedFoil > 0 ? card.ownedFoil : 0}</td>
              <td class="col-qty total">{card.ownedTotal}</td>
              {#if quickEdit && !batchMode}
                <td class="col-actions">
                  <div class="row-actions">
                    {#if card.ownedTotal > 0}
                      <button
                        class="row-step"
                        title="减一"
                        onclick={(e) => {
                          e.stopPropagation()
                          onQuickDec?.(card)
                        }}
                        disabled={card.ownedTotal <= 0}
                      >
                        <Minus size={13} />
                      </button>
                      <button
                        class="row-step inc"
                        title="加一"
                        onclick={(e) => {
                          e.stopPropagation()
                          onQuickInc?.(card)
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    {:else}
                      <button
                        class="row-step inc wide"
                        title="标记拥有 1 张"
                        onclick={(e) => {
                          e.stopPropagation()
                          onQuickInc?.(card)
                        }}
                      >
                        <Plus size={13} strokeWidth={'5'} /> 拥有
                      </button>
                    {/if}
                  </div>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if hasMore}
      <div bind:this={sentinelEl} class="sentinel">
        {#if loadingMore}
          <LoaderCircle class="animate-spin" size={16} />
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .collection-table {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 2px 24px;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: 10px;
  }

  table {
    width: 100%;
    min-width: 560px;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  thead th {
    position: sticky;
    top: 0;
    background: var(--bg-secondary);
    color: var(--text-tertiary);
    font-weight: 600;
    font-size: var(--text-xs);
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }

  tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
    color: var(--text-primary);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr {
    cursor: pointer;
    transition: background 0.1s;
  }

  tbody tr:hover {
    background: var(--bg-hover);
  }

  tbody tr.selected {
    background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
  }

  .col-check {
    width: 36px;
    text-align: center;
  }

  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1.5px solid var(--border-color);
    background: var(--bg-primary);
    color: #fff;
  }

  .check.checked {
    background: var(--accent-color);
    border-color: var(--accent-color);
  }

  .no-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .no {
    font-weight: 600;
    white-space: nowrap;
  }

  .bucket-chip {
    flex-shrink: 0;
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    background: var(--bg-secondary);
  }

  .custom-chip {
    flex-shrink: 0;
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 99px;
    border: 1px solid rgba(168, 85, 247, 0.4);
    color: #a855f7;
    background: color-mix(in srgb, #a855f7 8%, var(--bg-primary));
  }

  .col-rarity {
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .col-qty {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .col-qty.foil {
    color: #eab308;
  }

  .col-qty.total {
    font-weight: 700;
  }

  tr.missing .total {
    color: var(--text-tertiary);
  }

  .col-actions {
    text-align: right;
    white-space: nowrap;
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .row-step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 26px;
    height: 26px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
  }

  .row-step:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .row-step.inc {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: #fff;
  }

  .row-step.inc:hover {
    background: color-mix(in oklab, var(--accent-color) 85%, black);
  }

  .row-step.wide {
    width: auto;
    padding: 0 8px;
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .row-step:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .skeleton-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .skeleton-row {
    height: 44px;
    border-radius: 8px;
    background: linear-gradient(
      90deg,
      var(--bg-secondary) 25%,
      var(--bg-hover) 50%,
      var(--bg-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.2s infinite;
  }

  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  .sentinel {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 0;
    color: var(--text-secondary);
  }

  @media (max-width: 479.99px) {
    .collection-table {
      padding-right: 0;
    }

    .col-rarity {
      display: none;
    }

    .col-actions {
      display: none;
    }
  }
</style>
