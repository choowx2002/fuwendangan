<script lang="ts">
  import { ChartBar } from '@lucide/svelte'
  import {
    COLOR_ORDER,
    COLOR_VARS,
    computeColorTotals,
    computeCostCurve,
    computeTypeCounts,
    fmt,
    TYPE_GROUPS,
    type CostCurvePoint,
    type CostStatCard,
    type CurveMode,
    type TypeGroupKey,
  } from '$lib/cards/utils/cost-curve-utils'
  import { t } from '$lib/i18n'

  interface Props {
    cards: CostStatCard[]
  }

  let { cards }: Props = $props()

  let curveMode = $state<CurveMode>('energy')
  let hoverValue = $state<number | null>(null)
  /** 点击柱子后固定的费用；null = 跟随默认（最左非空柱） */
  let selectedValue = $state<number | null>(null)

  /** 高费段（≥7）合并为单柱，曲线形态更清晰 */
  function mergeHighCost(points: CostCurvePoint[]): CostCurvePoint[] {
    const highIdx = points.findIndex((p) => p.value >= 7)
    if (highIdx === -1) return points
    const high = points.splice(highIdx)
    const colors: Record<string, number> = {}
    let total = 0
    for (const p of high) {
      total += p.total
      for (const [color, n] of Object.entries(p.colors)) {
        colors[color] = (colors[color] ?? 0) + n
      }
    }
    points.push({ value: 7, total, colors })
    return points
  }

  const costCurve = $derived(mergeHighCost(computeCostCurve(cards, curveMode)))

  const maxCurveTotal = $derived(Math.max(...costCurve.map((p) => p.total), 1))

  const colorLegend = $derived(
    Object.entries(computeColorTotals(cards))
      .map(([color, count]) => ({ color, count }))
      .sort((a, b) => b.count - a.count)
  )

  /** 平均费用（随曲线模式联动） */
  const curveStats = $derived.by(() => {
    let sum = 0
    let qty = 0
    for (const c of cards) {
      const value = curveMode === 'energy' ? (c.energy ?? 0) : (c.return_energy ?? 0)
      sum += value * c.quantity
      qty += c.quantity
    }
    return { avg: qty > 0 ? sum / qty : 0 }
  })

  /** 平均费用在图表中的水平位置（按桶插值，百分比） */
  const avgLinePos = $derived.by(() => {
    if (costCurve.length <= 1) return null
    const values = costCurve.map((p) => p.value)
    let idx = 0
    for (let i = 0; i < values.length; i++) {
      if (curveStats.avg >= values[i]) idx = i
    }
    let pos = idx
    if (idx < values.length - 1) {
      const v0 = values[idx]
      const v1 = values[idx + 1]
      if (v1 > v0) pos += (curveStats.avg - v0) / (v1 - v0)
    } else {
      pos = values.length - 1
    }
    return (pos / (values.length - 1)) * 100
  })

  const hoverColors = $derived(
    hoverValue === null ? null : (costCurve.find((p) => p.value === hoverValue)?.colors ?? null)
  )

  /** 费用 × 类型 三系数量（双类别卡包含计数） */
  const typeCounts = $derived(computeTypeCounts(cards, curveMode))

  /** 当前展示的费用：点击固定，否则跟随最左非空柱（卡组最低费用） */
  const activeValue = $derived(selectedValue ?? (costCurve.length > 0 ? costCurve[0].value : null))
  const activeTypes = $derived(activeValue === null ? null : (typeCounts.get(activeValue) ?? null))
  const activeTypeRows = $derived(
    activeTypes === null
      ? []
      : TYPE_GROUPS.filter((g) => (activeTypes[g.key] ?? 0) > 0).map((g) => ({
          key: g.key,
          count: activeTypes[g.key] ?? 0,
        }))
  )

  function toggleSelect(value: number) {
    selectedValue = selectedValue === value ? null : value
  }
</script>

<div class="cost-curve">
  <div class="cost-curve-header">
    <ChartBar size={18} />
    <h3>{curveMode === 'energy' ? $t('cards.energyCurve') : $t('cards.runeEnergyCurve')}</h3>
    <div class="toggle-button-group curve-toggle">
      <button
        class="toggle-btn"
        class:active={curveMode === 'energy'}
        onclick={() => (curveMode = 'energy')}
      >
        {$t('cards.energy')}
      </button>
      <button
        class="toggle-btn"
        class:active={curveMode === 'return_energy'}
        onclick={() => (curveMode = 'return_energy')}
      >
        {$t('cards.runeEnergy')}
      </button>
    </div>
  </div>

  <div class="curve-stats">
    <span class="curve-stat"><b>{fmt(curveStats.avg)}</b>{$t('cards.avgCost')}</span>
    {#if activeTypeRows.length > 0}
      {#each activeTypeRows as row (row.key)}
        <span
          class="curve-stat curve-stat-type curve-type-{row.key}"
          title={$t(`cards.typeHint${row.key.charAt(0).toUpperCase() + row.key.slice(1)}`)}
        >
          <b>{row.count}</b>{$t(`cards.type${row.key.charAt(0).toUpperCase() + row.key.slice(1)}`)}
        </span>
      {/each}
    {:else if activeValue !== null}
      <span class="curve-stat curve-stat-none"
        >{$t('cards.typeNone', { values: { value: activeValue >= 7 ? '7+' : activeValue } })}</span
      >
    {/if}
  </div>

  <div class="chart-container">
    {#if costCurve.length === 0}
      <span class="empty-text">{$t('cards.emptyCurve')}</span>
    {:else}
      {#if avgLinePos !== null}
        <div class="avg-line" style="left: {avgLinePos}%">
          <span class="avg-line-label">{$t('cards.avgMarker')} {fmt(curveStats.avg)}</span>
        </div>
      {/if}
      {#each costCurve as point (point.value)}
        <div
          class="bar-wrapper"
          class:selected={selectedValue === point.value}
          role="presentation"
          onmouseenter={() => (hoverValue = point.value)}
          onmouseleave={() => (hoverValue = null)}
          onclick={() => toggleSelect(point.value)}
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
          <span class="bar-label">{point.value >= 7 ? '7+' : point.value}</span>
          {#if hoverValue === point.value}
            <div class="bar-tooltip">
              <div class="bar-tooltip-title">
                {$t('cards.curvePoint', {
                  values: {
                    name: curveMode === 'energy' ? $t('cards.energy') : $t('cards.runeEnergy'),
                    value: point.value >= 7 ? '7+' : point.value,
                    count: fmt(point.total),
                  },
                })}
              </div>
              {#each COLOR_ORDER.filter((c) => point.colors[c]) as color (color)}
                <div class="bar-tooltip-row">
                  <i style="background: {COLOR_VARS[color]}"></i>
                  {$t('cards.color' + color.charAt(0).toUpperCase() + color.slice(1))}
                  <b>{fmt(point.colors[color])}</b>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  {#if colorLegend.length > 0}
    <div class="color-legend">
      {#each colorLegend as item (item.color)}
        <span class="legend-item" class:dim={hoverColors !== null && !hoverColors[item.color]}>
          <span class="legend-dot" style="background: {COLOR_VARS[item.color]}"></span>
          {$t('cards.color' + item.color.charAt(0).toUpperCase() + item.color.slice(1))}
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

  .curve-stats {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .curve-stat {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 12px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    white-space: nowrap;
  }

  .curve-stat b {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--accent-color);
    font-variant-numeric: tabular-nums;
  }

  .curve-stat-type {
    cursor: default;
  }

  .curve-stat-type b {
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .curve-type-unit b {
    color: #16a34a;
  }

  .curve-type-spell b {
    color: #2563eb;
  }

  .curve-type-equipment b {
    color: #d97706;
  }

  .curve-stat-none {
    color: var(--text-tertiary);
    font-style: italic;
  }

  .toggle-button-group {
    display: flex;
    gap: 2px;
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
    position: relative;
    display: flex;
    align-items: flex-end;
    height: 150px;
    gap: 6px;
    padding-top: 24px;
    border-bottom: 1px solid var(--border-color);
  }

  .avg-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px dashed var(--accent-color);
    opacity: 0.65;
    pointer-events: none;
    z-index: 1;
  }

  .avg-line-label {
    position: absolute;
    top: 0;
    left: 6px;
    padding: 1px 6px;
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--accent-color);
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .bar-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 100%;
    cursor: pointer;
    position: relative;
  }

  .bar-wrapper.selected .bar-stack {
    box-shadow: 0 0 0 2px var(--accent-color);
  }

  .bar-tooltip {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    min-width: 128px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
    font-size: var(--text-xs);
    color: var(--text-primary);
    pointer-events: none;
  }

  .bar-tooltip-title {
    font-weight: 700;
    margin-bottom: 6px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .bar-tooltip-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 0;
    white-space: nowrap;
  }

  .bar-tooltip-row i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .bar-tooltip-row b {
    margin-left: auto;
    padding-left: 10px;
    font-variant-numeric: tabular-nums;
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
    transition: opacity 0.15s;
  }

  .legend-item.dim {
    opacity: 0.3;
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
