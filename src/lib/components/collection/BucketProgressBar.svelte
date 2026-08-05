<script lang="ts">
  import {
    BUCKET_LABELS,
    type VariantBucket,
  } from '$lib/cards/utils/variant-utils'

  let {
    owned = {} as Partial<Record<VariantBucket, number>>,
    counts = {} as Partial<Record<VariantBucket, number>>,
    activeBucket = null as VariantBucket | null,
    onSelect = undefined as ((b: VariantBucket | null) => void) | undefined,
  } = $props()

  const BUCKET_ORDER: VariantBucket[] = ['base', 'alt', 'overnum', 'rune', 'token']

  const totalOwned = $derived(
    BUCKET_ORDER.reduce((a, b) => a + (owned[b] ?? 0), 0)
  )
  const totalCount = $derived(
    BUCKET_ORDER.reduce((a, b) => a + (counts[b] ?? 0), 0)
  )
  const percent = $derived(
    totalCount > 0 ? Math.round((totalOwned / totalCount) * 100) : 0
  )
</script>

<div class="bucket-bar">
  <div class="bucket-summary">
    <strong>系列进度</strong>
    <span class="muted">
      {totalOwned} / {totalCount}（{percent}%）
    </span>
  </div>

  <div class="bucket-list">
    {#each BUCKET_ORDER as bucket (bucket)}
      {@const bOwned = owned[bucket] ?? 0}
      {@const bCount = counts[bucket] ?? 0}
      {@const done = bCount > 0 && bOwned >= bCount}
      <button
        class="bucket-item"
        class:active={activeBucket === bucket}
        class:done={done}
        onclick={() => onSelect?.(activeBucket === bucket ? null : bucket)}
        title={`${BUCKET_LABELS[bucket]}：${bOwned}/${bCount}${bCount > 0 && bOwned < bCount ? `，还缺 ${bCount - bOwned} 张` : ''}`}
      >
        <span class="bucket-label">{BUCKET_LABELS[bucket]}</span>
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
</div>

<style>
  .bucket-bar {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .bucket-summary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--text-sm);
  }

  .muted {
    color: var(--text-secondary);
  }

  .bucket-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .bucket-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
    min-width: 108px;
    padding: 8px 10px;
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
</style>
