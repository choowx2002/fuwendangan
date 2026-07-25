<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import { getDeckById, getDeckVersions, getLatestDeckCards, type Deck } from '$lib/db/index.js'
  import { getRelativeTime } from '$lib/services/time-helper'
  import { onMount } from 'svelte'

  interface DeckCardDetail {
    id: string
    card_id: string
    quantity: number
    zone: string
    card_name_cn: string
    card_name_en: string
    energy: number
    power: number
    card_color_list: string
    print_code: string
    img_cdn: string
    rarity_name: string
  }

  interface DeckVersion {
    id: string
    version_number: number
    note: string | null
    created_at: string
  }

  let deck = $state<Deck>()
  let cards = $state<DeckCardDetail[]>([])
  let versions = $state<DeckVersion[]>([])

  const init = async (deckId: string) => {
    const data = await getDeckById(deckId)
    if (!data) {
      goto('/decks')
      return
    }
    deck = data
    cards = await getLatestDeckCards(deckId)

    versions = await getDeckVersions(deckId)
  }

    beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
       if (isBackward) goto("/decks")
  })

  onMount(() => {
    if (page.params.deckid) init(page.params.deckid)
  })

  // 按区域分组卡牌 (main, sideboard, legend)
  const mainCards = $derived(cards.filter((c) => c.zone === 'mainDeck'))
  const sideboardCards = $derived(cards.filter((c) => c.zone === 'sideboard'))
  const legendCards = $derived(cards.filter((c) => c.zone === 'legend'))

  const totalCardCount = $derived(cards.reduce((sum, c) => sum + c.quantity, 0))
</script>

<svelte:head>
  <title>{deck?.name}</title>
</svelte:head>

<div class="deck-builder-container">
  <!-- 顶部套牌信息栏 -->
  <header class="deck-header">
    <div class="deck-info">
      <h1>{deck?.name}</h1>
      {#if deck?.format}
        <span class="badge format-badge">{deck.format}</span>
      {/if}
      {#if deck?.is_favorite}
        <span class="badge favorite-badge">★ 收藏</span>
      {/if}
      <p class="deck-description">{deck?.description || '暂无描述'}</p>
      <div class="deck-meta">
        <span>总卡牌数: <strong>{totalCardCount}</strong></span>
        <span>创建时间: {new Date(deck?.created_at!).toLocaleDateString()}</span>
        {#if deck}
          <span>更新时间: {getRelativeTime(deck.updated_at!)}</span>
        {/if}
      </div>
    </div>

    <div class="deck-actions">
      <!-- 这里可以接入 form actions 实现复制、删除等功能 -->
      <button class="btn btn-secondary">复制套牌</button>
      <button class="btn btn-primary">保存新版本</button>
    </div>
  </header>

  <div class="builder-layout">
    <!-- 左侧：卡牌列表展示 -->
    <main class="card-list-section">
      <!-- 传奇卡 (Legend) -->
      {#if legendCards.length > 0}
        <section class="card-zone">
          <h3>👑 传奇卡 (Legend)</h3>
          <ul class="card-grid">
            {#each legendCards as card}
              <li class="card-item">
                <img src={card.img_cdn} alt={card.card_name_cn} class="card-img" />
                <div class="card-details">
                  <div class="card-name">{card.card_name_cn}</div>
                  <div class="card-stats">
                    <span class="stat energy">⚡ {card.energy}</span>
                    <span class="stat power">⚔️ {card.power}</span>
                  </div>
                  <div class="card-meta">x{card.quantity} | {card.rarity_name}</div>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- 主卡组 (Main) -->
      <section class="card-zone">
        <h3>📚 主卡组 (Main) - {mainCards.reduce((sum, c) => sum + c.quantity, 0)} 张</h3>
        {#if mainCards.length === 0}
          <p class="empty-hint">主卡组暂无卡牌</p>
        {:else}
          <ul class="card-list">
            {#each mainCards as card}
              <li class="card-row">
                <span class="qty">x{card.quantity}</span>
                <img src={card.img_cdn} alt={card.card_name_cn} class="card-thumb" />
                <div class="card-info">
                  <div class="name">{card.card_name_cn}</div>
                  <div class="sub">{card.card_name_en} | {card.print_code}</div>
                </div>
                <div class="card-stats-inline">
                  <span>⚡ {card.energy}</span>
                  <span>⚔️ {card.power}</span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- 备牌 (Sideboard) -->
      {#if sideboardCards.length > 0}
        <section class="card-zone">
          <h3>🔄 备牌 (Sideboard) - {sideboardCards.reduce((sum, c) => sum + c.quantity, 0)} 张</h3>
          <ul class="card-list">
            {#each sideboardCards as card}
              <li class="card-row">
                <span class="qty">x{card.quantity}</span>
                <img src={card.img_cdn} alt={card.card_name_cn} class="card-thumb" />
                <div class="card-info">
                  <div class="name">{card.card_name_cn}</div>
                  <div class="sub">{card.card_name_en} | {card.print_code}</div>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </main>

    <!-- 右侧：版本历史侧边栏 -->
    <aside class="version-sidebar">
      <h3>📜 版本历史</h3>
      <ul class="version-list">
        {#each versions as version}
          <li class="version-item">
            <div class="version-number">v{version.version_number}</div>
            <div class="version-note">{version.note || '无备注'}</div>
            <div class="version-date">{new Date(version.created_at).toLocaleString()}</div>
          </li>
        {/each}
      </ul>
    </aside>
  </div>
</div>

<style>
  .deck-builder-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    color: #333;
  }

  .deck-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #eee;
    padding-bottom: 20px;
    margin-bottom: 20px;
  }

  .deck-info h1 {
    margin: 0 0 10px 0;
    font-size: 2rem;
  }

  .badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: bold;
    margin-right: 8px;
  }

  .format-badge {
    background: #e0e7ff;
    color: #3730a3;
  }
  .favorite-badge {
    background: #fef3c7;
    color: #92400e;
  }

  .deck-description {
    color: #666;
    margin: 10px 0;
  }

  .deck-meta {
    font-size: 0.9rem;
    color: #888;
  }

  .deck-meta strong {
    color: #2563eb;
  }

  .btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    margin-left: 10px;
  }

  .btn-primary {
    background: #2563eb;
    color: white;
  }
  .btn-secondary {
    background: #e5e7eb;
    color: #374151;
  }

  .builder-layout {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 24px;
  }

  .card-zone {
    margin-bottom: 30px;
  }

  .card-zone h3 {
    border-left: 4px solid #2563eb;
    padding-left: 10px;
    margin-bottom: 15px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 15px;
    list-style: none;
    padding: 0;
  }

  .card-item {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
  }

  .card-img {
    width: 100%;
    height: auto;
    display: block;
  }

  .card-details {
    padding: 10px;
  }

  .card-name {
    font-weight: bold;
    font-size: 0.95rem;
    margin-bottom: 5px;
  }

  .card-stats {
    display: flex;
    gap: 10px;
    font-size: 0.85rem;
    color: #555;
    margin-bottom: 5px;
  }

  .card-meta {
    font-size: 0.8rem;
    color: #888;
  }

  .card-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .card-row {
    display: flex;
    align-items: center;
    padding: 10px;
    border-bottom: 1px solid #f3f4f6;
    gap: 12px;
  }

  .card-row:hover {
    background: #f9fafb;
  }

  .qty {
    font-weight: bold;
    color: #2563eb;
    width: 30px;
    text-align: center;
  }

  .card-thumb {
    width: 40px;
    height: 56px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid #ddd;
  }

  .card-info {
    flex: 1;
  }

  .card-info .name {
    font-weight: 600;
  }

  .card-info .sub {
    font-size: 0.8rem;
    color: #888;
  }

  .card-stats-inline {
    display: flex;
    gap: 12px;
    font-size: 0.85rem;
    color: #666;
  }

  .version-sidebar {
    background: #f8fafc;
    padding: 20px;
    border-radius: 8px;
    height: fit-content;
  }

  .version-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .version-item {
    padding: 12px;
    border-bottom: 1px solid #e2e8f0;
  }

  .version-item:last-child {
    border-bottom: none;
  }

  .version-number {
    font-weight: bold;
    color: #2563eb;
  }

  .version-note {
    font-size: 0.9rem;
    margin: 4px 0;
  }

  .version-date {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .empty-hint {
    color: #94a3b8;
    font-style: italic;
  }

  @media (max-width: 768px) {
    .builder-layout {
      grid-template-columns: 1fr;
    }
    .deck-header {
      flex-direction: column;
    }
    .deck-actions {
      margin-top: 15px;
      display: flex;
      gap: 10px;
    }
    .btn {
      margin-left: 0;
    }
  }
</style>
