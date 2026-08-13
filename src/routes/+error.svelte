<script lang="ts">
  import { House, ArrowLeft, Package } from '@lucide/svelte'
  import { t } from '$lib/i18n'
  import PackOpener from '../lib/components/simulator/PackOpener.svelte'

  const RUNES = [
    { src: '/runes/green.svg', delay: 0 },
    { src: '/runes/blue.svg', delay: 1.4 },
    { src: '/runes/red.svg', delay: 0.7 },
    { src: '/runes/yellow.svg', delay: 2.1 },
    { src: '/runes/purple.svg', delay: 1.8 },
    { src: '/runes/orange.svg', delay: 0.4 },
  ]

  let view = $state<'main' | 'pack'>('main')

  function backToMain() {
    view = 'main'
  }

  function goBack() {
    if (history.length > 1) history.back()
    else window.location.href = '/'
  }
</script>

<svelte:head>
  <title>{$t('error.title')}</title>
</svelte:head>

<div class="error-page">
  <div class="runes-decor" aria-hidden="true">
    {#each RUNES as rune (rune.src + rune.delay)}
      <img src={rune.src} alt="" class="rune" style={`animation-delay: ${rune.delay}s`} />
    {/each}
  </div>

  {#if view === 'main'}
    <div class="error-main">
      <div class="big-number">404</div>
      <h1 class="error-title">{$t('error.heading')}</h1>
      <p class="error-desc">
        {$t('error.desc1')}<br />
        {$t('error.desc2')}
      </p>
      <div class="action-row">
        <button class="button button-primary" onclick={() => (view = 'pack')}>
          <Package size={16} />
          <span>{$t('error.openPack')}</span>
        </button>
        <a href="/" class="button button-ghost">
          <House size={16} />
          <span>{$t('error.home')}</span>
        </a>
        <button class="button button-ghost" onclick={goBack}>
          <ArrowLeft size={16} />
          <span>{$t('error.prev')}</span>
        </button>
      </div>
    </div>
  {:else}
    <div class="pack-view">
      <PackOpener title={$t('error.packTitle')} onExit={backToMain} homeHref="/" />
    </div>
  {/if}
</div>

<style>
  .error-page {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(
        ellipse at 50% 20%,
        color-mix(in oklab, var(--accent-color) 8%, transparent),
        transparent 60%
      ),
      var(--bg-primary);
    position: relative;
    overflow: hidden;
    text-align: center;
    padding: 24px;
  }

  /* ========== 漂浮符文 ========== */
  .runes-decor {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .rune {
    position: absolute;
    width: 42px;
    height: 42px;
    opacity: 0.28;
    animation: rune-float 7s ease-in-out infinite;
  }

  .rune:nth-child(1) {
    top: 14%;
    left: 12%;
  }
  .rune:nth-child(2) {
    top: 20%;
    right: 14%;
  }
  .rune:nth-child(3) {
    bottom: 22%;
    left: 18%;
  }
  .rune:nth-child(4) {
    bottom: 16%;
    right: 10%;
  }
  .rune:nth-child(5) {
    top: 55%;
    left: 7%;
  }
  .rune:nth-child(6) {
    top: 50%;
    right: 6%;
  }

  @keyframes rune-float {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    50% {
      transform: translateY(-18px) rotate(8deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rune {
      animation: none;
    }
  }

  /* ========== 404 主视图 ========== */
  .error-main {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    animation: pop-in 0.4s ease;
  }

  .big-number {
    font-size: clamp(72px, 16vw, 144px);
    font-weight: 700;
    line-height: 1;
    letter-spacing: 4px;
    background: linear-gradient(135deg, var(--accent-color), var(--secondary-accent-color));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 6px 24px color-mix(in oklab, var(--accent-color) 30%, transparent));
  }

  .error-title {
    margin: 20px 0 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .error-desc {
    margin: 10px 0 0;
    font-size: var(--text-md);
    line-height: 1.7;
    color: var(--text-secondary);
  }

  .action-row {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 28px;
  }

  /* ========== 开包视图容器 ========== */
  .pack-view {
    position: relative;
    z-index: 1;
    width: min(920px, 100%);
    animation: pop-in 0.4s ease;
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
