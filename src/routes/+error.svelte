<script lang="ts">
  import { onMount } from 'svelte'
  import { Package, Sparkles, ArrowLeft, RefreshCw, TriangleAlert, House } from '@lucide/svelte'
  import FoilCard from '../lib/components/cards/FoilCard.svelte'
  import { getCardBackFallback } from '$lib/cards/utils/variant-utils'
  import {
    openPack,
    getPackSeriesList,
    type PackCard,
    type PackResult,
    type PackSeriesOption,
  } from '$lib/services/pack-service'

  const RUNES = [
    { src: '/runes/green.svg', delay: 0 },
    { src: '/runes/blue.svg', delay: 1.4 },
    { src: '/runes/red.svg', delay: 0.7 },
    { src: '/runes/yellow.svg', delay: 2.1 },
    { src: '/runes/purple.svg', delay: 1.8 },
    { src: '/runes/orange.svg', delay: 0.4 },
  ]

  // ==================== 开包状态 ====================
  let view = $state<'main' | 'pack'>('main')
  let seriesList = $state<PackSeriesOption[]>([])
  let selectedSeries = $state('')
  let seriesLoading = $state(true)
  let pack = $state<PackResult | null>(null)
  let stage = $state<'setup' | 'open'>('setup')
  let revealedCount = $state(0)
  let flippingIndex = $state(-1)
  let opening = $state(false)
  let packError = $state('')

  const timers: number[] = []

  const seriesName = $derived(
    seriesList.find((s) => s.code === selectedSeries)?.nameCn ?? selectedSeries
  )

  const HIT_TIERS = ['rare', 'epic', 'alt', 'overnum', 'signedOvernum']

  function isHit(card: PackCard): boolean {
    return HIT_TIERS.includes(card.tier)
  }

  /** 每张卡的揭示相位：back（卡背）→ flipping（翻走）→ front（卡面） */
  function phase(i: number): 'back' | 'flipping' | 'front' {
    if (i < revealedCount) return 'front'
    if (i === flippingIndex) return 'flipping'
    return 'back'
  }

  onMount(() => {
    getPackSeriesList()
      .then((list) => {
        seriesList = list
        if (list.length > 0) {
          selectedSeries = list[0].code
        } else {
          packError = '本地暂无系列数据，请先在「设置」页同步卡库'
        }
      })
      .catch((error) => {
        console.error('[404 开包] 加载系列失败:', error)
        packError = `无法加载系列列表：${error instanceof Error ? error.message : '未知错误'}`
      })
      .finally(() => {
        seriesLoading = false
      })
    return () => {
      timers.forEach((t) => clearTimeout(t))
    }
  })

  function scheduleReveal() {
    for (let i = 0; i < 5; i++) {
      timers.push(
        window.setTimeout(() => {
          flippingIndex = i
        }, i * 320)
      )
      timers.push(
        window.setTimeout(
          () => {
            revealedCount = i + 1
          },
          i * 320 + 180
        )
      )
    }
  }

  async function handleOpenPack() {
    if (opening || seriesLoading) return
    if (!selectedSeries) {
      packError =
        seriesList.length === 0 ? '本地暂无系列数据，请先在「设置」页同步卡库' : '请先选择一个系列'
      return
    }
    packError = ''
    opening = true
    timers.forEach((t) => clearTimeout(t))
    timers.length = 0
    pack = null
    revealedCount = 0
    flippingIndex = -1
    try {
      const result = await openPack(selectedSeries)
      console.log(result)
      pack = result
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        revealedCount = 5
        console.log(revealedCount)
      } else {
        scheduleReveal()
        console.log('123')
      }
      stage = 'open'
    } catch (error) {
      console.error('[404 开包] 开包失败:', error)
      packError = error instanceof Error ? error.message : '开包失败，请稍后再试'
      stage = 'setup'
    } finally {
      opening = false
    }
  }

  /** 点击卡背：立即翻到该张（连同前面的卡一起），后续保持节奏 */
  function revealUpTo(i: number) {
    if (revealedCount >= 5 || revealedCount > i) return
    timers.forEach((t) => clearTimeout(t))
    timers.length = 0
    revealedCount = i
    flippingIndex = i
    timers.push(
      window.setTimeout(() => {
        revealedCount = i + 1
      }, 180)
    )
    for (let j = i + 1; j < 5; j++) {
      const offset = 320 + (j - i - 1) * 320
      timers.push(
        window.setTimeout(() => {
          flippingIndex = j
        }, offset)
      )
      timers.push(
        window.setTimeout(() => {
          revealedCount = j + 1
        }, offset + 180)
      )
    }
  }

  function backToMain() {
    timers.forEach((t) => clearTimeout(t))
    view = 'main'
    stage = 'setup'
    pack = null
  }

  function goBack() {
    if (history.length > 1) history.back()
    else window.location.href = '/'
  }
</script>

<svelte:head>
  <title>404 · 符文档案</title>
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
      <h1 class="error-title">这张卡牌不在档案里</h1>
      <p class="error-desc">
        它可能还未被收录，或已悄悄加入了对面的卡组……<br />
        不过来都来了——开一包试试手气？
      </p>
      <div class="action-row">
        <button class="button button-primary" onclick={() => (view = 'pack')}>
          <Package size={16} />
          <span>开一包</span>
        </button>
        <a href="/" class="button button-ghost">
          <House size={16} />
          <span>返回首页</span>
        </a>
        <button class="button button-ghost" onclick={goBack}>
          <ArrowLeft size={16} />
          <span>返回上一页</span>
        </button>
      </div>
    </div>
  {:else}
    <div class="pack-view">
      <div class="pack-header">
        <Sparkles size={20} style="color: var(--accent-color)" />
        <h2 class="pack-title">神秘补充包</h2>
      </div>

      {#if stage === 'setup'}
        <div class="pack-setup">
          <p class="pack-desc">选一个系列，看看能开出什么吧</p>
          <div class="pack-controls">
            {#if seriesLoading}
              <span class="pack-loading">正在加载系列…</span>
            {:else}
              <select class="series-select" bind:value={selectedSeries} disabled={seriesLoading}>
                {#each seriesList as s (s.code)}
                  <option value={s.code}>{s.nameCn ?? s.code}</option>
                {/each}
              </select>
              <button
                class="button button-primary"
                onclick={handleOpenPack}
                disabled={seriesLoading}
              >
                <Package size={16} />
                <span>开一包</span>
              </button>

              <button class="button button-secondary" onclick={backToMain}>
                <span>返回</span>
              </button>
            {/if}
          </div>
          {#if packError}
            <p class="pack-error">
              <TriangleAlert size={14} />
              <span>{packError}</span>
            </p>
          {/if}
        </div>
      {:else if pack}
        <div class="pack-result">
          <p class="pack-desc">
            {#if revealedCount < 5}
              正在拆封「{seriesName}」…点按卡背可提前翻开
            {:else}
              「{seriesName}」开出 5 张卡！点按卡面可以翻看卡背
            {/if}
          </p>
          <div class="card-row">
            {#each pack.cards as card, i (i)}
              <div
                class="reveal-card"
                class:flipping={phase(i) === 'flipping'}
                class:hit={isHit(card) && phase(i) === 'front'}
                style={`--hit-color: ${card.color}`}
              >
                {#if phase(i) === 'back' || phase(i) === 'flipping'}
                  <button
                    class="card-back"
                    class:leaving={phase(i) === 'flipping'}
                    onclick={() => revealUpTo(i)}
                    aria-label="翻开这张卡"
                  >
                    <img
                      src={getCardBackFallback(card.print.card_category)}
                      alt=""
                      class="card-back-img"
                      draggable="false"
                    />
                  </button>
                {:else}
                  <div class="card-front">
                    <FoilCard
                      print={card.print}
                      cardName={card.print.card_name_cn ?? ''}
                      cardCategory={card.print.card_category}
                      rarity={card.label}
                      foilIntensity={card.isFoil ? 0.85 : undefined}
                      size="sm"
                    />
                    <!-- <div class="card-meta">
                      <span class="rarity-badge" style={`color: ${card.color};`}>
                        {card.label}
                      </span>
                      <span class="card-name" title={card.print.card_name_cn ?? ''}>
                        {card.print.card_name_cn ?? '未知卡牌'}
                      </span>
                    </div> -->
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <div class="action-row">
            <button class="button button-primary" onclick={handleOpenPack} disabled={opening}>
              <RefreshCw size={16} />
              <span>再开一包</span>
            </button>
            <a href="/" class="button button-ghost">
              <House size={16} />
              <span>返回首页</span>
            </a>
            <button class="button button-secondary" onclick={backToMain}>
              <span>返回</span>
            </button>
          </div>
        </div>
      {/if}
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

  /* ========== 开包视图 ========== */
  .pack-view {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(920px, 100%);
    animation: pop-in 0.4s ease;
  }

  .pack-back {
    position: absolute;
    top: -8px;
    left: -8px;
  }

  .pack-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .pack-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .pack-desc {
    margin: 0 0 18px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .pack-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .pack-loading {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .series-select {
    padding: 8px 12px;
    font-size: var(--text-sm);
    font-family: inherit;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    outline: none;
    min-height: 36px;
  }

  .series-select:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-color) 20%, transparent);
  }

  .pack-error {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 14px;
    font-size: var(--text-sm);
    color: #e03e3e;
  }

  /* ========== 卡牌行 ========== */
  .card-row {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 14px;
    max-width: 100%;
    overflow-x: auto;
    padding: 12px 4px 16px;
  }

  .reveal-card {
    flex-shrink: 0;
  }

  /* ========== 卡背（可点击） ========== */
  .card-back {
    width: 128px;
    height: 179px;
    display: block;
    padding: 0;
    border: none;
    border-radius: 10px;
    overflow: hidden;
    background: #1a1d29;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    animation: back-pulse 1.4s ease-in-out infinite;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  .card-back-img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .card-back:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
  }

  .reveal-card.flipping .card-back {
    animation: flip-away 0.18s ease-in forwards;
  }

  @keyframes back-pulse {
    0%,
    100% {
      filter: brightness(1);
    }
    50% {
      filter: brightness(1.15);
    }
  }

  @keyframes flip-away {
    from {
      transform: rotateY(0deg);
    }
    to {
      transform: rotateY(90deg) scale(0.92);
      opacity: 0.6;
    }
  }

  /* ========== 卡面 ========== */
  .card-front {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    animation: flip-in 0.18s ease-out;
  }

  @keyframes flip-in {
    from {
      transform: rotateY(-90deg);
      opacity: 0;
    }
    to {
      transform: rotateY(0deg);
      opacity: 1;
    }
  }

  .reveal-card.hit :global(.foil-inner) {
    box-shadow: 0 0 22px var(--hit-color);
  }

  .card-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    max-width: 128px;
  }

  .rarity-badge {
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
  }

  .card-name {
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .card-back {
      animation: none;
    }
    .card-front {
      animation: none;
    }
  }

  @media (max-width: 767.99px) {
    .card-row {
      justify-content: flex-start;
      overflow: scroll;
      max-width: 90vw;
    }
    .pack-back {
      position: static;
      align-self: flex-start;
    }
  }
</style>
