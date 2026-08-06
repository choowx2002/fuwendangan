<script lang="ts">
  import type { CardPrint } from '$lib/db'
  import { printCacheName } from '$lib/db'
  import CachedImage from './CachedImage.svelte'
  import { Expand, X } from '@lucide/svelte'

  let {
    print = undefined as CardPrint | undefined,
    cardName = '',
    rarity = '',
    size = 'md' as 'sm' | 'md' | 'lg',
    interactive = true,
    onEnlarge = undefined as (() => void) | undefined,
  } = $props()

  // 稀有度 → 全息强度
  const RARITY_INTENSITY: Record<string, number> = {
    普通: 0.15,
    不凡: 0.3,
    稀有: 0.55,
    史诗: 0.75,
    异画: 0.9,
  }
  const intensity = $derived(RARITY_INTENSITY[rarity] ?? 0.4)

  const SIZE_MAP: Record<string, number> = {
    sm: 128,
    md: 210,
    lg: 320,
  }
  const px = $derived(SIZE_MAP[size] ?? 210)
  const imageHeight = $derived(Math.round(px * (1040 / 744)))

  let rotateX = $state(0)
  let rotateY = $state(0)
  let flipped = $state(false)
  let shineX = $state(50)
  let shineY = $state(20)
  let enlarged = $state(false)
  let reducedMotion = $state(false)

  $effect(() => {
    reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  function handlePointerMove(e: PointerEvent) {
    if (!interactive || reducedMotion || flipped) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    rotateY = (x - 0.5) * 16
    rotateX = -(y - 0.5) * 16
    shineX = x * 100
    shineY = y * 100
  }

  function handlePointerLeave() {
    rotateX = 0
    rotateY = 0
    shineX = 50
    shineY = 20
  }

  function toggleFlip() {
    if (!interactive) return
    flipped = !flipped
  }

  function openEnlarge(e: Event) {
    if (!interactive) return
    e.stopPropagation()
    if (onEnlarge) onEnlarge()
    else enlarged = true
  }
</script>

<div class="foil-card" class:size-sm={size === 'sm'} style={`--foil-intensity: ${intensity}`}>
  <div
    class="foil-inner"
    class:flipped={flipped}
    style={`width: ${px}px; height: ${imageHeight}px;`}
    role="presentation"
    onpointermove={handlePointerMove}
    onpointerleave={handlePointerLeave}
    onclick={toggleFlip}
    oncontextmenu={(e) => {
      e.preventDefault()
      openEnlarge(e)
    }}
  >
    <div
      class="face front"
      style={`transform: rotateX(${rotateX}deg) rotateY(${rotateY}deg);`}
    >
      <CachedImage
        src={print?.img_cdn ?? print?.tts_cdn ?? ''}
        name={printCacheName(print)}
        fit="cover"
        borderRadius="8px"
        lazy={false}
      />
      <div
        class="foil-overlay"
        style={`--shine-x: ${shineX}%; --shine-y: ${shineY}%; opacity: ${reducedMotion ? 0.25 : 1};`}
      ></div>
      {#if interactive}
        <div class="actions">
          <button
            class="btn-icon"
            title="放大"
            onclick={(e) => openEnlarge(e)}
            onpointerdown={(e) => e.stopPropagation()}
          >
            <Expand size={14} />
          </button>
        </div>
      {/if}
    </div>

    <div class="face back" style={`transform: rotateX(${rotateX}deg) rotateY(${rotateY}deg);`}>
      {#if print?.back_image}
        <CachedImage
          src={print.back_image}
          name={`${printCacheName(print)}-back`}
          fit="cover"
          borderRadius="8px"
          lazy={false}
        />
      {:else}
        <div class="back-fallback">
          <span>符文档案</span>
          <small>{cardName || '卡背'}</small>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if enlarged}
  <div
    class="lightbox"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={() => (enlarged = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') enlarged = false
    }}
  >
    <div
      class="lightbox-body"
      role="presentation"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') enlarged = false
      }}
    >
      <CachedImage
        src={print?.img_cdn ?? print?.tts_cdn ?? ''}
        name={printCacheName(print)}
        fit="cover"
        borderRadius="12px"
        lazy={false}
      />
      <button class="btn-close" title="关闭" onclick={() => (enlarged = false)}>
        <X size={18} />
      </button>
    </div>
  </div>
{/if}

<style>
  .foil-card {
    display: inline-block;
    perspective: 1000px;
  }

  .foil-inner {
    position: relative;
    transform-style: preserve-3d;
    cursor: pointer;
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .foil-inner.flipped .front {
    transform: rotateY(180deg) !important;
  }

  .foil-inner.flipped .back {
    transform: rotateY(0deg) !important;
  }

  .face {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    border-radius: 10px;
    overflow: hidden;
    transition: transform 0.15s ease-out;
    will-change: transform;
  }

  .face.back {
    transform: rotateY(180deg);
    background: #1a1d29;
  }

  .face.back :global(.cache-image-container) {
    height: 100%;
  }

  /* ========== 全息层 ========== */
  .foil-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    mix-blend-mode: overlay;
    background:
      radial-gradient(
        circle at var(--shine-x) var(--shine-y),
        rgba(255, 255, 255, 0.55),
        transparent 45%
      ),
      linear-gradient(
        115deg,
        rgba(255, 0, 128, 0.45),
        rgba(255, 170, 0, 0.4),
        rgba(0, 255, 170, 0.4),
        rgba(0, 170, 255, 0.45),
        rgba(170, 0, 255, 0.45)
      );
    background-size: 220% 220%;
    animation: foil-shift 6s ease-in-out infinite alternate;
    opacity: var(--foil-intensity);
  }

  @keyframes foil-shift {
    from {
      background-position: 0% 0%;
    }
    to {
      background-position: 100% 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .foil-overlay {
      animation: none;
    }
  }

  /* ========== 操作按钮 ========== */
  .actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .foil-inner:hover .actions {
    opacity: 1;
  }

  .btn-icon {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    cursor: pointer;
  }

  .btn-icon:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  /* ========== 卡背兜底 ========== */
  .back-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.75);
    font-size: 14px;
    letter-spacing: 0.2em;
    background:
      radial-gradient(circle at 50% 40%, #2c3250, #151826 70%);
  }

  .back-fallback small {
    font-size: 11px;
    opacity: 0.6;
  }

  /* ========== 放大查看 ========== */
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
  }

  .lightbox-body {
    position: relative;
    width: min(78vw, 420px);
  }

  .btn-close {
    position: absolute;
    top: -14px;
    right: -14px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
    cursor: pointer;
  }

  .btn-close:hover {
    background: rgba(255, 255, 255, 0.3);
  }
</style>
