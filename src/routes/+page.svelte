<script lang="ts">
  import { getDeckList, getMatchStatsForDecks } from '$lib/db'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { getRelativeTime } from '$lib/utils/time-helper'
  import { isDeckPinned } from '$lib/stores/pinned-decks'
  import { homeMoreOrder, playerName, settingsStoreReady } from '$lib/stores/settings'
  import {
    Swords,
    Dice6,
    Pin,
    ChevronRight,
    UserRound,
    Boxes,
    Gamepad2,
    Settings,
    Heart,
    ArrowLeftRight,
    RefreshCw,
    BookOpen,
    ClipboardList,
    MoreHorizontal,
  } from '@lucide/svelte'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { t } from 'svelte-i18n'
  import { draggable, droppable, type DragDropState } from '@thisux/sveltednd'
  import { flip } from 'svelte/animate'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'

  interface HomeDeck {
    id: string
    name: string
    format: string | null
    wins: number
    losses: number
    draws: number
    updated: string
    pinned: boolean
  }

  interface MoreEntry {
    id: string
    icon: typeof Swords
    labelKey: string
    href: string
    color: string
  }

  const MORE_ENTRIES: MoreEntry[] = [
    {
      id: 'gameCounter',
      icon: Swords,
      labelKey: 'home.toolsGameCounter',
      href: '/tools/gameCounter',
      color: '#e03e3e',
    },
    { id: 'dice', icon: Dice6, labelKey: 'home.toolsDice', href: '/tools/dice', color: '#d9730d' },
    { id: 'locker', icon: Boxes, labelKey: 'nav.locker', href: '/locker', color: '#d97706' },
    { id: 'rules', icon: BookOpen, labelKey: 'nav.rules', href: '/rules', color: '#6366f1' },
    {
      id: 'wishlist',
      icon: Heart,
      labelKey: 'wishlist.title',
      href: '/collection/wishlist',
      color: '#ec4899',
    },
    {
      id: 'loans',
      icon: ArrowLeftRight,
      labelKey: 'loans.title',
      href: '/collection/loans',
      color: '#0ea5e9',
    },
    {
      id: 'simulator',
      icon: Gamepad2,
      labelKey: 'nav.simulator',
      href: '/simulator',
      color: '#7c3aed',
    },
    {
      id: 'purchase',
      icon: ClipboardList,
      labelKey: 'purchase.title',
      href: '/collection/purchase-lists',
      color: '#22c55e',
    },
    { id: 'sync', icon: RefreshCw, labelKey: 'nav.sync', href: '/sync', color: '#0891b2' },
    {
      id: 'settings',
      icon: Settings,
      labelKey: 'nav.settings',
      href: '/settings',
      color: '#64748b',
    },
  ]

  const DEFAULT_MORE_ORDER = MORE_ENTRIES.map((e) => e.id)

  let recentDecks = $state<HomeDeck[]>([])
  let homeName = $state('')
  let settingsReady = $state(false)

  // --- 更多功能：可见数量与排序 ---
  let moreGridEl = $state<HTMLElement | null>(null)
  let gridCols = $state(3)
  let showMoreModal = $state(false)
  let sortMode = $state(false)
  let sortOrder = $state<string[]>([])
  let dndZoneEl = $state<HTMLElement | null>(null)

  function computeGridCols() {
    if (window.matchMedia('(max-width: 767.99px)').matches) {
      gridCols = 3
      return
    }
    if (!moreGridEl) return
    const gap = 10
    const min = 140
    gridCols = Math.max(1, Math.floor((moreGridEl.clientWidth + gap) / (min + gap)))
  }

  $effect(() => {
    const el = moreGridEl
    if (!el) return
    computeGridCols()
    const ro = new ResizeObserver(() => computeGridCols())
    ro.observe(el)
    return () => ro.disconnect()
  })

  const orderedEntries = $derived.by(() => {
    const order = $homeMoreOrder.length > 0 ? $homeMoreOrder : DEFAULT_MORE_ORDER
    const byId = new Map(MORE_ENTRIES.map((e) => [e.id, e]))
    const sorted = order.map((id) => byId.get(id)).filter((e): e is MoreEntry => !!e)
    for (const e of MORE_ENTRIES) {
      if (!sorted.includes(e)) sorted.push(e)
    }
    return sorted
  })

  const maxVisible = $derived(gridCols * 2)
  const hiddenEntries = $derived(
    orderedEntries.length > maxVisible ? orderedEntries.slice(maxVisible - 1) : []
  )
  const visibleEntries = $derived(
    orderedEntries.length > maxVisible ? orderedEntries.slice(0, maxVisible - 1) : orderedEntries
  )

  function openMoreModal() {
    sortMode = false
    sortOrder = [...orderedEntries.map((e) => e.id)]
    showMoreModal = true
  }

  function enterSortMode() {
    sortMode = true
    sortOrder = [...orderedEntries.map((e) => e.id)]
  }

  function handleDrop(state: DragDropState<string>) {
    const { draggedItem, targetElement, dropPosition } = state
    const targetEl =
      targetElement instanceof Element ? targetElement.closest<HTMLElement>('.sort-row') : null
    const rest = sortOrder.filter((id) => id !== draggedItem)
    let next: string[]
    if (targetEl && dndZoneEl) {
      const rows = Array.from(dndZoneEl.children).filter((el) => el.classList.contains('sort-row'))
      const idx = rows.indexOf(targetEl)
      const at = dropPosition === 'after' ? idx + 1 : idx
      next = [...rest.slice(0, at), draggedItem, ...rest.slice(at)]
    } else {
      next = [...rest, draggedItem]
    }
    sortOrder = next
  }

  function confirmSort() {
    $homeMoreOrder = sortOrder
    sortMode = false
    showMoreModal = false
  }

  function cancelSort() {
    sortMode = false
    showMoreModal = false
  }

  const orderedDecks = $derived(
    [...recentDecks].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return 0
    })
  )

  function todayText() {
    return new Date().toLocaleDateString('zh-CN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  onMount(async () => {
    try {
      await settingsStoreReady
      settingsReady = true
      const { decks } = await getDeckList({ limit: 50 })
      const stats = await getMatchStatsForDecks(decks.map((d) => d.id))
      recentDecks = decks.slice(0, 5).map((d) => {
        const s = stats.get(d.id)
        return {
          id: d.id,
          name: d.name,
          format: d.format,
          wins: s?.match_wins ?? 0,
          losses: s?.match_losses ?? 0,
          draws: s?.match_draws ?? 0,
          updated: d.updated_at ? getRelativeTime(d.updated_at) : get(t)('common.unknown'),
          pinned: isDeckPinned(d.id),
        }
      })
    } catch (error) {}
  })

  $effect(() => {
    setTopbar({
      title: $t('home.topbarTitle'),
      description: $t('home.topbarDesc', {
        values: { name: $playerName.trim() || $t('common.unknown') },
      }),
    })
  })
</script>

<div class="page-container">
  <!-- Hero 大横幅 -->
  <section class="hero">
    <div class="hero-content">
      <span class="hero-date">{todayText()}</span>
      <h1 class="hero-title">
        {#if $playerName.trim()}
          {$t('home.welcomeBackWithName', { values: { name: $playerName.trim() } })}
        {:else}
          {$t('home.welcomeBack')}
        {/if}
      </h1>
      <p class="hero-sub">{$t('home.whatToPlay')}</p>
      <div class="hero-actions">
        <button class="hero-btn primary" onclick={() => goto('/decks/builder')}>
          {$t('home.newDeck')}
        </button>
        <button class="hero-btn" onclick={() => goto('/cards')}>
          {$t('home.browseCards')}
        </button>
      </div>
    </div>
  </section>

  {#if settingsReady && !$playerName.trim()}
    <section class="setup-card">
      <div class="setup-card-info">
        <span class="setup-card-icon"><UserRound size={16} /></span>
        <div class="setup-card-text">
          <span class="setup-card-title">{$t('home.setupPlayerName')}</span>
          <span class="setup-card-desc">{$t('home.setupPlayerNameDesc')}</span>
        </div>
      </div>
      <div class="setup-card-form">
        <input
          class="setup-input"
          type="text"
          maxlength="20"
          placeholder={$t('home.nicknamePlaceholder')}
          bind:value={homeName}
        />
        <button
          class="button button-primary"
          disabled={!homeName.trim()}
          onclick={() => {
            if (!homeName.trim()) return
            $playerName = homeName.trim()
            setTopbar({
              title: $t('home.topbarTitle'),
              description: $t('home.topbarDesc', {
                values: { name: $playerName },
              }),
            })
          }}
        >
          {$t('common.save')}
        </button>
      </div>
    </section>
  {/if}

  <!-- 更多功能（无标题，原对战工具位置） -->
  <section class="section">
    <div class="more-grid" bind:this={moreGridEl}>
      {#each visibleEntries as entry (entry.id)}
        <a href={entry.href} class="more-tile">
          <span class="more-tile-icon" style="background: {entry.color}15; color: {entry.color}">
            <entry.icon size={18} />
          </span>
          <span class="more-tile-label">{$t(entry.labelKey)}</span>
        </a>
      {/each}
      {#if hiddenEntries.length > 0}
        <button class="more-tile more-more" onclick={openMoreModal}>
          <span
            class="more-tile-icon"
            style="background: var(--bg-hover); color: var(--text-secondary)"
          >
            <MoreHorizontal size={18} />
          </span>
          <span class="more-tile-label">{$t('home.moreFeatures')}</span>
        </button>
      {/if}
    </div>
  </section>

  <!-- 最近使用的卡组 -->
  <section class="section">
    <div class="section-header">
      <h2 class="section-title">{$t('home.recentDecks')}</h2>
      <a href="/decks" class="see-all">{$t('home.manageDecks')} <ChevronRight size={14} /></a>
    </div>
    <div class="deck-list">
      {#each orderedDecks as deck}
        <!-- svelte-ignore a11y_invalid_attribute -->
        <a href="/decks/{deck.id}" class="deck-item" class:pinned={deck.pinned}>
          <div class="deck-main">
            {#if deck.pinned}
              <span class="pin-mark"><Pin size={13} /></span>
            {/if}
            <span class="deck-name">{deck.name}</span>
            {#if deck.format}
              <span class="deck-format">{deck.format}</span>
            {/if}
          </div>
          <div class="deck-stats">
            <span class="stat win">{$t('home.wins', { values: { count: deck.wins } })}</span>
            <span class="stat loss">{$t('home.losses', { values: { count: deck.losses } })}</span>
            {#if deck.draws > 0}
              <span class="stat draw">{$t('home.draws', { values: { count: deck.draws } })}</span>
            {/if}
            <span class="stat time">{deck.updated}</span>
          </div>
        </a>
      {:else}
        <p class="deck-empty">{$t('home.noDecks')}</p>
      {/each}
    </div>
  </section>
</div>

<CommonModal
  open={showMoreModal}
  onclose={cancelSort}
  title={sortMode ? $t('home.moreCustomize') : $t('home.moreTitle')}
  subtitle={sortMode ? $t('home.moreSortHint') : undefined}
>
  {#if sortMode}
    <div
      class="dnd-zone"
      bind:this={dndZoneEl}
      use:droppable={{
        container: 'home-more-sort',
        callbacks: { onDrop: handleDrop },
      }}
    >
      {#each sortOrder as id, i (id)}
        {@const entry = MORE_ENTRIES.find((e) => e.id === id)!}
        <div
          class="sort-row"
          use:draggable={{ container: 'home-more-sort', dragData: id }}
          use:droppable={{
            container: 'home-more-sort',
            callbacks: { onDrop: handleDrop },
          }}
          animate:flip={{ duration: 200 }}
        >
          <div class="drag-handle" title={$t('cards.dragSort')}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>
          <span class="order-num">{i + 1}</span>
          <span class="sort-label">
            <entry.icon size={16} />
            <span>{$t(entry.labelKey)}</span>
          </span>
        </div>
      {/each}
    </div>
    <div class="modal-actions">
      <button class="button button-ghost" onclick={cancelSort}>
        {$t('common.cancel')}
      </button>
      <button class="button button-primary" onclick={confirmSort}>
        {$t('common.confirm')}
      </button>
    </div>
  {:else}
    <div class="more-modal-grid">
      {#each hiddenEntries as entry (entry.id)}
        <a href={entry.href} class="more-tile" onclick={() => (showMoreModal = false)}>
          <span class="more-tile-icon" style="background: {entry.color}15; color: {entry.color}">
            <entry.icon size={18} />
          </span>
          <span class="more-tile-label">{$t(entry.labelKey)}</span>
        </a>
      {/each}
    </div>
    <div class="modal-actions">
      <button class="button button-secondary" onclick={enterSortMode}>
        <MoreHorizontal size={16} />
        {$t('home.moreCustomize')}
      </button>
    </div>
  {/if}
</CommonModal>

<style>
  .page-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
  }

  @media (max-width: 767.99px) {
    .page-container {
      padding: 24px 16px 80px;
    }
  }

  /* Hero 大横幅 */
  .hero {
    position: relative;
    overflow: hidden;
    margin-bottom: 36px;
    padding: 48px 40px;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, var(--accent-color), var(--secondary-accent-color));
    color: white;
  }

  .hero-content {
    position: relative;
    z-index: 1;
    max-width: 480px;
  }

  .hero-date {
    font-size: var(--text-sm);
    opacity: 0.85;
  }

  .hero-title {
    margin: 8px 0 4px;
    font-size: var(--text-3xl);
    font-weight: 700;
  }

  .hero-sub {
    margin: 0 0 20px;
    font-size: var(--text-md);
    opacity: 0.9;
  }

  .hero-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .hero-btn {
    padding: 9px 18px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: var(--radius-md);
    background: transparent;
    color: white;
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .hero-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  .hero-btn.primary {
    background: white;
    color: var(--accent-color);
    border-color: white;
  }
  .hero-btn.primary:hover {
    background: #f0f0f0;
  }

  @media (max-width: 767.99px) {
    .hero {
      padding: 32px 24px;
    }
  }

  /* 玩家用户名设置卡片（未填写时显示） */
  .setup-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 36px;
    padding: 14px 16px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
  }

  .setup-card-info {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .setup-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
    color: var(--accent-color);
  }

  .setup-card-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setup-card-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .setup-card-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .setup-card-form {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .setup-input {
    width: 180px;
    padding: 8px 12px;
    font-size: 14px;
    color: var(--text-primary);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .setup-input:focus {
    border-color: var(--accent-color);
  }

  @media (max-width: 479.99px) {
    .setup-card {
      align-items: stretch;
    }

    .setup-card-form {
      width: 100%;
    }

    .setup-input {
      flex: 1;
      width: auto;
    }
  }

  .section {
    margin-bottom: 36px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .section-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .see-all {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .see-all:hover {
    color: var(--text-primary);
  }

  /* 卡组列表 */
  .deck-list {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .deck-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    text-decoration: none;
    color: inherit;
    border-bottom: 1px solid var(--border-color);
    transition: background 0.1s;
  }
  .deck-item:last-child {
    border-bottom: none;
  }
  .deck-item:hover {
    background: var(--bg-secondary);
  }

  .deck-item.pinned {
    background: color-mix(in srgb, var(--secondary-accent-color) 6%, transparent);
  }
  .deck-item.pinned .deck-name {
    font-weight: 600;
  }

  .deck-empty {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .deck-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pin-mark {
    display: inline-flex;
    align-items: center;
    color: var(--secondary-accent-color);
  }

  .deck-name {
    font-size: var(--text-base);
    font-weight: 500;
  }
  .deck-format {
    font-size: var(--text-sm);
    padding: 2px 6px;
    background: var(--bg-hover);
    border-radius: 4px;
    color: var(--text-secondary);
  }

  .deck-stats {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: var(--text-sm);
  }
  .stat {
    color: var(--text-tertiary);
  }
  .stat.win {
    color: #0f7b6c;
    font-weight: 500;
  }
  .stat.loss {
    color: #e03e3e;
    font-weight: 500;
  }
  .stat.draw {
    color: var(--text-secondary);
    font-weight: 500;
  }

  @media (max-width: 767.99px) {
    .deck-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .deck-stats {
      width: 100%;
      justify-content: flex-start;
    }
  }

  /* 更多功能 - 入口格子 */
  .more-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }

  .more-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    text-decoration: none;
    color: var(--text-primary);
    transition:
      background 0.15s,
      transform 0.15s;
  }

  button.more-tile {
    cursor: pointer;
    font-family: inherit;
  }

  .more-more:hover {
    border-color: var(--accent-color);
  }

  .more-tile:hover {
    background: var(--bg-secondary);
    transform: translateY(-1px);
  }

  .more-tile-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .more-tile-label {
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
  }

  @media (max-width: 767.99px) {
    .more-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  /* --- 更多功能弹窗 --- */
  .more-modal-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
  }

  .dnd-zone {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 50px;
  }

  .sort-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    transition:
      box-shadow 0.2s,
      transform 0.2s,
      background 0.1s;
  }

  :global(.sort-row.dragging) {
    opacity: 0.5;
  }

  .drag-handle {
    cursor: grab;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    padding: 4px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .drag-handle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .drag-handle svg {
    width: 16px;
    height: 16px;
  }

  .order-num {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    min-width: 16px;
    text-align: center;
  }

  .sort-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-base);
    color: var(--text-primary);
  }
</style>
