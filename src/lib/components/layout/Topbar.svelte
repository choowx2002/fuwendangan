<!-- src/lib/components/layout/Topbar.svelte -->
<script lang="ts">
  import { Menu, ChevronLeft, Ellipsis } from '@lucide/svelte'
  import { topbarState, type TopbarAction } from '../../stores/ui-store.svelte'
  import CachedImage from '../cards/CachedImage.svelte'
  import { t } from 'svelte-i18n'

  let { isSidebarOpen = $bindable() } = $props()

  let actionsEl = $state<HTMLDivElement | null>(null)
  let measurerEl = $state<HTMLDivElement | null>(null)
  let visibleRegActions = $state<TopbarAction[]>([])
  let visiblePrioActions = $state<TopbarAction[]>([])
  let overflowActions = $state<TopbarAction[]>([])
  let menuOpen = $state(false)

  const orderedActions = $derived(
    [...topbarState.actions].sort(
      (a, b) =>
        (a.priority === undefined ? -Infinity : -a.priority) -
        (b.priority === undefined ? -Infinity : -b.priority)
    )
  )

  function toggleSidebar() {
    isSidebarOpen = !isSidebarOpen
  }

  function variantClass(variant?: TopbarAction['variant']) {
    return `button-${variant ?? 'ghost'}`
  }

  function sameActions(a: TopbarAction[], b: TopbarAction[]): boolean {
    if (a.length !== b.length) return false
    return a.every(
      (x, i) =>
        x.key === b[i].key &&
        x.label === b[i].label &&
        x.icon === b[i].icon &&
        x.variant === b[i].variant &&
        x.disabled === b[i].disabled &&
        x.active === b[i].active &&
        x.title === b[i].title &&
        x.priority === b[i].priority &&
        x.onClick === b[i].onClick
    )
  }

  function applyLayout(reg: TopbarAction[], prio: TopbarAction[], over: TopbarAction[]) {
    // 幂等：内容未变则跳过，避免无意义的 DOM 增删喂养 ResizeObserver 环。
    // 注意不能只比 key：页面重新挂载后 setTopbar 会带上绑定新实例的 onClick，
    // 只比 key 会沿用旧实例的闭包，导致 topbar 按钮点不动（弹窗状态写到已销毁实例上）。
    if (!sameActions(visibleRegActions, reg)) visibleRegActions = reg
    if (!sameActions(visiblePrioActions, prio)) visiblePrioActions = prio
    if (!sameActions(overflowActions, over)) overflowActions = over
  }

  function updateLayout() {
    const container = actionsEl
    const measurer = measurerEl
    const actions = orderedActions
    if (!container || !measurer || actions.length === 0) {
      applyLayout(actions, [], [])
      return
    }

    const containerWidth = container.clientWidth
    const widths = Array.from(measurer.children as HTMLCollectionOf<HTMLElement>).map(
      (el) => el.getBoundingClientRect().width
    )
    const gap = 8
    const sum = (arr: number[]) => arr.reduce((s, w) => s + w, 0)

    const total = sum(widths) + gap * (widths.length - 1)
    if (total <= containerWidth) {
      applyLayout(
        actions.filter((a) => a.priority === undefined),
        actions.filter((a) => a.priority !== undefined),
        []
      )
      return
    }

    const prioStart = actions.findIndex((a) => a.priority !== undefined)
    const regCount = prioStart === -1 ? actions.length : prioStart
    const regWidths = widths.slice(0, regCount)
    const prioWidths = widths.slice(regCount)
    const ellipsisWidth = 40

    let prioKept = prioWidths.length
    while (
      prioKept > 1 &&
      ellipsisWidth + sum(prioWidths.slice(-prioKept)) + gap * prioKept > containerWidth
    ) {
      prioKept--
    }

    let regVisible = 0
    for (let r = 0; r <= regCount; r++) {
      const used =
        sum(regWidths.slice(0, r)) +
        ellipsisWidth +
        sum(prioWidths.slice(-prioKept)) +
        gap * (r + prioKept)
      if (used <= containerWidth) regVisible = r
    }

    const regular = actions.slice(0, regVisible)
    const priority = actions.slice(actions.length - prioKept)
    applyLayout(
      regular,
      priority,
      actions.slice(regVisible, regCount).concat(actions.slice(regCount, actions.length - prioKept))
    )
  }

  let layoutRaf = 0

  $effect(() => {
    orderedActions
    const container = actionsEl
    if (!container) return
    updateLayout()
    const ro = new ResizeObserver(() => {
      // 延迟到下一帧执行，避免回调内同步改 DOM 再次触发观测 → ResizeObserver loop
      cancelAnimationFrame(layoutRaf)
      layoutRaf = requestAnimationFrame(() => updateLayout())
    })
    ro.observe(container)
    return () => {
      cancelAnimationFrame(layoutRaf)
      ro.disconnect()
    }
  })
</script>

<header class="topbar" class:hidden={topbarState.hidden}>
  <div class="left">
    <button class="icon-btn menu-btn" onclick={toggleSidebar} aria-label={$t('common.toggleMenu')}>
      <Menu size={20} />
    </button>
    {#if topbarState.onBack}
      <button
        class="icon-btn"
        onclick={() => topbarState.onBack?.()}
        aria-label={$t('common.back')}
      >
        <ChevronLeft size={20} />
      </button>
    {/if}
    <div class="title-wrap">
      {#if topbarState.image}
        <CachedImage
          src={topbarState.image}
          name="topbar-series-cover"
          width="30px"
          height="30px"
          borderRadius="6px"
          fit="cover"
          isLandscape={false}
        />
      {/if}
      <span class="title">{topbarState.title || 'Rune Archive'}</span>
      {#each topbarState.badges as badge (badge.key)}
        <span class="topbar-badge">{badge.text}</span>
      {/each}
      {#if topbarState.description}
        <span class="desc">{topbarState.description}</span>
      {/if}
    </div>
  </div>

  <div class="right" bind:this={actionsEl}>
    {#each visibleRegActions as action (action.key)}
      <button
        class="action-btn button button-sm {variantClass(action.variant)}"
        class:active={action.active}
        disabled={action.disabled}
        title={action.title ?? action.label}
        onclick={action.onClick}
      >
        {#if action.icon}
          {@const Icon = action.icon}
          <Icon size={16} />
        {/if}
        {#if action.label}<span class="action-label">{action.label}</span>{/if}
      </button>
    {/each}

    {#if overflowActions.length > 0}
      <button
        class="icon-btn"
        class:active={menuOpen}
        aria-label={$t('common.moreActions')}
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Ellipsis size={18} />
      </button>
    {/if}

    {#each visiblePrioActions as action (action.key)}
      <button
        class="action-btn button button-sm {variantClass(action.variant)}"
        class:active={action.active}
        disabled={action.disabled}
        title={action.title ?? action.label}
        onclick={action.onClick}
      >
        {#if action.icon}
          {@const Icon = action.icon}
          <Icon size={16} />
        {/if}
        {#if action.label}<span class="action-label">{action.label}</span>{/if}
      </button>
    {/each}
  </div>

  {#if menuOpen && overflowActions.length > 0}
    <div class="menu-backdrop" onclick={() => (menuOpen = false)} role="presentation"></div>
    <div class="more-menu" role="menu">
      {#each overflowActions as action (action.key)}
        <button
          class="more-menu-item"
          role="menuitem"
          disabled={action.disabled}
          onclick={() => {
            menuOpen = false
            action.onClick()
          }}
        >
          {#if action.icon}
            {@const Icon = action.icon}
            <Icon size={16} />
          {/if}
          {#if action.label}<span>{action.label}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  <div class="measurer" bind:this={measurerEl} aria-hidden="true">
    {#each orderedActions as action (action.key)}
      <button class="action-btn button button-sm {variantClass(action.variant)}" tabindex="-1">
        {#if action.icon}
          {@const Icon = action.icon}
          <Icon size={16} />
        {/if}
        {#if action.label}<span class="action-label">{action.label}</span>{/if}
      </button>
    {/each}
  </div>
</header>

<style>
  .topbar {
    height: calc(var(--topbar-height) + env(safe-area-inset-top));
    min-height: calc(var(--topbar-height) + env(safe-area-inset-top));
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px;
    background: var(--bg-primary);
    z-index: 30;
    padding-top: env(safe-area-inset-top);
    position: relative;
  }

  .topbar.hidden {
    display: none;
  }

  .left {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    /* flex-shrink: 0; */
    max-width: 55%;
    position: relative;
    flex: 1;
    justify-content: right;
  }

  .icon-btn {
    background: none;
    border: none;
    padding: 6px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s;
    flex-shrink: 0;
  }
  .icon-btn:hover,
  .icon-btn.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .menu-btn {
    display: none;
  }
  @media (max-width: 767.99px) {
    .menu-btn {
      display: flex;
    }
  }

  .title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
    /* max-width: 60%; */
  }

  .topbar-badge {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--secondary-accent-color);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 1px 8px;
    white-space: nowrap;
    line-height: 1.6;
  }

  .desc {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-btn {
    height: 32px;
    flex-shrink: 0;
  }

  .action-btn.active {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  }

  .action-btn .action-label {
    margin-left: 4px;
  }

  @media (max-width: 767.99px) {
    .action-btn .action-label {
      display: none;
    }
    .topbar-badge {
      display: none;
    }
    .desc {
      display: none;
    }
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 29;
  }

  .more-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 168px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    padding: 4px;
    display: flex;
    flex-direction: column-reverse;
    z-index: 31;
  }

  .more-menu-item {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }
  .more-menu-item:hover {
    background: var(--bg-hover);
  }
  .more-menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .measurer {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 8px;
    inset: 0;
  }
</style>
