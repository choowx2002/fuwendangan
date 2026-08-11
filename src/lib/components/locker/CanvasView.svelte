<script lang="ts">
  /**
   * 通用节点画布（类 Obsidian Canvas）。
   * 节点自由拖拽（8px 网格吸附、松手持久化）、滚轮以光标为锚点缩放、拖空白平移；
   * 未放置的节点（pos 为空）在底部托盘，拖出即放置，拖回托盘清空位置。
   */
  import CardSimpleImage from '../cards/CardSimpleImage.svelte'
  import type { CanvasNode } from './canvas-types'
  import { onDestroy } from 'svelte'
  import { t } from '$lib/i18n'

  let {
    nodes = [] as CanvasNode[],
    onPersistMove = undefined as ((id: string, x: number, y: number) => void | Promise<void>) | undefined,
    onPersistPlace = undefined as ((id: string, x: number, y: number) => void | Promise<void>) | undefined,
    onPersistUnplace = undefined as ((id: string) => void | Promise<void>) | undefined,
    onNodeClick = undefined as ((id: string) => void) | undefined,
  } = $props()

  const GRID = 8
  const NODE_W = 190
  const NODE_H = 150

  let rootEl = $state<HTMLDivElement | null>(null)
  let trayEl = $state<HTMLDivElement | null>(null)
  let viewport = $state({ tx: 32, ty: 32, zoom: 1 })
  let dragOverrides = $state(new Map<string, { x: number; y: number }>())

  const placedNodes = $derived(nodes.filter((n) => n.pos_x != null && n.pos_y != null))
  const trayNodes = $derived(nodes.filter((n) => n.pos_x == null || n.pos_y == null))

  let drag = $state<{
    kind: 'node' | 'tray' | 'pan'
    nodeId: string | null
    startX: number
    startY: number
    grabDX: number
    grabDY: number
    startPan: { tx: number; ty: number }
    preview: { x: number; y: number } | null
  } | null>(null)

  /** 最近一次指针按下是否发生过拖动（用于抑制拖拽后的 click 误触发） */
  let lastDragMoved = false

  /** 长按拖拽：按下后延迟 PRESS_DELAY ms 或移动超阈值才真正开始拖拽（快速点击 → 触发跳转） */
  const PRESS_DELAY = 250
  const MOVE_THRESHOLD = 5
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let pendingNode: {
    node: CanvasNode
    pointerId: number
    startX: number
    startY: number
    grabDX: number
    grabDY: number
  } | null = null

  function clearPress() {
    if (pressTimer) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
    pendingNode = null
  }

  function beginNodeDrag(p: NonNullable<typeof pendingNode>) {
    pendingNode = null
    lastDragMoved = true
    drag = {
      kind: 'node',
      nodeId: p.node.id,
      startX: p.startX,
      startY: p.startY,
      grabDX: p.grabDX,
      grabDY: p.grabDY,
      startPan: { tx: 0, ty: 0 },
      preview: { x: p.node.pos_x ?? 0, y: p.node.pos_y ?? 0 },
    }
    // 必须捕获到 rootEl：canvas-root 的 onpointermove/onpointerup 才能持续收到事件
    rootEl?.setPointerCapture(p.pointerId)
    console.log('[Canvas] node drag started, node=', p.node.id)
  }

  function screenToCanvas(sx: number, sy: number) {
    const rect = rootEl!.getBoundingClientRect()
    return {
      x: (sx - rect.left - viewport.tx) / viewport.zoom,
      y: (sy - rect.top - viewport.ty) / viewport.zoom,
    }
  }

  const snap = (v: number) => Math.round(v / GRID) * GRID

  function nodeStyle(node: CanvasNode) {
    const override = dragOverrides.get(node.id)
    const x = override?.x ?? node.pos_x ?? 0
    const y = override?.y ?? node.pos_y ?? 0
    return `left: ${x}px; top: ${y}px;`
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const rect = rootEl!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const next = Math.min(2, Math.max(0.5, viewport.zoom * factor))
    const wx = (cx - viewport.tx) / viewport.zoom
    const wy = (cy - viewport.ty) / viewport.zoom
    viewport = { zoom: next, tx: cx - wx * next, ty: cy - wy * next }
  }

  function startPan(e: PointerEvent) {
    console.log('[Canvas] startPan pointerdown', e.pointerId, e.clientX, e.clientY, 'target=', (e.target as HTMLElement).className)
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.canvas-node, .tray-node')) return
    drag = {
      kind: 'pan',
      nodeId: null,
      startX: e.clientX,
      startY: e.clientY,
      grabDX: 0,
      grabDY: 0,
      startPan: { tx: viewport.tx, ty: viewport.ty },
      preview: null,
    }
    rootEl?.setPointerCapture(e.pointerId)
    console.log('[Canvas] pan captured on root, viewport=', viewport)
  }

  /** 画布节点按下：不立即拖拽 —— 长按 PRESS_DELAY 或移动超阈值才开始（快速点击留给 click 跳转） */
  function onNodePointerDown(e: PointerEvent, node: CanvasNode) {
    e.stopPropagation()
    console.log('[Canvas] node pointerdown', e.pointerId, e.clientX, e.clientY, 'node=', node.id)
    if (e.button !== 0) return
    if (node.pos_x == null || node.pos_y == null) return
    if (drag || pendingNode) return
    const pos = screenToCanvas(e.clientX, e.clientY)
    pendingNode = {
      node,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabDX: pos.x - node.pos_x,
      grabDY: pos.y - node.pos_y,
    }
    pressTimer = setTimeout(() => {
      if (pendingNode) beginNodeDrag(pendingNode)
    }, PRESS_DELAY)
    console.log('[Canvas] node press armed (250ms), grab=', pendingNode.grabDX, pendingNode.grabDY)
  }

  function startTrayDrag(e: PointerEvent, node: CanvasNode) {
    e.stopPropagation()
    console.log('[Canvas] startTrayDrag pointerdown', e.pointerId, e.clientX, e.clientY, 'node=', node.id)
    if (e.button !== 0) return
    drag = {
      kind: 'tray',
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      grabDX: 0,
      grabDY: 0,
      startPan: { tx: 0, ty: 0 },
      preview: null,
    }
    // 必须捕获到 rootEl：canvas-root 的 onpointermove/onpointerup 才能持续收到事件
    rootEl?.setPointerCapture(e.pointerId)
    console.log('[Canvas] tray drag captured')
  }

  function onPointerMove(e: PointerEvent) {
    // 长按尚未开始拖拽：移动超阈值则立即开始（无需等 250ms）
    if (!drag && pendingNode) {
      const dx = e.clientX - pendingNode.startX
      const dy = e.clientY - pendingNode.startY
      if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
        console.log('[Canvas] move beyond threshold, start drag immediately')
        clearPress()
        beginNodeDrag(pendingNode)
      }
      return
    }
    const d = drag
    if (!d) return
    if (d.kind === 'pan') {
      viewport = {
        ...viewport,
        tx: d.startPan.tx + (e.clientX - d.startX),
        ty: d.startPan.ty + (e.clientY - d.startY),
      }
      return
    }
    const moved = Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3
    if (moved) {
      lastDragMoved = true
    }
    const pos = screenToCanvas(e.clientX, e.clientY)
    if (d.kind === 'node' && d.nodeId) {
      const x = snap(pos.x - d.grabDX)
      const y = snap(pos.y - d.grabDY)
      d.preview = { x, y }
      dragOverrides = new Map(dragOverrides).set(d.nodeId, { x, y })
      console.log('[Canvas] move node', d.nodeId, '->', x, y, 'moved=', moved)
    } else if (d.kind === 'tray' && d.nodeId) {
      d.preview = { x: snap(pos.x - NODE_W / 2), y: snap(pos.y - NODE_H / 2) }
      console.log('[Canvas] move tray', d.nodeId, 'preview=', d.preview, 'moved=', moved)
    }
  }

  function isInside(el: HTMLElement | null, cx: number, cy: number) {
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom
  }

  function onPointerUp(e: PointerEvent) {
    // 长按未到期就松手：取消待拖拽，让 click 正常跳转
    if (!drag && pendingNode) {
      console.log('[Canvas] pointerup before drag start, cancel press')
      clearPress()
      return
    }
    const d = drag
    console.log('[Canvas] pointerup', e.pointerId, e.clientX, e.clientY, 'drag=', d?.kind, d?.nodeId)
    if (!d) return
    drag = null
    if (d.kind === 'pan') return
    if (d.kind === 'node' && d.nodeId) {
      dragOverrides = new Map(dragOverrides)
      dragOverrides.delete(d.nodeId)
      if (isInside(trayEl, e.clientX, e.clientY)) {
        console.log('[Canvas] unplace node', d.nodeId, '(dropped on tray)')
        lastDragMoved = true
        void onPersistUnplace?.(d.nodeId)
        return
      }
      console.log('[Canvas] persistMove node', d.nodeId, d.preview)
      if (d.preview) void onPersistMove?.(d.nodeId, d.preview.x, d.preview.y)
    } else if (d.kind === 'tray' && d.nodeId) {
      if (isInside(trayEl, e.clientX, e.clientY)) {
        console.log('[Canvas] tray drop cancelled (still on tray)')
        return
      }
      console.log('[Canvas] persistPlace tray node', d.nodeId, d.preview)
      if (d.preview) void onPersistPlace?.(d.nodeId, d.preview.x, d.preview.y)
    }
  }

  function nodeClick(e: MouseEvent, node: CanvasNode) {
    e.stopPropagation()
    // 拖动结束后浏览器会补发 click，此时不应跳转
    if (lastDragMoved) {
      console.log('[Canvas] click suppressed after drag', node.id)
      lastDragMoved = false
      return
    }
    console.log('[Canvas] node click -> open', node.id)
    onNodeClick?.(node.id)
  }

  onDestroy(() => {
    clearPress()
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="canvas-root"
  bind:this={rootEl}
  onwheel={onWheel}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  oncontextmenu={(e) => e.preventDefault()}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="canvas-viewport"
    style={`transform: translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.zoom})`}
    onpointerdown={startPan}
  >
    <div class="canvas-grid"></div>

    {#each placedNodes as node (node.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="canvas-node"
        style={nodeStyle(node)}
        style:--node-color={node.color ?? 'var(--accent-color)'}
        onpointerdown={(e) => onNodePointerDown(e, node)}
        onclick={(e) => nodeClick(e, node)}
      >
        <div class="canvas-node-top">
          <span class="canvas-node-title">{node.title}</span>
          {#if node.countText}
            <span class="canvas-node-count">{node.countText}</span>
          {/if}
        </div>
        {#if node.images && node.images.length > 0}
          <div class="canvas-node-imgs">
            {#each node.images as img (img.url)}
              <CardSimpleImage url={img.url} name={img.name} className="canvas-node-thumb" />
            {/each}
          </div>
        {/if}
        {#if node.subtitle}
          <div class="canvas-node-sub">{node.subtitle}</div>
        {/if}
      </div>
    {/each}

    {#if drag}
      {@const d = drag}
      {#if d.kind === 'tray' && d.preview}
        {@const previewNode = nodes.find((n) => n.id === d.nodeId)}
        {#if previewNode}
          <div
            class="canvas-node canvas-node-ghost"
            style={`left: ${d.preview.x}px; top: ${d.preview.y}px;`}
            style:--node-color={previewNode.color ?? 'var(--accent-color)'}
          >
            <div class="canvas-node-top">
              <span class="canvas-node-title">{previewNode.title}</span>
            </div>
            {#if previewNode.images && previewNode.images.length > 0}
              <div class="canvas-node-imgs">
                {#each previewNode.images as img (img.url)}
                  <CardSimpleImage url={img.url} name={img.name} className="canvas-node-thumb" />
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    {/if}
  </div>

  {#if trayNodes.length > 0}
    <div class="tray" bind:this={trayEl}>
      <span class="tray-title">{$t('locker.unplacedTray')}</span>
      <div class="tray-list">
        {#each trayNodes as node (node.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="tray-node"
            style:--node-color={node.color ?? 'var(--accent-color)'}
            onpointerdown={(e) => startTrayDrag(e, node)}
          >
            <span class="tray-node-name">{node.title}</span>
            {#if node.countText}
              <span class="tray-node-count">{node.countText}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .canvas-root {
    position: relative;
    flex: 1;
    min-height: 320px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-primary);
    touch-action: none;
    user-select: none;
  }

  .canvas-viewport {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }

  .canvas-grid {
    position: absolute;
    left: 0;
    top: 0;
    width: 2000px;
    height: 2000px;
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, var(--border-color) 60%, transparent) 1px,
      transparent 1px
    );
    background-size: 24px 24px;
  }

  .canvas-node {
    position: absolute;
    width: 190px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-top: 4px solid var(--node-color, var(--accent-color));
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    cursor: grab;
    transition: box-shadow 0.15s ease;
  }

  .canvas-node:hover {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
    border-color: var(--node-color, var(--accent-color));
  }

  .canvas-node-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .canvas-node-title {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canvas-node-count {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    color: var(--node-color, var(--accent-color));
  }

  .canvas-node-imgs {
    display: flex;
    gap: 4px;
    min-height: 62px;
  }

  :global(.canvas-node-thumb) {
    width: 44px;
    height: 62px;
    border-radius: 4px;
    object-fit: cover;
    border: 1px solid var(--border-color);
    pointer-events: none;
  }

  .canvas-node-sub {
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canvas-node-ghost {
    opacity: 0.75;
    cursor: grabbing;
    pointer-events: none;
    border-style: dashed;
  }

  .tray {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    z-index: 5;
  }

  .tray-title {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .tray-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 2px 0 4px;
  }

  .tray-node {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    border-left: 4px solid var(--node-color, var(--accent-color));
    background: var(--bg-primary);
    cursor: grab;
  }

  .tray-node-name {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-primary);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tray-node-count {
    font-size: 10px;
    font-weight: 700;
    color: var(--node-color, var(--accent-color));
  }
</style>
