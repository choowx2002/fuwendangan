<script lang="ts">
  import type { SeriesStats } from '$lib/db'
  import CachedImage from '../cards/CachedImage.svelte'
  import type { VariantBucket } from '$lib/cards/utils/variant-utils'
  import { t } from '$lib/i18n'

  let {
    series = [] as SeriesStats[],
    onSelect = undefined as ((code: string) => void) | undefined,
  } = $props()

  const BUCKET_ORDER: VariantBucket[] = ['base', 'alt', 'overnum', 'rune', 'token']

  const BUCKET_LABEL_KEYS: Record<VariantBucket, string> = {
    base: 'collection.bucketBase',
    alt: 'collection.bucketAlt',
    overnum: 'collection.bucketOvernum',
    rune: 'collection.bucketRune',
    token: 'collection.bucketToken',
  }

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
      {#if s.coverImage}
        <div class="series-cover">
          <CachedImage
            src={s.coverImage}
            name={`series-${s.code}`}
            borderRadius="0"
            fit="cover"
            isLandscape={false}
          />
        </div>
      {:else}
        <div class="series-cover cover-placeholder">{s.code}</div>
      {/if}

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
            <span class="metric-missing"
              >{$t('collection.missingCount', { values: { count: missing } })}</span
            >
          {:else if s.totalCount > 0}
            <span class="metric-done">{$t('collection.satisfied')}</span>
          {/if}
        </div>

        <div class="bucket-stats">
          {#each BUCKET_ORDER as bucket (bucket)}
            {@const bucketDone = s.counts[bucket] > 0 && s.owned[bucket] >= s.counts[bucket]}
            <span
              class="bucket-cell"
              class:has-progress={s.owned[bucket] > 0}
              class:done={bucketDone}
              title={`${$t(BUCKET_LABEL_KEYS[bucket])}：${s.owned[bucket]}/${s.counts[bucket]}`}
            >
              <span class="bucket-label">{$t(BUCKET_LABEL_KEYS[bucket])}</span>
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
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
    padding: 4px 2px 24px;
  }

  .series-card {
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    gap: 14px;
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

  .series-cover {
    position: relative;
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    border-radius: 10px;
    overflow: hidden;
    /* background: var(--bg-hover); */
  }

  .cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--text-xl);
    font-weight: 800;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--accent-color) 65%, #fff);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent-color) 22%, var(--bg-secondary)),
      var(--bg-secondary)
    );
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }

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
      grid-template-columns: 1fr;
      gap: 10px;
    }
  }
</style>
