<script lang="ts">
  import type { CollectionStats, RecentCollectionCard } from '$lib/db'
  import CachedImage from '../cards/CachedImage.svelte'

  let {
    stats = undefined as CollectionStats | undefined,
    recent = [] as RecentCollectionCard[],
    onRecentClick = undefined as ((c: RecentCollectionCard) => void) | undefined,
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
      <div class="hero-title">收藏总进度</div>
      <div class="hero-chips">
        <span class="chip promo-chip">Promo ×{stats?.promoOwned ?? 0}</span>
        <span class="chip foil-chip">闪卡 ×{stats?.foilOwned ?? 0}</span>
        {#if percent === 100}
          <span class="chip done-chip">全系列集齐</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="recent-col">
    <div class="recent-title">最近录入</div>
    {#if recent.length === 0}
      <p class="recent-empty">暂无收藏记录，从系列卡片开始录入吧</p>
    {:else}
      <div class="recent-list">
        {#each recent as r (r.cardId + r.cardNoExtend + r.langCode)}
          <button
            class="recent-item"
            onclick={() => onRecentClick?.(r)}
            title={`${r.cardNameCn ?? ''}（${r.cardNo ?? ''}）${r.langCode === 'SC' ? '' : ` · ${r.langCode}`}`}
          >
            <div class="recent-img">
              <CachedImage
                src={r.imgCdn ?? r.ttsCdn ?? ''}
                name={`${r.cardNoExtend}-${r.printLang ?? 'default'}`}
                borderRadius="6px"
                fit="cover"
                isLandscape={false}
              />
              {#if (r.ownedFoil ?? 0) > 0}
                <span class="mini-foil">闪</span>
              {/if}
              {#if r.langCode !== 'SC'}
                <span class="lang-badge">{r.langCode}</span>
              {/if}
            </div>
            <div class="recent-info">
              <span class="recent-name">{r.cardNameCn ?? r.cardNo ?? ''}</span>
              <span class="recent-no">{r.cardNo ?? ''}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
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

  .recent-col {
    flex: 1;
    min-width: 0;
    border-left: 1px solid var(--border-color);
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .recent-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .recent-empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    align-self: center;
    padding: 12px 0;
  }

  .recent-list {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .recent-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    min-width: 74px;
    max-width: 90px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .recent-img {
    position: relative;
    width: 100%;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  }

  .recent-item:hover .recent-img {
    transform: translateY(-2px);
  }

  .mini-foil {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    border-radius: 50%;
    background: linear-gradient(135deg, #facc15, #f59e0b);
    color: #422006;
  }

  .lang-badge {
    position: absolute;
    bottom: 4px;
    left: 4px;
    padding: 1px 5px;
    font-size: 9px;
    font-weight: 700;
    line-height: 1.4;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
  }

  .recent-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-width: 0;
    width: 100%;
  }

  .recent-name {
    font-size: var(--text-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .recent-no {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  @media (max-width: 600.99px) {
    .hero {
      flex-direction: column;
      padding: 14px;
    }

    .hero-main {
      justify-content: center;
    }

    .recent-col {
      border-left: none;
      border-top: 1px solid var(--border-color);
      padding-left: 0;
      padding-top: 12px;
    }
  }
</style>
