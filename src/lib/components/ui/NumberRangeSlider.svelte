<!-- src/lib/components/ui/NumberRangeSlider.svelte -->
<script lang="ts">
  import type { NumberRange } from '$lib/db/types'
  import { t } from 'svelte-i18n'

  interface Props {
    value: NumberRange
    min: number
    max: number
    step?: number
  }

  let { value = $bindable(), min, max, step = 1 }: Props = $props()

  let trackEl: HTMLDivElement
  let dragging: 'min' | 'max' | 'both' | null = $state(null)

  // 记录拖动开始时的初始状态，用于计算整体平移的偏移量
  let initialMin = 0
  let initialMax = 0
  let initialClickVal = 0

  // 计算百分比
  const minPercent = $derived(((value.min - min) / (max - min)) * 100)
  const maxPercent = $derived(((value.max - min) / (max - min)) * 100)

  // 坐标转数值
  function getValueFromPosition(clientX: number) {
    const rect = trackEl.getBoundingClientRect()
    let percent = (clientX - rect.left) / rect.width
    percent = Math.max(0, Math.min(1, percent))
    let val = min + percent * (max - min)
    val = Math.round(val / step) * step
    return Math.max(min, Math.min(max, val))
  }

  // 1. 点击轨道空白处 (Track)
  function onTrackPointerDown(e: PointerEvent) {
    e.preventDefault()
    const clickVal = getValueFromPosition(e.clientX)
    initialClickVal = clickVal
    initialMin = value.min
    initialMax = value.max

    if (value.min === value.max) {
      dragging = clickVal < value.min ? 'min' : 'max'
    } else {
      // 正常情况：智能判断距离
      const distToMin = Math.abs(clickVal - value.min)
      const distToMax = Math.abs(clickVal - value.max)
      dragging = distToMin <= distToMax ? 'min' : 'max'
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  // 2. 点击重叠的 Thumb (整体拖动)
  function onBothPointerDown(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()

    const clickVal = getValueFromPosition(e.clientX)
    initialClickVal = clickVal
    initialMin = value.min
    initialMax = value.max

    dragging = 'both' // 标记为整体拖动
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  // 3. 拖动过程
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    const newVal = getValueFromPosition(e.clientX)

    if (dragging === 'min') {
      const safeMin = Math.min(newVal, value.max)
      if (safeMin !== value.min) value = { ...value, min: safeMin }
    } else if (dragging === 'max') {
      const safeMax = Math.max(newVal, value.min)
      if (safeMax !== value.max) value = { ...value, max: safeMax }
    } else if (dragging === 'both') {
      const delta = newVal - initialClickVal
      let targetMin = initialMin + delta
      let targetMax = initialMax + delta
      const width = initialMax - initialMin // 保持初始宽度

      // 边界截断：防止拖出全局 min/max
      if (targetMin < min) {
        targetMin = min
        targetMax = min + width
      }
      if (targetMax > max) {
        targetMax = max
        targetMin = max - width
      }

      if (targetMin !== value.min || targetMax !== value.max) {
        value = { min: targetMin, max: targetMax }
      }
    }
  }

  // 4. 松开
  function onPointerUp(e: PointerEvent) {
    dragging = null
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    }
  }
</script>

<div
  aria-label={$t('slider.rangeLabel')}
  role="group"
  class="custom-range-slider"
  onpointerdown={onTrackPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <div class="slider-track" bind:this={trackEl}>
    <div class="slider-range" style="left: {minPercent}%; width: {maxPercent - minPercent}%;"></div>
  </div>

  {#if value.min === value.max}
    <div
      role="group"
      class="slider-thumb thumb-both"
      class:is-dragging={dragging === 'both'}
      style="left: {minPercent}%;"
      onpointerdown={onBothPointerDown}
    ></div>
  {:else}
    <div
      class="slider-thumb thumb-min"
      class:is-dragging={dragging === 'min'}
      style="left: {minPercent}%;"
    ></div>
    <div
      class="slider-thumb thumb-max"
      class:is-dragging={dragging === 'max'}
      style="left: {maxPercent}%;"
    ></div>
  {/if}
</div>

<style>
  .custom-range-slider {
    position: relative;
    height: 24px;
    width: 90%;
    touch-action: none;
    user-select: none;
    cursor: pointer;
    margin: 0 auto;
  }

  .slider-track {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 100%;
    height: 4px;
    background: var(--border-color, #e5e7eb);
    border-radius: 2px;
  }

  .slider-range {
    position: absolute;
    height: 100%;
    background: var(--accent-color, #3b82f6);
    border-radius: 2px;
    transition:
      width 0.05s linear,
      left 0.05s linear;
  }

  /* 基础 Thumb 样式 */
  .slider-thumb {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 18px;
    height: 18px;
    background: var(--accent-color, #3b82f6);
    border: 0px solid var(--bg-primary, #fff);
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0);
    z-index: 2;
    padding: 8px;
    background-clip: content-box;
    box-sizing: content-box;
    transition:
      transform 0.1s,
      box-shadow 0.1s;
  }

  .thumb-max {
    z-index: 3;
  }
  .thumb-both {
    z-index: 4;
  } /* 重叠时的 Thumb 层级最高 */

  .slider-thumb:hover,
  .slider-thumb.is-dragging {
    transform: translate(-50%, -50%) scale(1.2);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }
</style>
