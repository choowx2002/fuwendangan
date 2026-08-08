<script lang="ts">
  import type { SeriesStats } from '$lib/db'
  // import { Check } from '@lucide/svelte'
  // import CachedImage from '../cards/CachedImage.svelte'
  import { BUCKET_LABELS, type VariantBucket } from '$lib/cards/utils/variant-utils'

  let {
    series = [] as SeriesStats[],
    onSelect = undefined as ((code: string) => void) | undefined,
  } = $props()

  const BUCKET_ORDER: VariantBucket[] = ['base', 'alt', 'overnum', 'rune', 'token']

  function percentOf(s: SeriesStats): number {
    if (!s || s.totalCount <= 0) return 0
    return Math.round((s.totalOwned / s.totalCount) * 100)
  }
</script>

<div class="series-grid">
  {#each series as s (s.code)}
    {@const percent = percentOf(s)}
    {@const missing = Math.max(0, s.totalCount - s.totalOwned)}
    {@const done = s.totalCount > 0 && missing === 0}
    <button class="series-card" class:done onclick={() => onSelect?.(s.code)}>
      <!-- <div class="series-cover">
        {#if s.coverImage}
          <CachedImage
            src={s.coverImage}
            name={`series-${s.code}`}
            borderRadius="10px"
            fit="cover"
            isLandscape={false}
          />
        {:else}
          <div class="cover-fallback">{s.code}</div>
        {/if}
        {#if done}
          <span class="done-badge"><Check size={13} /></span>
        {/if}
      </div> -->

      <div class="series-info">
        <div class="series-name-row">
          <span class="series-name">{s.nameCn ?? s.code}</span>
          <span class="series-code">{s.code}</span>
        </div>

        <div class="progress-track">
          <div class="progress-fill" style={`width: ${percent}%`}></div>
        </div>

        <div class="series-metrics">
          <span class="metric-owned">{s.totalOwned}/{s.totalCount}</span>
          {#if missing > 0}
            <span class="metric-missing">还缺 {missing} 张</span>
          {:else if s.totalCount > 0}
            <span class="metric-done">已集齐</span>
          {/if}
        </div>

        <div class="bucket-stats">
          {#each BUCKET_ORDER as bucket (bucket)}
            {@const bucketDone = s.counts[bucket] > 0 && s.owned[bucket] >= s.counts[bucket]}
            <span
              class="bucket-cell"
              class:has-progress={s.owned[bucket] > 0}
              class:done={bucketDone}
              title={`${BUCKET_LABELS[bucket]}：${s.owned[bucket]}/${s.counts[bucket]}`}
            >
              <span class="bucket-label">{BUCKET_LABELS[bucket]}</span>
              <span class="bucket-value">
                {s.owned[bucket]}/{s.counts[bucket]}
                {#if bucketDone}<span class="bucket-check">✓</span>{/if}
              </span>
            </span>
          {/each}
        </div>
      </div>
    </button>
  {/each}
</div>

<style>
  .series-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 14px;
    padding: 4px 2px 24px;
  }

  .series-card {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .series-card:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
  }

  .series-card.done {
    border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent-color) 7%, var(--bg-secondary)),
      var(--bg-secondary)
    );
  }

  /*.series-cover {
    position: relative;
    width: 108px;
    flex-shrink: 0;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  .cover-fallback {
    width: 100%;
    height: 100%;
    aspect-ratio: 744 / 1040;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: 2px;
    color: #fff;
    background: linear-gradient(135deg, var(--accent-color), color-mix(in srgb, var(--accent-color) 40%, #0b4f47));
  }

  .done-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #eab308;
    color: #422006;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }*/

  .series-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .series-name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .series-name {
    font-size: var(--text-lg);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .series-code {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .progress-track {
    height: 7px;
    border-radius: 99px;
    background: var(--bg-hover);
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .progress-fill {
    height: 100%;
    border-radius: 99px;
    background: var(--accent-color);
    transition: width 0.4s ease;
  }

  .series-metrics {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-xs);
  }

  .metric-owned {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .metric-missing {
    color: #ef4444;
    font-weight: 700;
  }

  .metric-done {
    color: #b45309;
    font-weight: 700;
  }

  .bucket-stats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    border-top: 1px solid var(--border-color);
    padding-top: 8px;
  }

  .bucket-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .bucket-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .bucket-value {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .bucket-cell.has-progress .bucket-value {
    color: var(--accent-color);
    font-weight: 600;
  }

  .bucket-check {
    color: var(--accent-color);
    font-weight: 700;
  }

  @media (max-width: 600.99px) {
    .series-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
  }
</style>
