<script lang="ts" module>
  /** 单条目标箭头（ReplayViewer 从 state.targetArrowsByPlayer 展平得到） */
  export interface ReplayArrowSpec {
    ownerId: string
    sourceCardId: string
    targetCardId: string
    sourceAnchor: string
    targetAnchor: string
  }
</script>

<script lang="ts">
  interface Props {
    arrows: ReplayArrowSpec[]
    /** 回放帧下标：变化即重测布局（卡牌随帧移动） */
    frame: number
    /** 高亮卡 id（阅读器 hover/固定）：关联箭头高亮、其余压暗 */
    highlightCardId?: string | null
    /** 近端玩家 id：其箭头全亮，对方箭头降透明度区分归属 */
    selfOwnerId?: string | null
  }
  let { arrows, frame, highlightCardId = null, selfOwnerId = null }: Props = $props()

  interface Box {
    x: number
    y: number
    w: number
    h: number
  }

  let svgEl: SVGSVGElement | null = null
  let rafId = 0
  let positions = $state(new Map<string, Box>())
  // 容器像素坐标系：viewBox 跟随棋盘实际尺寸
  let viewBox = $state('0 0 1 1')

  // 扫描棋盘内所有 [data-card-id]，换算成棋盘容器像素坐标（与 viewBox 一致）
  function measure() {
    const svg = svgEl
    if (!svg) return
    const board = svg.closest('.board')
    if (!board) return
    const w = svg.clientWidth
    const h = svg.clientHeight
    if (w <= 0 || h <= 0) return
    viewBox = `0 0 ${w} ${h}`
    const br = board.getBoundingClientRect()
    const next = new Map<string, Box>()
    for (const el of board.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const id = el.dataset.cardId
      if (!id || next.has(id)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      next.set(id, {
        x: r.left - br.left,
        y: r.top - br.top,
        w: r.width,
        h: r.height,
      })
    }
    positions = next
  }

  // 帧内容或箭头集合变化后，等 DOM 提交完再测（rAF 兜底一帧布局）
  $effect(() => {
    void arrows
    void frame
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(rafId)
  })

  // 中心连线与矩形边界求交，让线段止于卡边并留出箭头余量
  function edgePoint(box: Box, toward: Box): { x: number; y: number } {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const dx = toward.x + toward.w / 2 - cx
    const dy = toward.y + toward.h / 2 - cy
    const pad = 3
    const hw = box.w / 2 + pad
    const hh = box.h / 2 + pad
    const sx = dx === 0 ? Infinity : hw / Math.abs(dx)
    const sy = dy === 0 ? Infinity : hh / Math.abs(dy)
    const t = Math.min(sx, sy)
    return { x: cx + dx * t, y: cy + dy * t }
  }

  interface DrawnPath {
    key: string
    d: string
    kind: 'attack' | 'skill' | 'equip'
    own: boolean
    hl: boolean
    dim: boolean
    marker: string | null
  }

  const paths = $derived.by(() => {
    const out: DrawnPath[] = []
    for (const a of arrows) {
      const s = positions.get(a.sourceCardId)
      const t = positions.get(a.targetCardId)
      if (!s || !t) continue
      const p1 = edgePoint(s, t)
      const p2 = edgePoint(t, s)
      // 样式分级：连锁来源=技能蓝虚线；指向战场/基地=攻击红实线；其余=装备绿实线无箭头
      const kind: DrawnPath['kind'] =
        a.sourceAnchor === 'chain'
          ? 'skill'
          : a.targetAnchor === 'board' || a.targetAnchor === 'base'
            ? 'attack'
            : 'equip'
      const hl =
        highlightCardId != null &&
        (a.sourceCardId === highlightCardId || a.targetCardId === highlightCardId)
      out.push({
        key: `${a.ownerId}:${a.sourceCardId}>${a.targetCardId}`,
        d: `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
        kind,
        own: selfOwnerId != null && a.ownerId !== selfOwnerId,
        hl,
        dim: highlightCardId != null && !hl,
        marker:
          kind === 'attack'
            ? 'url(#rao-head-red)'
            : kind === 'skill'
              ? 'url(#rao-head-blue)'
              : null,
      })
    }
    return out
  })
</script>

<svg bind:this={svgEl} class="arrow-overlay" {viewBox} aria-hidden="true">
  <defs>
    <marker
      id="rao-head-red"
      viewBox="0 0 10 10"
      refX="8.5"
      refY="5"
      markerWidth="4"
      markerHeight="4"
      orient="auto-start-reverse"
    >
      <path d="M0 0 L10 5 L0 10 Z" fill="var(--accent-color)" />
    </marker>
    <marker
      id="rao-head-blue"
      viewBox="0 0 10 10"
      refX="8.5"
      refY="5"
      markerWidth="4.4"
      markerHeight="4.4"
      orient="auto-start-reverse"
    >
      <path d="M0 0 L10 5 L0 10 Z" fill="var(--accent-color)" />
    </marker>
  </defs>
  {#each paths as p (p.key)}
    <path
      d={p.d}
      class="arrow {p.kind}"
      class:own={p.own}
      class:hl={p.hl}
      class:dim={p.dim}
      marker-end={p.marker ?? undefined}
    />
  {/each}
</svg>

<style>
  .arrow-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 20;
    pointer-events: none;
    overflow: visible;
  }
  .arrow {
    --aw: 3;
    fill: none;
    stroke-width: var(--aw);
    stroke-linecap: round;
    opacity: 1;
  }
  /* 攻击/战斗：accent 主色实线；技能/目标：accent 主色虚线；装备/附加：accent 主色实线无箭头 */
  .arrow.attack {
    --aw: 3;
    stroke: var(--accent-color);
    color: var(--accent-color);
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent-color) 75%, transparent));
  }
  .arrow.skill {
    --aw: 2;
    stroke: var(--accent-color);
    color: var(--accent-color);
    stroke-dasharray: 7 5;
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent-color) 75%, transparent));
  }
  .arrow.equip {
    --aw: 2.5;
    stroke: var(--accent-color);
    color: var(--accent-color);
  }
  /* 对方玩家的箭头降透明度区分归属 */
  .arrow.own {
    opacity: 0.7;
  }
  /* 高亮其他卡时无关箭头压暗 */
  .arrow.dim {
    opacity: 0.12;
  }
  /* hover/固定阅读器选中的关联箭头：加粗 + 光晕 */
  .arrow.hl {
    stroke-width: calc(var(--aw) + 1.5);
    opacity: 1;
    filter: drop-shadow(0 0 6px currentColor);
  }
</style>
