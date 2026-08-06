<script lang="ts">
  import type { SeriesStats } from '$lib/db'
  // import { Check } from '@lucide/svelte'
  // import CachedImage from '../cards/CachedImage.svelte'
  import {
    BUCKET_LABELS,
    type VariantBucket,
  } from '$lib/cards/utils/variant-utils'

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
    <button class="series-card" class:done={done} onclick={() => onSelect?.(s.code)}>
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

        <div class="bucket-bars">
          {#each BUCKET_ORDER as bucket (bucket)}
            <span
              class="bucket-bar"
              class:has-progress={s.owned[bucket] > 0}
              class:done={s.counts[bucket] > 0 && s.owned[bucket] >= s.counts[bucket]}
              title={`${BUCKET_LABELS[bucket]}：${s.owned[bucket]}/${s.counts[bucket]}`}
            ></span>
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
    padding: 12px;
    border-radius: 14px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
    aspect-ratio: 3 / 2;
  }

  .series-card:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
  }

  .series-card.done {
    border-color: rgba(234, 179, 8, 0.55);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, #eab308 7%, var(--bg-secondary)),
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
    gap: 8px;
  }

  .series-name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .series-name {
    font-size: var(--text-md);
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
    background: linear-gradient(90deg, #4ade80, #22c55e);
    transition: width 0.4s ease;
  }

  .series-card.done .progress-fill {
    background: linear-gradient(90deg, #fbbf24, #eab308);
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

  .bucket-bars {
    display: flex;
    gap: 3px;
    margin-top: auto;
  }

  .bucket-bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--border-color);
  }

  .bucket-bar.has-progress {
    background: #4ade80;
  }

  .bucket-bar.done {
    background: #eab308;
    box-shadow: 0 0 4px rgba(234, 179, 8, 0.6);
  }

  @media (max-width: 600.99px) {
    .series-grid {
      grid-template-columns: repeat(2, minimax(0px, 1fr));
      gap: 10px;
    }

    /*.series-cover {
      width: 84px;
    }*/
  }
</style>
