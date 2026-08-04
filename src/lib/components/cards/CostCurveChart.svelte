<script lang="ts">
  import { ChartBar } from '@lucide/svelte'
  import {
    COLOR_LABELS,
    COLOR_ORDER,
    COLOR_VARS,
    computeColorTotals,
    computeCostCurve,
    fmt,
    type CostStatCard,
    type CurveMode,
  } from '$lib/cards/utils/cost-curve-utils'

  interface Props {
    cards: CostStatCard[]
  }

  let { cards }: Props = $props()

  let curveMode = $state<CurveMode>('energy')

  const costCurve = $derived(computeCostCurve(cards, curveMode))

  const maxCurveTotal = $derived(Math.max(...costCurve.map((p) => p.total), 1))

  const colorLegend = $derived(
    Object.entries(computeColorTotals(cards))
      .map(([color, count]) => ({ color, count }))
      .sort((a, b) => b.count - a.count)
  )
</script>

<div class="cost-curve">
  <div class="cost-curve-header">
    <ChartBar size={18} />
    <h3>{curveMode === 'energy' ? '法力曲线' : '符能曲线'}</h3>
    <div class="toggle-button-group curve-toggle">
      <button
        class="toggle-btn"
        class:active={curveMode === 'energy'}
        onclick={() => (curveMode = 'energy')}
      >
        法力
      </button>
      <button
        class="toggle-btn"
        class:active={curveMode === 'return_energy'}
        onclick={() => (curveMode = 'return_energy')}
      >
        符能
      </button>
    </div>
  </div>

  <div class="chart-container">
    {#if costCurve.length === 0}
      <span class="empty-text">主卡组暂无卡牌</span>
    {:else}
      {#each costCurve as point (point.value)}
        <div
          class="bar-wrapper"
          title="{curveMode === 'energy' ? '法力' : '符能'} {point.value}：共 {fmt(point.total)} 张"
        >
          <div class="bar-track">
            <div class="bar-stack" style="height: {(point.total / maxCurveTotal) * 100}%">
              <span class="bar-value">{fmt(point.total)}</span>
              {#each COLOR_ORDER.filter((c) => point.colors[c]) as color (color)}
                <div
                  class="bar-segment"
                  style="height: {(point.colors[color] / point.total) *
                    100}%; background: {COLOR_VARS[color]}"
                ></div>
              {/each}
            </div>
          </div>
          <span class="bar-label">{point.value}</span>
        </div>
      {/each}
    {/if}
  </div>

  {#if colorLegend.length > 0}
    <div class="color-legend">
      {#each colorLegend as item (item.color)}
        <span class="legend-item">
          <span class="legend-dot" style="background: {COLOR_VARS[item.color]}"></span>
          {COLOR_LABELS[item.color]}
          <strong>{fmt(item.count)}</strong>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cost-curve {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .cost-curve-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
  }

  .cost-curve-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .curve-toggle {
    margin-left: auto;
  }

  .toggle-button-group {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
  }

  .toggle-btn {
    padding: 4px 14px;
    min-height: 26px;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .toggle-btn.active {
    background-color: var(--accent-color);
    color: white;
  }

  .toggle-btn.active:hover {
    background-color: color-mix(in oklab, var(--accent-color) 85%, black);
  }

  .chart-container {
    display: flex;
    align-items: flex-end;
    height: 150px;
    gap: 6px;
    padding-top: 24px;
    border-bottom: 1px solid var(--border-color);
  }

  .bar-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 100%;
    cursor: default;
  }

  .bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .bar-stack {
    position: relative;
    width: 100%;
    max-width: 34px;
    display: flex;
    flex-direction: column-reverse;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    overflow: visible;
    transform-origin: bottom center;
    transition:
      height 0.45s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.15s ease;
  }

  .bar-segment {
    width: 100%;
    min-height: 2px;
    opacity: 0.9;
    transition:
      height 0.45s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.15s ease;
  }

  .bar-segment:first-of-type {
    border-radius: 0 0 1px 1px;
  }

  .bar-segment:last-of-type {
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }

  .bar-wrapper:hover .bar-segment {
    opacity: 1;
  }

  .bar-wrapper:hover .bar-stack {
    transform: scaleX(1.12);
  }

  .bar-value {
    position: absolute;
    top: -20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--accent-color);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .bar-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-top: 6px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .color-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .legend-item strong {
    color: var(--text-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .empty-text {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    width: 100%;
    text-align: center;
    align-self: center;
  }
</style>
