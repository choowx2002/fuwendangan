<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import {
    X,
    Maximize,
    Minimize,
    Minus,
    ZoomIn,
    ZoomOut,
    Undo2,
    RefreshCw,
    Pin,
    PinOff,
  } from '@lucide/svelte'
  import CachedImage from './CachedImage.svelte'
  import { printCacheName } from '$lib/db/helper'
  import { sortCardPrints, combineCardPrints } from '$lib/cards/utils/card-print-utils'
  import { getCardBackFallback } from '$lib/cards/utils/variant-utils'
  import { isTauri } from '$lib/db/env'
  import { showForeignCardArt, defaultLanguage } from '$lib/stores/settings'
  import type { CardBase, CardPrint } from '$lib/db'
  import { t } from '$lib/i18n'

  interface Props {
    card: CardBase & { card_prints?: CardPrint[] }
  }

  let { card }: Props = $props()

  // ---------- 版本数据 ----------
  const groupKeys = $derived.by(() => {
    if (!card.card_prints?.length) return []
    const sorted = sortCardPrints(card.card_prints)
    return Array.from(combineCardPrints(sorted).keys())
  })
  const groupMap = $derived.by(() => {
    if (!card.card_prints?.length) return new Map<string, CardPrint[]>()
    return combineCardPrints(sortCardPrints(card.card_prints))
  })

  let selectedKey = $state<string | null>(null)
  // 默认语言跟随 settings.defaultLanguage
  let selectedLang = $state<string>('SC')

  /** 是否展示外文卡图（settings.showForeignCardArt） */
  const showForeign = $derived($showForeignCardArt)

  // 当前展示的卡图（未指定语言时取该组首个）
  const currentPrint = $derived.by(() => {
    if (!selectedKey) return null
    const group = groupMap.get(selectedKey)
    if (!group?.length) return null
    // 不展示外文卡图时，仅使用默认语言（defaultLanguage）
    const targetLang = showForeign ? selectedLang : $defaultLanguage
    const exact = group.find((p) => p.language === targetLang)
    return exact ?? group[0]
  })
  const currentLangPrints = $derived.by(() => {
    if (!selectedKey) return []
    return groupMap.get(selectedKey) ?? []
  })

  $effect(() => {
    if (selectedKey === null && groupKeys.length > 0) {
      selectedKey = groupKeys[0]
      const firstGroup = groupMap.get(groupKeys[0])
      const lang = $defaultLanguage || 'SC'
      selectedLang =
        firstGroup?.find((p) => p.language === lang)?.language ??
        firstGroup?.find((p) => p.language === 'SC')?.language ??
        firstGroup?.[0]?.language ??
        'SC'
    }
  })

  // 标题 = 卡牌名；若当前卡图为英文且无中文，仍用卡名（中文名为主）
  const windowTitle = $derived(card.card_name_cn || card.card_name_en || '')

  $effect(() => {
    if (isTauri && windowTitle) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .setTitle(windowTitle)
          .catch(() => {})
      )
    }
  })

  const isBattlefield = $derived(card.card_category?.includes('战场') ?? false)
  const cardBack = $derived(getCardBackFallback(card.card_category))

  // 展示尺寸：横版（战场）用较大宽度，竖版用较高高度；卡牌比例 744:1040
  const cardWidth = $derived(Math.round(isBattlefield ? 620 : 380))
  const cardHeight = $derived(Math.round(cardWidth * (1040 / 744)))

  // 稀有度 → 全息强度（与 FoilCard 一致）
  const RARITY_INTENSITY: Record<string, number> = {
    普通: 0.15,
    不凡: 0.3,
    稀有: 0.55,
    史诗: 0.75,
    异画: 0.9,
  }
  const intensity = $derived(
    RARITY_INTENSITY[currentPrint?.extend_rarity_name ?? ''] ??
      RARITY_INTENSITY[card.rarity_name ?? ''] ??
      0.4
  )

  // ---------- 3D 倾斜 ----------
  let rotateX = $state(0)
  let rotateY = $state(0)
  let shineX = $state(50)
  let shineY = $state(20)
  let flipped = $state(false)
  /** 卡面当前朝向（0 = 正面，180 = 背面），用于容器整体翻转 */
  let flipAngle = $derived(flipped ? 180 : 0)
  let reducedMotion = $state(false)
  let idleAutoRotate = $state(false)
  let lastPointerAt = $state(0)

  // ---------- 缩放 / 平移 ----------
  let scale = $state(1)
  const MIN_SCALE = 0.8
  const MAX_SCALE = 4
  let tx = $state(0)
  let ty = $state(0)
  let dragging = $state(false)
  let dragStartX = $state(0)
  let dragStartY = $state(0)

  // ---------- 全屏 ----------
  let isFullscreen = $state(false)

  $effect(() => {
    reducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  function resetTransform() {
    rotateX = 0
    rotateY = 0
    shineX = 50
    shineY = 20
    scale = 1
    tx = 0
    ty = 0
    flipped = false
  }

  function handlePointerMove(e: PointerEvent) {
    lastPointerAt = Date.now()
    idleAutoRotate = false
    if (flipped) return
    // 倾斜仅对鼠标（精确指针）生效；触控板/触摸走轻微响应，避免误触抖动
    const isFine = e.pointerType === 'mouse'
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    rotateY = (x - 0.5) * 18
    rotateX = -(y - 0.5) * 18
    shineX = x * 100
    shineY = y * 100
    if (!isFine) {
      // 非鼠标：微弱跟随即可，避免缩放/滚动时的抖动
      rotateX *= 0.35
      rotateY *= 0.35
    }
  }

  function handlePointerLeave() {
    rotateX = 0
    rotateY = 0
    shineX = 50
    shineY = 20
  }

  function toggleFlip() {
    flipped = !flipped
  }

  // ---------- 缩放 ----------
  function zoomBy(factor: number) {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor))
  }

  function resetZoom() {
    scale = 1
    tx = 0
    ty = 0
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.15 : 0.87)
  }

  let dragDistance = 0
  let suppressClick = $state(false)

  function handlePanStart(e: PointerEvent) {
    // 任意缩放级别都可拖动卡牌位置
    if (e.button !== undefined && e.button !== 0) return
    dragging = true
    suppressClick = false
    dragDistance = 0
    dragStartX = e.clientX - tx
    dragStartY = e.clientY - ty
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePanMove(e: PointerEvent) {
    if (!dragging) return
    const dx = e.clientX - (dragStartX + tx)
    const dy = e.clientY - (dragStartY + ty)
    dragDistance = Math.max(dragDistance, Math.hypot(dx, dy))
    if (dragDistance > 6) suppressClick = true
    tx = e.clientX - dragStartX
    ty = e.clientY - dragStartY
  }

  function handlePanEnd() {
    dragging = false
  }

  // ---------- 全屏 ----------
  async function toggleFullscreen() {
    const el = document.documentElement
    if (!document.fullscreenElement) {
      await el.requestFullscreen().catch(() => {})
    } else {
      await document.exitFullscreen().catch(() => {})
    }
  }

  // ---------- 自动展示模式 ----------
  const IDLE_MS = 3000
  let autoAngle = $state(0)
  let autoShine = $state(0)
  let idleTimer: ReturnType<typeof setInterval> | null = null

  function startIdleTimer() {
    if (idleTimer) clearInterval(idleTimer)
    idleTimer = setInterval(() => {
      if (reducedMotion) return
      const idleFor = Date.now() - lastPointerAt
      if (idleFor > IDLE_MS && !flipped) {
        idleAutoRotate = true
      }
    }, 500)
  }

  $effect(() => {
    if (!idleAutoRotate || reducedMotion) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      autoAngle = (autoAngle + dt * 14) % 360
      autoShine = (autoShine + dt * 30) % 100
      rotateX = 6 * Math.sin((autoAngle * Math.PI) / 180)
      rotateY = 10 * Math.sin((autoAngle * Math.PI) / 180)
      shineX = autoShine
      shineY = 35
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  })

  // ---------- 版本选择 ----------
  function selectGroup(key: string) {
    selectedKey = key
    const group = groupMap.get(key)
    // 不展示外文卡图时，始终用默认语言
    const target = showForeign ? selectedLang : $defaultLanguage || 'SC'
    if (group?.some((p) => p.language === target)) {
      selectedLang = target
    } else {
      selectedLang = group?.[0]?.language ?? 'SC'
    }
    resetZoom()
  }

  function selectLang(lang: string) {
    if (!showForeign) return
    selectedLang = lang
  }

  function closeWindow() {
    if (isTauri) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .close()
          .catch(() => {})
      )
    } else {
      window.history.back()
    }
  }

  function minimizeWindow() {
    if (!isTauri) return
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .minimize()
        .catch(() => {})
    )
  }

  /** 卡片化：窗口缩小到卡牌尺寸并置顶（用于随时挂在桌面上看卡），再次点击放大恢复 */
  let cardized = $state(false)
  let cardizedPrevScale = $state(1)

  async function cardizeWindow() {
    if (!isTauri) return
    const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
      import('@tauri-apps/api/window'),
      import('@tauri-apps/api/dpi'),
    ])
    const win = getCurrentWindow()
    cardized = !cardized
    if (cardized) {
      cardizedPrevScale = scale
      // 卡片尺寸：略大于卡牌展示尺寸（含一点边距）
      const w = Math.min(cardWidth + 48, 460)
      const h = cardHeight + 96
      await win.setSize(new LogicalSize(w, h)).catch(() => {})
      await win.center().catch(() => {})
      await win.setAlwaysOnTop(true).catch(() => {})
      scale = Math.min(scale, 0.9)
      resetZoom()
    } else {
      await win.setSize(new LogicalSize(760, 720)).catch(() => {})
      await win.center().catch(() => {})
      await win.setAlwaysOnTop(false).catch(() => {})
      scale = cardizedPrevScale
    }
  }

  onMount(() => {
    lastPointerAt = Date.now()
    startIdleTimer()
    const syncFs = () => (isFullscreen = document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', syncFs)
    const keydown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') zoomBy(1.15)
      if (e.key === '-') zoomBy(0.87)
      if (e.key === '0') resetZoom()
      if (e.key === 'f' || e.key === 'F') toggleFlip()
      if (e.key === 'Escape') {
        if (scale > 1) {
          resetZoom()
        } else {
          closeWindow()
        }
      }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      if (idleTimer) clearInterval(idleTimer)
      document.removeEventListener('fullscreenchange', syncFs)
      window.removeEventListener('keydown', keydown)
    }
  })
  onDestroy(() => {
    if (idleTimer) clearInterval(idleTimer)
  })
</script>

<div class="showcase" class:reduced={reducedMotion} role="presentation">
  <!-- 工具栏（无边框窗口：标题与空白区可拖动；按钮保持可点击） -->
  <div class="toolbar">
    <button
      class="tool-btn"
      onclick={minimizeWindow}
      aria-label={$t('showcase.minimize')}
      title={$t('showcase.minimize')}
    >
      <Minus size={18} />
    </button>
    <button
      class="tool-btn"
      onclick={closeWindow}
      aria-label={$t('common.close')}
      title={$t('common.close')}
    >
      <X size={18} />
    </button>
    <span class="title" data-tauri-drag-region>{windowTitle}</span>
    <span class="toolbar-spacer" data-tauri-drag-region></span>
    <button
      class="tool-btn"
      onclick={resetZoom}
      aria-label={$t('showcase.reset')}
      title={$t('showcase.reset')}
    >
      <Undo2 size={18} />
    </button>
    <button
      class="tool-btn"
      onclick={() => zoomBy(0.87)}
      aria-label={$t('showcase.zoomOut')}
      title={$t('showcase.zoomOut')}
    >
      <ZoomOut size={18} />
    </button>
    <button
      class="tool-btn"
      onclick={() => zoomBy(1.15)}
      aria-label={$t('showcase.zoomIn')}
      title={$t('showcase.zoomIn')}
    >
      <ZoomIn size={18} />
    </button>
    <button
      class="tool-btn"
      onclick={toggleFlip}
      aria-label={$t('showcase.flip')}
      title={$t('showcase.flip')}
    >
      <RefreshCw size={18} />
    </button>
    <button
      class="tool-btn"
      class:active={cardized}
      onclick={() => void cardizeWindow()}
      aria-label={$t(cardized ? 'showcase.uncardize' : 'showcase.cardize')}
      title={$t(cardized ? 'showcase.uncardize' : 'showcase.cardize')}
    >
      {#if cardized}<PinOff size={18} />{:else}<Pin size={18} />{/if}
    </button>
    <button
      class="tool-btn"
      onclick={() => void toggleFullscreen()}
      aria-label={$t(isFullscreen ? 'showcase.exitFullscreen' : 'showcase.enterFullscreen')}
      title={$t(isFullscreen ? 'showcase.exitFullscreen' : 'showcase.enterFullscreen')}
    >
      {#if isFullscreen}<Minimize size={18} />{:else}<Maximize size={18} />{/if}
    </button>
  </div>

  <!-- 舞台（平移/缩放仅作用于卡牌区，避免吞掉工具栏按钮点击） -->
  <div
    class="stage"
    onpointerdown={handlePanStart}
    onpointermove={handlePanMove}
    onpointerup={handlePanEnd}
    onpointercancel={handlePanEnd}
    onwheel={handleWheel}
    role="presentation"
  >
    <div
      class="card-stage"
      style={`--tx: ${tx}px; --ty: ${ty}px; --scale: ${scale};`}
      role="presentation"
    >
      <div
        class="foil-inner"
        class:flipped
        style={`
          --w: ${cardWidth}px;
          --h: ${cardHeight}px;
          transform: rotateX(${rotateX}deg) rotateY(${rotateY}deg);
        `}
      >
        <div
          class="face front"
          role="button"
          tabindex="0"
          aria-label={$t('showcase.flip')}
          onpointermove={handlePointerMove}
          onpointerleave={handlePointerLeave}
          onclick={() => {
            if (suppressClick) return
            toggleFlip()
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              toggleFlip()
            }
          }}
        >
          {#if currentPrint}
            <CachedImage
              src={currentPrint.img_cdn || currentPrint.tts_cdn || ''}
              name={printCacheName(currentPrint)}
              fit="cover"
              borderRadius="10px"
              lazy={false}
            />
          {/if}
          <!-- 全息层 -->
          <div
            class="foil-overlay"
            style={`--shine-x: ${shineX}%; --shine-y: ${shineY}%; --intensity: ${intensity};`}
          ></div>
          <!-- 光标高光 -->
          <div class="cursor-glow" style={`--shine-x: ${shineX}%; --shine-y: ${shineY}%;`}></div>
          <!-- 边框光 -->
          <div class="edge-glow"></div>
        </div>

        <div class="face back">
          <img src={cardBack} alt="" class="back-fallback-img" draggable="false" />
        </div>
      </div>
    </div>
  </div>

  <!-- 底部：语言 + 版本缩略图 -->
  <div class="dock">
    {#if showForeign && currentLangPrints.length > 1}
      <div class="lang-row">
        {#each currentLangPrints as p (p.language)}
          <button
            class="lang-pill"
            class:active={p.language === selectedLang}
            onclick={() => selectLang(p.language)}
          >
            {p.language.toUpperCase()}
          </button>
        {/each}
      </div>
    {/if}

    {#if groupKeys.length > 1}
      <div class="thumb-row">
        {#each groupKeys as key (key)}
          <button class="thumb" class:active={key === selectedKey} onclick={() => selectGroup(key)}>
            <CachedImage
              src={groupMap.get(key)?.[0]?.img_cdn || groupMap.get(key)?.[0]?.tts_cdn || ''}
              name={printCacheName(groupMap.get(key)?.[0])}
              fit="cover"
              borderRadius="6px"
              lazy={false}
            />
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .showcase {
    position: relative;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    /* 无边框透明窗口：中央保留柔光暗影衬托卡牌，四边淡出到透明 */
    background: radial-gradient(
      ellipse at center,
      rgba(12, 16, 28, 0.78) 0%,
      rgba(6, 8, 16, 0.45) 55%,
      transparent 100%
    );
    overflow: hidden;
    user-select: none;
  }

  /* ---------- 工具栏 ---------- */
  .toolbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 16px;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
  }

  .tool-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: #cbd5e1;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .tool-btn:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
  }
  .tool-btn.active {
    background: rgba(122, 162, 255, 0.35);
    color: #fff;
  }

  .title {
    font-size: var(--text-base);
    font-weight: 600;
    color: #f1f5f9;
    margin-left: 8px;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar-spacer {
    flex: 1;
  }

  /* ---------- 舞台 ---------- */
  .stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .card-stage {
    transform: translate(var(--tx), var(--ty)) scale(var(--scale));
    transform-origin: center center;
    transition: transform 0.05s linear;
    cursor: grab;
  }
  .card-stage:active {
    cursor: grabbing;
  }

  .foil-inner {
    position: relative;
    width: var(--w);
    height: var(--h);
    border-radius: 10px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
    perspective: 1200px;
    transition: transform 0.2s ease-out;
    will-change: transform;
  }

  .face {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    backface-visibility: hidden;
    transition: opacity 0.25s ease;
  }

  .face.front {
    opacity: 1;
    z-index: 2;
  }

  .face.back {
    background: #1a1d29;
    opacity: 0;
    z-index: 1;
  }

  .foil-inner.flipped .face.front {
    opacity: 0;
    z-index: 1;
  }

  .foil-inner.flipped .face.back {
    opacity: 1;
    z-index: 2;
  }

  .back-fallback-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    -webkit-user-drag: none;
    user-select: none;
  }

  .foil-inner :global(img) {
    -webkit-user-drag: none;
    user-select: none;
  }

  .foil-inner :global(.cache-image-container) {
    width: 100%;
    height: 100%;
  }

  /* ---------- 全息层 ---------- */
  .foil-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    mix-blend-mode: overlay;
    background:
      radial-gradient(
        circle at var(--shine-x) var(--shine-y),
        rgba(255, 255, 255, 0.6),
        transparent 40%
      ),
      linear-gradient(
        115deg,
        rgba(255, 0, 128, 0.5),
        rgba(255, 170, 0, 0.45),
        rgba(0, 255, 170, 0.45),
        rgba(0, 170, 255, 0.5),
        rgba(170, 0, 255, 0.5)
      );
    background-size: 220% 220%;
    animation: foil-shift 5s ease-in-out infinite alternate;
    opacity: var(--intensity, 0.4);
  }

  @keyframes foil-shift {
    from {
      background-position: 0% 0%;
    }
    to {
      background-position: 100% 100%;
    }
  }

  /* 光标高光 */
  .cursor-glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      circle at var(--shine-x) var(--shine-y),
      rgba(255, 255, 255, 0.22),
      transparent 55%
    );
    opacity: 0.5;
    mix-blend-mode: screen;
  }

  /* 边框光 */
  .edge-glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: 10px;
    box-shadow:
      inset 0 0 22px rgba(255, 255, 255, 0.25),
      0 0 18px rgba(150, 180, 255, 0.28);
  }

  .reduced .foil-overlay,
  .reduced .cursor-glow {
    animation: none;
  }

  /* ---------- 底部坞 ---------- */
  .dock {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent);
  }

  .lang-row {
    display: flex;
    gap: 6px;
  }

  .lang-pill {
    padding: 4px 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: #cbd5e1;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .lang-pill.active {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.4);
  }

  .thumb-row {
    display: flex;
    gap: 8px;
    max-width: 90vw;
    overflow-x: auto;
    padding: 4px;
  }

  .thumb {
    width: 56px;
    flex-shrink: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    padding: 0;
    background: transparent;
    cursor: pointer;
    overflow: hidden;
  }
  .thumb.active {
    border-color: var(--accent-color, #7aa2ff);
  }
  .thumb :global(.cache-image-container) {
    height: 78px;
    width: 56px;
  }
</style>
