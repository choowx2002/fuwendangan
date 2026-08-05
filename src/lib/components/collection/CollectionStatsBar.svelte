<script lang="ts">
  import type { CollectionStats } from '$lib/db'
  import { BUCKET_LABELS, type VariantBucket } from '$lib/cards/utils/variant-utils'

  let {
    stats = undefined as CollectionStats | undefined,
    selectedSeries = 'all' as string,
    onSelectSeries = undefined as ((code: string) => void) | undefined,
  } = $props()

  const BUCKET_ORDER: VariantBucket[] = ['base', 'alt', 'overnum', 'rune', 'token']

  const overallPercent = $derived(
    stats && stats.overallCount > 0
      ? Math.round((stats.overallOwned / stats.overallCount) * 100)
      : 0
  )
</script>

<div class="stats-bar">
  <div class="overall-row">
    <div class="overall-label">
      <strong>总进度</strong>
      <span class="muted">
        {stats?.overallOwned ?? 0} / {stats?.overallCount ?? 0}（{overallPercent}%）
      </span>
      <span class="chip promo-chip">Promo ×{stats?.promoOwned ?? 0}</span>
      <span class="chip foil-chip">闪卡 ×{stats?.foilOwned ?? 0}</span>
    </div>
    <div class="progress-track">
      <div class="progress-fill" style={`width: ${overallPercent}%`}></div>
    </div>
  </div>

  <div class="series-list">
    <button
      class="series-item"
      class:active={selectedSeries === 'all'}
      onclick={() => onSelectSeries?.('all')}
    >
      <span class="series-name">全部系列</span>
      <span class="series-metrics">
        {stats?.overallOwned ?? 0}/{stats?.overallCount ?? 0}
      </span>
    </button>

    {#each stats?.series ?? [] as s (s.code)}
      <button
        class="series-item"
        class:active={selectedSeries === s.code}
        onclick={() => onSelectSeries?.(s.code)}
      >
        <span class="series-name">{s.nameCn ?? s.code}</span>
        <span class="series-metrics">
          {s.totalOwned}/{s.totalCount}
        </span>
        <span class="bucket-bars">
          {#each BUCKET_ORDER as bucket (bucket)}
            <span
              class="bucket-bar"
              class:has-progress={s.owned[bucket] > 0}
              class:done={s.counts[bucket] > 0 && s.owned[bucket] >= s.counts[bucket]}
              title={`${BUCKET_LABELS[bucket]}：${s.owned[bucket]}/${s.counts[bucket]}`}
            ></span>
          {/each}
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .stats-bar {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .overall-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .overall-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .muted {
    color: var(--text-secondary);
  }

  .chip {
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: 99px;
  }

  .promo-chip {
    background: rgba(168, 85, 247, 0.15);
    color: #a855f7;
    border: 1px solid rgba(168, 85, 247, 0.35);
  }

  .foil-chip {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
    border: 1px solid rgba(234, 179, 8, 0.35);
  }

  .progress-track {
    height: 8px;
    border-radius: 99px;
    background: var(--bg-secondary);
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .progress-fill {
    height: 100%;
    border-radius: 99px;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    transition: width 0.4s ease;
  }

  .series-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .series-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 150px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .series-item.active {
    border-color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-secondary));
  }

  .series-item:hover {
    border-color: var(--accent-color);
  }

  .series-name {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .series-metrics {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .bucket-bars {
    display: flex;
    gap: 3px;
  }

  .bucket-bar {
    width: 18px;
    height: 6px;
    border-radius: 3px;
    background: var(--border-color);
  }

  .bucket-bar.has-progress {
    background: #4ade80;
  }

  .bucket-bar.done {
    background: #22c55e;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.6);
  }
</style>
