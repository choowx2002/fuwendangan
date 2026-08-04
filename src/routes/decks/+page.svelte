<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import {
    deleteDeck,
    duplicateDeck,
    getDeckList,
    toggleFavorite,
    getMatchStatsForDecks,
    type DeckListResult,
  } from '$lib/db'
  import { getRelativeTime } from '$lib/utils/time-helper'
  import { DECK_FORMATS } from '$lib/decks/format'
  import { Plus, Search, Funnel, Copy, Trash2, Folder, HeartIcon } from '@lucide/svelte'
  import { ask, message } from '@tauri-apps/plugin-dialog'
  import { onMount } from 'svelte'

  let allDecks = $state<DeckListResult[]>([])
  let matchStatsMap = $state<Map<string, import('$lib/db/types').MatchSummary>>(new Map())

  let searchQuery = $state('')
  let selectedFormat = $state('全部')
  let showFavoritesOnly = $state(false)
  let activeTags = $state<string[]>([])
  let tagMatchMode = $state<'all' | 'any'>('all')
  let showTagSuggestions = $state(false)
  let activeSuggestionIndex = $state(-1)

  export const formats = ['全部', ...DECK_FORMATS]

  const allTags = $derived(
    [...new Set(allDecks.flatMap((d) => d.tags ?? []))].sort((a, b) => a.localeCompare(b))
  )

  const tagSuggestions = $derived.by(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.trim().toLowerCase()
    return allTags
      .filter((t) => t.toLowerCase().includes(q) && !activeTags.includes(t))
      .slice(0, 8)
  })

  const filteredDecks = $derived(
    allDecks.filter((deck) => {
      const q = searchQuery.trim().toLowerCase()
      const deckTags = deck.tags ?? []
      const matchesSearch =
        !q ||
        deck.name.toLowerCase().includes(q) ||
        deckTags.some((t) => t.toLowerCase().includes(q))
      const matchesFormat = selectedFormat === '全部' || deck.format === selectedFormat
      const matchesFavorite = !showFavoritesOnly || deck.is_favorite
      const matchesTags =
        activeTags.length === 0 ||
        (tagMatchMode === 'all'
          ? activeTags.every((t) => deckTags.includes(t))
          : activeTags.some((t) => deckTags.includes(t)))
      return matchesSearch && matchesFormat && matchesFavorite && matchesTags
    })
  )

  function addTag(tag: string) {
    if (!tag || activeTags.includes(tag)) return
    activeTags = [...activeTags, tag]
    searchQuery = ''
    showTagSuggestions = false
    activeSuggestionIndex = -1
  }

  function removeTag(tag: string) {
    activeTags = activeTags.filter((t) => t !== tag)
  }

  function handleTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      showTagSuggestions = false
      return
    }
    if (tagSuggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeSuggestionIndex = (activeSuggestionIndex + 1) % tagSuggestions.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeSuggestionIndex =
        activeSuggestionIndex <= 0 ? tagSuggestions.length - 1 : activeSuggestionIndex - 1
    } else if (event.key === 'Enter') {
      const idx = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0
      if (tagSuggestions[idx]) {
        event.preventDefault()
        addTag(tagSuggestions[idx])
      }
    }
  }

  async function toggleFavoriteAction(deckId: string) {
    await toggleFavorite(deckId)
    init()
  }

  async function deleteDeckAsk(name: string, deckId: string) {
    const confirm = await ask(`你确定要删除 ${name} 吗？`, {
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })

    if (confirm) {
      if (await deleteDeck(deckId)) {
        init()
      }
    }
  }

  async function duplicateDeckAsk(name: string, deckId: string) {
    const confirm = await ask(`你确定要复制 ${name} 吗？`, {
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })

    if (!confirm) return

    try {
      const newDeckId = await duplicateDeck(deckId)
      if (newDeckId) {
        message('复制成功！').then(init)
      }
    } catch (error) {
      console.error(error)
      message('复制失败')
    }
  }

  const init = async () => {
    const { decks } = await getDeckList()
    allDecks = decks
    matchStatsMap = await getMatchStatsForDecks(decks.map((d) => d.id))
  }

  onMount(() => {
    init()
  })

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) {
      cancel()
      goto('/')
    }
  })
</script>

<div class="decks-page">
  <header class="page-header">
    <div class="header-content">
      <p class="page-desc">管理你的所有卡组，共 {allDecks.length} 副</p>
    </div>
    <button class="button button-primary" onclick={() => goto('/decks/builder')}>
      <Plus size={18} />
      <span>新建卡组</span>
    </button>
  </header>

  <section class="filter-bar">
    <div
      class="search-box"
      onfocusout={(e) => {
        const next = e.relatedTarget as Node | null
        if (next && (e.currentTarget as HTMLElement).contains(next)) return
        showTagSuggestions = false
      }}
    >
      <div class="search-icon">
        <Search size={18} />
      </div>
      <input
        type="text"
        placeholder="搜索卡组名称或标签..."
        bind:value={searchQuery}
        class="search-input"
        onfocus={() => (showTagSuggestions = true)}
        oninput={() => {
          showTagSuggestions = true
          activeSuggestionIndex = -1
        }}
        onkeydown={handleTagKeydown}
      />
      {#if showTagSuggestions && tagSuggestions.length > 0}
        <div class="tag-suggest-popdown">
          {#each tagSuggestions as tag, i (tag)}
            <button
              type="button"
              class="suggestion-item"
              class:active={i === activeSuggestionIndex}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => addTag(tag)}
            >
              <span class="tag-text">{tag}</span>
              <span class="tag-hint">回车/点击添加为筛选条件</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="filter-controls">
      <div class="format-filter">
        <Funnel size={16} class="filter-icon" />
        <select bind:value={selectedFormat} class="format-select">
          {#each formats as format}
            <option value={format}>{format}</option>
          {/each}
        </select>
      </div>

      <button
        class="button button-ghost favorite-filter"
        class:active={showFavoritesOnly}
        onclick={() => (showFavoritesOnly = !showFavoritesOnly)}
      >
        <Folder size={16} />
        <span>收藏</span>
      </button>
    </div>
  </section>

  {#if activeTags.length > 0}
    <div class="tag-filter-bar">
      <div class="tag-match-toggle">
        <button
          class="tag-mode-btn"
          class:active={tagMatchMode === 'all'}
          onclick={() => (tagMatchMode = 'all')}
        >
          全部满足
        </button>
        <button
          class="tag-mode-btn"
          class:active={tagMatchMode === 'any'}
          onclick={() => (tagMatchMode = 'any')}
        >
          任一满足
        </button>
      </div>
      <div class="active-tags">
        {#each activeTags as tag (tag)}
          <span class="active-tag-chip">
            {tag}
            <button
              type="button"
              class="active-tag-remove"
              onclick={() => removeTag(tag)}
              aria-label="移除标签"
            >
              ×
            </button>
          </span>
        {/each}
      </div>
      <button class="clear-tags-btn" onclick={() => (activeTags = [])}>清除</button>
    </div>
  {/if}

  {#if filteredDecks.length === 0}
    <div class="empty-state">
      <Folder size={48} class="empty-icon" />
      <h3>没有找到匹配的卡组</h3>
      <p>试试调整筛选条件或创建新卡组</p>
    </div>
  {:else}
    <div class="decks-grid">
      {#each filteredDecks as deck (deck.id)}
        {@const s = matchStatsMap.get(deck.id)}
        <div
          class="deck-card"
          class:favorite={deck.is_favorite}
          role="presentation"
          onclick={() => goto(`/decks/${deck.id}`)}
        >
          <div class="deck-header">
            <div class="deck-avatar">
              <CardSimpleImage
                url={deck.legend_image}
                name={`${deck.legend_id}-${deck.legend_print_id || 'default'}`}
              />
            </div>
            <div class="deck-info">
              <h3 class="deck-name">{deck.name}</h3>
              <span class="deck-format-badge">{deck.format}</span>
            </div>
          </div>

          <div class="deck-stats-row">
            <div class="stat-item">
              <span class="stat-label">版本</span>
              <span class="stat-value">v{deck.latest_version_number?.toFixed(1)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">卡牌</span>
              <span class="stat-value">{deck.latest_version_card_count}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">战绩</span>
              <span class="stat-value record">
                {#if s && s.games > 0}
                  <span class="win">{s.wins}</span>
                  <span class="separator">-</span>
                  <span class="loss">{s.losses}</span>
                {:else}
                  <span class="muted">-</span>
                {/if}
              </span>
            </div>
            <div class="stat-item" title={new Date(deck.updated_at!).toLocaleString()}>
              <span class="stat-label">更新</span>
              <span class="stat-value time">{getRelativeTime(deck.updated_at!)}</span>
            </div>
          </div>

          {#if deck.tags && deck.tags.length > 0}
            <div class="deck-tag-row">
              {#each deck.tags.slice(0, 3) as tag (tag)}
                <span class="deck-tag-chip">{tag}</span>
              {/each}
              {#if deck.tags.length > 3}
                <span class="deck-tag-more">+{deck.tags.length - 3}</span>
              {/if}
            </div>
          {/if}

          <div class="deck-actions">
            <button
              class="button-icon action-btn"
              onclick={(e) => {
                e.stopPropagation()
                duplicateDeckAsk(deck.name, deck.id)
              }}
              title="复制卡组"
            >
              <Copy size={16} />
            </button>
            <button
              class="button-icon action-btn"
              onclick={(e) => {
                e.stopPropagation()
                toggleFavoriteAction(deck.id)
              }}
              title="收藏/取消收藏"
            >
              {#if deck.is_favorite}
                <HeartIcon fill="red" color={'red'} size={16} />
              {:else}
                <HeartIcon size={16} />
              {/if}
            </button>
            <button
              class="button-icon action-btn action-btn-danger"
              onclick={(e) => {
                e.stopPropagation()
                deleteDeckAsk(deck.name, deck.id)
              }}
              title="删除卡组"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .decks-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
  }

  @media (max-width: 767.99px) {
    .decks-page {
      padding: 24px 16px 80px;
    }
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 14px;
    gap: 16px;
  }

  .header-content {
    flex: 1;
  }

  .page-desc {
    font-size: var(--text-md);
    margin: 0;
  }

  .filter-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .search-box {
    position: relative;
    flex: 1;
    min-width: 200px;
    max-width: 400px;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-tertiary);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 10px 12px 10px 40px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    background: var(--bg-primary);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-color) 15%, transparent);
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .filter-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .format-filter {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
  }

  :global(.filter-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .format-select {
    border: none;
    background: transparent;
    font-size: var(--text-base);
    color: var(--text-primary);
    outline: none;
    cursor: pointer;
    min-width: 60px;
  }

  .favorite-filter.active {
    background: var(--text-primary);
    color: white;
    border-color: var(--text-primary);
  }

  .favorite-filter.active:hover {
    background: #2f2e29;
    color: white;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 24px;
    text-align: center;
  }

  :global(.empty-icon) {
    color: var(--text-tertiary);
    margin-bottom: 16px;
  }

  .empty-state h3 {
    font-size: var(--text-xl);
    font-weight: 600;
    margin: 0 0 8px 0;
    color: var(--text-primary);
  }

  .empty-state p {
    font-size: var(--text-base);
    color: var(--text-secondary);
    margin: 0;
  }

  .decks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  @media (max-width: 480.99px) {
    .decks-grid {
      grid-template-columns: 1fr;
    }
  }

  .deck-card {
    display: flex;
    flex-direction: column;
    padding: 20px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    transition: all 0.15s;
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  .deck-card:hover {
    border-color: #d3d1cb;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    transform: translateY(-2px);
  }

  .deck-card.favorite {
    border-color: var(--accent-color);
  }

  .deck-card.favorite::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: var(--accent-color);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  .deck-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 16px;
    gap: 12px;
  }

  .deck-info {
    flex: 1;
    min-width: 0;
  }

  .deck-name {
    font-size: var(--text-lg);
    font-weight: 600;
    margin: 0 0 4px 0;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-format-badge {
    display: inline-block;
    font-size: var(--text-sm);
    padding: 2px 8px;
    background: var(--bg-primary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }

  .deck-stats-row {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .stat-value {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .stat-value.record {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .stat-value .win {
    color: #0f7b6c;
  }

  .stat-value .loss {
    color: #e03e3e;
  }

  .stat-value .separator {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .stat-value .muted {
    color: var(--text-tertiary);
  }

  .stat-value.time {
    color: var(--text-secondary);
    font-weight: 400;
  }

  .deck-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .action-btn {
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    width: 36px;
    height: 36px;
  }

  .action-btn:hover {
    border-color: #d3d1cb;
  }

  .action-btn-danger:hover {
    background: #fee;
    color: #e03e3e;
    border-color: #fcc;
  }

  .deck-avatar {
    height: 48px;
    width: 48px;
    overflow: hidden;
    border-radius: 50%;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    flex-shrink: 0;
  }

  :global(.deck-avatar > img) {
    width: 100%;
    transform: scale(2);
    object-fit: cover;
    object-position: center 10px;
  }

  .tag-suggest-popdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    z-index: 100;
    overflow: hidden;
    animation: slideDown 0.15s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .suggestion-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--text-primary);
    text-align: left;
  }

  .suggestion-item:hover,
  .suggestion-item.active {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  }

  .tag-text {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag-hint {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .tag-filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin: -12px 0 20px 0;
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .tag-match-toggle {
    display: flex;
    gap: 4px;
    padding: 3px;
    background: var(--bg-primary);
    border-radius: var(--radius-sm);
  }

  .tag-mode-btn {
    padding: 4px 10px;
    font-size: var(--text-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .tag-mode-btn.active {
    background: var(--accent-color);
    color: var(--bg-primary);
    font-weight: 500;
  }

  .active-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .active-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-size: var(--text-sm);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 45%, transparent);
    color: var(--text-primary);
  }

  .active-tag-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }

  .active-tag-remove:hover {
    background: rgba(0, 0, 0, 0.12);
    color: var(--text-primary);
  }

  .clear-tags-btn {
    padding: 4px 10px;
    font-size: var(--text-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .clear-tags-btn:hover {
    border-color: #d3d1cb;
    color: var(--text-primary);
  }

  .deck-tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: -6px 0 12px 0;
  }

  .deck-tag-chip {
    display: inline-block;
    padding: 2px 10px;
    font-size: var(--text-sm);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
    color: var(--text-secondary);
  }

  .deck-tag-more {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    align-self: center;
  }
</style>
