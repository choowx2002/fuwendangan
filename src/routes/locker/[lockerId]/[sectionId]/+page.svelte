<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import type { Locker, LockerSection, LockerCard } from '$lib/db'
  import { getLocker, getSection, getSectionCards, deleteSection, printCacheName } from '$lib/db'
  import { Pencil, Trash2, LayoutGrid, Table } from '@lucide/svelte'
  import { ask } from '@tauri-apps/plugin-dialog'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { resolveLockerIcon } from '$lib/components/locker/locker-icons'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  const lockerId = page.params.lockerId ?? ''
  const sectionId = page.params.sectionId ?? ''
  const PREFS_KEY = `locker:section-view:${sectionId}`

  let locker = $state<Locker | null>(null)
  let section = $state<LockerSection | null>(null)
  let cards = $state<LockerCard[]>([])
  let loading = $state(true)
  let view = $state<'grid' | 'table'>('grid')

  const drawerTotal = $derived(cards.reduce((a, c) => a + c.quantity, 0))

  function loadViewPref() {
    try {
      const raw = localStorage.getItem(PREFS_KEY)
      if (raw === 'grid' || raw === 'table') view = raw
    } catch {
      // 忽略损坏的偏好
    }
  }

  function saveViewPref() {
    try {
      localStorage.setItem(PREFS_KEY, view)
    } catch {
      // 存储不可用时忽略
    }
  }

  async function load() {
    loading = true
    try {
      const [l, s, cs] = await Promise.all([
        getLocker(lockerId),
        getSection(sectionId),
        getSectionCards(sectionId),
      ])
      locker = l
      section = s
      cards = cs
    } finally {
      loading = false
    }
  }

  async function removeDrawer() {
    if (!section) return
    const ok = await ask(
      get(t)('locker.deleteSectionConfirm', { values: { name: section.name ?? '' } }),
      {
        title: get(t)('locker.delete'),
        kind: 'warning',
        okLabel: get(t)('locker.delete'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!ok) return
    await deleteSection(section.id)
    await goto(`/locker/${lockerId}`)
  }

  onMount(() => {
    loadViewPref()
    void load()
  })

  $effect(() => {
    saveViewPref()
  })

  $effect(() => {
    setTopbar({
      title: section?.name ?? $t('locker.title'),
      onBack: () => goto(`/locker/${lockerId}`),
      actions: [
        {
          key: 'edit',
          label: $t('locker.editSection'),
          icon: Pencil,
          title: $t('locker.editSection'),
          onClick: () => void goto(`/locker/${lockerId}/${sectionId}/edit`),
        },
        {
          key: 'delete',
          label: $t('locker.delete'),
          icon: Trash2,
          title: $t('locker.delete'),
          onClick: () => void removeDrawer(),
        },
      ],
    })
  })
</script>

<div class="page-wrapper">
  {#if loading && !section}
    <div class="tip">{$t('common.loading')}</div>
  {:else if !section}
    <div class="tip">{$t('common.notFound')}</div>
  {:else}
    <div class="drawer-panel" style:--drawer-color={section.color ?? 'var(--accent-color)'}>
      <div class="drawer-head">
        <span class="drawer-dot"></span>
        {#if section.icon}
          <img class="drawer-icon" src={resolveLockerIcon(section.icon)} alt="" />
        {/if}
        <span class="drawer-title">{section.name ?? $t('locker.newSection')}</span>
        {#if section.description}
          <span class="drawer-desc">{section.description}</span>
        {/if}
        <span class="drawer-count">{$t('locker.cards', { values: { count: drawerTotal } })}</span>
        {#if section.tags && section.tags.length > 0}
          <div class="drawer-tags">
            {#each section.tags as tag (tag)}
              <span class="drawer-tag">{tag}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="toolbar">
      <span class="toolbar-count">{$t('locker.cards', { values: { count: drawerTotal } })}</span>
      <div class="view-toggle" role="group" aria-label={$t('locker.viewToggle')}>
        <button
          class="view-btn"
          class:active={view === 'grid'}
          title={$t('locker.gridView')}
          onclick={() => (view = 'grid')}
        >
          <LayoutGrid size={15} />
        </button>
        <button
          class="view-btn"
          class:active={view === 'table'}
          title={$t('locker.tableView')}
          onclick={() => (view = 'table')}
        >
          <Table size={15} />
        </button>
      </div>
    </div>

    {#if cards.length === 0}
      <div class="empty">{$t('locker.noCardsInSection')}</div>
    {:else if view === 'grid'}
      <div class="card-grid">
        {#each cards as card (card.id)}
          <div class="tile">
            <div class="tile-img">
              {#if card.print}
                <CardSimpleImage
                  url={card.print.img_cdn ?? card.print.tts_cdn ?? ''}
                  name={printCacheName(card.print)}
                  className="tile-img-src"
                />
              {:else}
                <span class="tile-no">{card.card_no}</span>
              {/if}
              <span class="tile-qty">×{card.quantity}</span>
            </div>
            <div class="tile-meta">
              <span class="tile-no-text">
                {card.card_no}{card.card_no_extend ? ` · ${card.card_no_extend}` : ''}
              </span>
              <span class="tile-name">{card.card_name ?? ''}</span>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="card-table">
        {#each cards as card (card.id)}
          <div class="t-row">
            <div class="t-thumb">
              {#if card.print}
                <CardSimpleImage
                  url={card.print.img_cdn ?? card.print.tts_cdn ?? ''}
                  name={printCacheName(card.print)}
                  className="t-thumb-src"
                />
              {:else}
                <span class="t-thumb-no">{card.card_no}</span>
              {/if}
            </div>
            <div class="t-info">
              <span class="t-name">{card.card_name ?? card.card_no}</span>
              <span class="t-no">
                {card.card_no}{card.card_no_extend ? ` · ${card.card_no_extend}` : ''}{card.language
                  ? ` · ${card.language}`
                  : ''}
              </span>
            </div>
            {#if card.ownedTotal > 0}
              <span class="t-owned">{$t('locker.ownedBadge', { values: { count: card.ownedTotal } })}</span>
            {/if}
            <span class="t-qty">×{card.quantity}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .page-wrapper {
    max-width: 1000px;
    margin: 0 auto;
    padding: calc(16px + env(safe-area-inset-top)) 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }

  .tip {
    padding: 40px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .drawer-panel {
    position: relative;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 12px 16px 12px 20px;
  }

  .drawer-panel::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--drawer-color, var(--accent-color));
  }

  .drawer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .drawer-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--drawer-color, var(--accent-color));
    flex-shrink: 0;
  }

  .drawer-icon {
    width: 20px;
    height: 20px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .drawer-title {
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--text-primary);
  }

  .drawer-desc {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .drawer-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    padding: 1px 8px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
  }

  .drawer-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
  }

  .drawer-tag {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toolbar-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .view-toggle {
    display: inline-flex;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    margin-left: auto;
  }

  .view-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .view-btn + .view-btn {
    border-left: 1px solid var(--border-color);
  }

  .view-btn:hover {
    color: var(--accent-color);
  }

  .view-btn.active {
    background: var(--accent-color);
    color: #fff;
  }

  .empty {
    padding: 40px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 14px;
    padding: 4px 2px 24px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
  }

  .tile-img {
    position: relative;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  :global(.tile-img-src) {
    display: block;
    width: 100%;
    object-fit: cover;
  }

  .tile-no {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 104 / 148;
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .tile-qty {
    position: absolute;
    bottom: 0;
    right: 0;
    z-index: 2;
    min-width: 36px;
    height: 28px;
    padding: 8px 4px 8px 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-md);
    font-weight: 700;
    color: #ffffff;
    background: var(--accent-color);
    border-top-left-radius: 9999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }

  .tile-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-width: 0;
    max-width: 100%;
  }

  .tile-no-text {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .tile-name {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .card-table {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .t-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
  }

  .t-thumb {
    flex-shrink: 0;
    width: 44px;
    height: 62px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-hover);
  }

  :global(.t-thumb-src) {
    display: block;
    width: 44px;
    height: 62px;
    object-fit: cover;
  }

  .t-thumb-no {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 62px;
    font-size: 9px;
    color: var(--text-secondary);
  }

  .t-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .t-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .t-no {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .t-owned {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--accent-color);
    font-weight: 600;
  }

  .t-qty {
    flex-shrink: 0;
    min-width: 34px;
    text-align: right;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--accent-color);
  }

  @media (max-width: 600.99px) {
    .page-wrapper {
      padding: 12px 16px 24px;
    }

    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }
  }
</style>
