<script lang="ts">
  import type { CollectionStats } from '$lib/db'
  import { t } from '$lib/i18n'

  let {
    stats = undefined as CollectionStats | undefined,
  }: {
    stats?: CollectionStats
  } = $props()

  const RADIUS = 52
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS

  const percent = $derived(
    stats && stats.overallCount > 0
      ? +((stats.overallOwned / stats.overallCount) * 100).toFixed(2)
      : 0
  )
  const offset = $derived(CIRCUMFERENCE * (1 - percent / 100))
</script>

<div class="hero">
  <div class="hero-main">
    <div class="ring-wrap">
      <svg viewBox="0 0 120 120" class="ring">
        <circle cx="60" cy="60" r={RADIUS} class="ring-bg" />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          class="ring-fg"
          stroke-dasharray={CIRCUMFERENCE}
          stroke-dashoffset={offset}
        />
      </svg>
      <div class="ring-center">
        <strong class="ring-percent">{percent}%</strong>
        <span class="ring-count">{stats?.overallOwned ?? 0}/{stats?.overallCount ?? 0}</span>
      </div>
    </div>

    <div class="hero-info">
      <div class="hero-title">{$t('collection.overallProgress')}</div>
      <div class="hero-chips">
        <span class="chip promo-chip">Promo ×{stats?.promoOwned ?? 0}</span>
        <span class="chip foil-chip"
          >{$t('collection.foilCountLabel')} ×{stats?.foilOwned ?? 0}</span
        >
        {#if percent === 100}
          <span class="chip done-chip">{$t('collection.allComplete')}</span>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .hero {
    display: flex;
    gap: 24px;
    align-items: stretch;
    padding: 16px 20px;
    border-radius: 14px;
    border: 1px solid var(--border-color);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent-color) 9%, var(--bg-secondary)),
      var(--bg-secondary)
    );
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  .hero-main {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-shrink: 0;
  }

  .ring-wrap {
    position: relative;
    width: 108px;
    height: 108px;
    flex-shrink: 0;
  }

  .ring {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .ring-bg {
    fill: none;
    stroke: var(--bg-hover);
    stroke-width: 10;
  }

  .ring-fg {
    fill: none;
    stroke: var(--accent-color);
    stroke-width: 10;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.5s ease;
  }

  .ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  .ring-percent {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--accent-color);
  }

  .ring-count {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .hero-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hero-title {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .hero-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .chip {
    font-size: var(--text-xs);
    padding: 3px 10px;
    border-radius: 99px;
  }

  .promo-chip {
    background: rgba(168, 85, 247, 0.12);
    color: #a855f7;
    border: 1px solid rgba(168, 85, 247, 0.35);
  }

  .foil-chip {
    background: rgba(234, 179, 8, 0.12);
    color: #b45309;
    border: 1px solid rgba(234, 179, 8, 0.4);
  }

  .done-chip {
    background: rgba(34, 197, 94, 0.12);
    color: #16a34a;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }

  @media (max-width: 600.99px) {
    .hero {
      flex-direction: column;
      padding: 14px;
    }

    .hero-main {
      justify-content: center;
    }
  }
</style>
