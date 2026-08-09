<script lang="ts">
  import type { VariantBucket } from '$lib/cards/utils/variant-utils'
  import { ChevronDown } from '@lucide/svelte'
  import { t } from '$lib/i18n'

  let {
    owned = {} as Partial<Record<VariantBucket, number>>,
    counts = {} as Partial<Record<VariantBucket, number>>,
    activeBucket = null as VariantBucket | null,
    onSelect = undefined as ((b: VariantBucket | null) => void) | undefined,
  } = $props()

  const BUCKET_ORDER: VariantBucket[] = ['base', 'alt', 'overnum', 'rune', 'token']

  const BUCKET_LABEL_KEYS: Record<VariantBucket, string> = {
    base: 'collection.bucketBase',
    alt: 'collection.bucketAlt',
    overnum: 'collection.bucketOvernum',
    rune: 'collection.bucketRune',
    token: 'collection.bucketToken',
  }

  // 默认收起，点击摘要展开；仅内存，不持久化
  let expanded = $state(false)

  // 存在桶筛选时自动展开，便于查看当前筛选状态
  $effect(() => {
    if (activeBucket) expanded = true
  })

  const totalOwned = $derived(BUCKET_ORDER.reduce((a, b) => a + (owned[b] ?? 0), 0))
  const totalCount = $derived(BUCKET_ORDER.reduce((a, b) => a + (counts[b] ?? 0), 0))
  const percent = $derived(totalCount > 0 ? Math.round((totalOwned / totalCount) * 100) : 0)
</script>

<div class="bucket-bar">
  <button
    class="bucket-summary"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
    title={expanded ? $t('collection.collapseBuckets') : $t('collection.expandBuckets')}
  >
    <strong>{$t('collection.seriesProgress')}</strong>
    <span class="muted">
      {totalOwned} / {totalCount}（{percent}%）
    </span>
    <span class="chevron-wrap" class:rotated={expanded}>
      <ChevronDown class="chevron" size={14} />
    </span>
  </button>

  {#if expanded}
    <div class="bucket-list">
      {#each BUCKET_ORDER as bucket (bucket)}
        {@const bOwned = owned[bucket] ?? 0}
        {@const bCount = counts[bucket] ?? 0}
        {@const done = bCount > 0 && bOwned >= bCount}
        <button
          class="bucket-item"
          class:active={activeBucket === bucket}
          class:done
          onclick={() => onSelect?.(activeBucket === bucket ? null : bucket)}
          title={`${$t(BUCKET_LABEL_KEYS[bucket])}：${bOwned}/${bCount}${bCount > 0 && bOwned < bCount ? `，${$t('collection.bucketMissing', { values: { count: bCount - bOwned } })}` : ''}`}
        >
          <span class="bucket-label">{$t(BUCKET_LABEL_KEYS[bucket])}</span>
          <span class="bucket-metrics" class:missing={bCount > 0 && bOwned < bCount}>
            {bOwned}/{bCount}
          </span>
          <span class="bucket-fill-track">
            <span
              class="bucket-fill"
              class:full={done}
              style={`width: ${bCount > 0 ? Math.min(100, (bOwned / bCount) * 100) : 0}%`}
            ></span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bucket-bar {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .bucket-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    padding: 4px 6px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    width: fit-content;
  }

  .bucket-summary:hover {
    background: var(--bg-hover);
  }

  .chevron-wrap {
    display: inline-flex;
    align-items: center;
  }

  :global(.chevron-wrap .chevron) {
    transition: transform 0.15s;
    color: var(--text-secondary);
  }

  :global(.chevron-wrap.rotated .chevron) {
    transform: rotate(180deg);
  }

  .muted {
    color: var(--text-secondary);
  }

  .bucket-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    animation: slideDown 0.18s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .bucket-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    min-width: 96px;
    padding: 6px 8px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .bucket-item:hover {
    border-color: var(--accent-color);
  }

  .bucket-item.active {
    border-color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-secondary));
  }

  .bucket-item.done {
    border-color: #eab308;
  }

  .bucket-label {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .bucket-metrics {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .bucket-metrics.missing {
    color: #ef4444;
    font-weight: 600;
  }

  .bucket-fill-track {
    height: 5px;
    border-radius: 99px;
    background: var(--border-color);
    overflow: hidden;
  }

  .bucket-fill {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: #4ade80;
    transition: width 0.3s ease;
  }

  .bucket-fill.full {
    background: #eab308;
  }

  /* 手机：默认收起，列表展开时更紧凑 */
  @media (max-width: 479.99px) {
    .bucket-bar {
      gap: 6px;
    }

    .bucket-summary {
      font-size: var(--text-xs);
      padding: 2px 4px;
      gap: 6px;
    }

    .bucket-item {
      min-width: 88px;
      padding: 4px 6px;
      gap: 3px;
    }

    .bucket-fill-track {
      height: 4px;
    }
  }
</style>
