<script lang="ts">
  import { get } from 'svelte/store'
  import { onMount } from 'svelte'
  import { Package, Sparkles, RefreshCw, TriangleAlert, House } from '@lucide/svelte'
  import { t } from '$lib/i18n'
  import FoilCard from '../cards/FoilCard.svelte'
  import { getCardBackFallback } from '$lib/cards/utils/variant-utils'
  import {
    openPack,
    getPackSeriesList,
    type PackCard,
    type PackResult,
    type PackSeriesOption,
  } from '$lib/services/pack-service'

  let {
    title,
    onExit = null,
    homeHref = null,
  }: { title: string; onExit?: (() => void) | null; homeHref?: string | null } = $props()

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
          packError = get(t)('simulator.noSeries')
        }
      })
      .catch((error) => {
        console.error('[开包模拟] 加载系列失败:', error)
        packError = get(t)('simulator.loadSeriesFailed', {
          values: {
            message: error instanceof Error ? error.message : get(t)('common.unknownError'),
          },
        })
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
        seriesList.length === 0 ? get(t)('simulator.noSeries') : get(t)('simulator.pickSeries')
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
      pack = result
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        revealedCount = 5
      } else {
        scheduleReveal()
      }
      stage = 'open'
    } catch (error) {
      console.error('[开包模拟] 开包失败:', error)
      packError = error instanceof Error ? error.message : get(t)('simulator.openFailed')
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
</script>

<div class="pack-view">
  <div class="pack-header">
    <Sparkles size={20} style="color: var(--accent-color)" />
    <h2 class="pack-title">{title}</h2>
  </div>

  {#if stage === 'setup'}
    <div class="pack-setup">
      <p class="pack-desc">{$t('simulator.packDesc')}</p>
      <div class="pack-controls">
        {#if seriesLoading}
          <span class="pack-loading">{$t('simulator.packLoading')}</span>
        {:else}
          <select class="series-select" bind:value={selectedSeries} disabled={seriesLoading}>
            {#each seriesList as s (s.code)}
              <option value={s.code}>{s.nameCn ?? s.code}</option>
            {/each}
          </select>
          <button class="button button-primary" onclick={handleOpenPack} disabled={seriesLoading}>
            <Package size={16} />
            <span>{$t('simulator.openPack')}</span>
          </button>
          {#if onExit}
            <button class="button button-secondary" onclick={onExit}>
              <span>{$t('simulator.back')}</span>
            </button>
          {/if}
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
          {$t('simulator.opening', { values: { series: seriesName } })}
        {:else}
          {$t('simulator.opened', { values: { series: seriesName } })}
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
                aria-label={$t('simulator.revealCard')}
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
                <div class="card-meta">
                  <span class="rarity-badge" style={`color: ${card.color};`}>
                    {card.label}
                  </span>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="action-row">
        <button class="button button-primary" onclick={handleOpenPack} disabled={opening}>
          <RefreshCw size={16} />
          <span>{$t('simulator.openAgain')}</span>
        </button>
        {#if homeHref}
          <a href={homeHref} class="button button-ghost">
            <House size={16} />
            <span>{$t('simulator.home')}</span>
          </a>
        {/if}
        {#if onExit}
          <button class="button button-secondary" onclick={onExit}>
            <span>{$t('simulator.back')}</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .pack-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(920px, 100%);
    animation: pop-in 0.4s ease;
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

  .pack-setup {
    display: flex;
    flex-direction: column;
    align-items: center;
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

  .rarity-badge {
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
  }

  .action-row {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
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
  }
</style>
