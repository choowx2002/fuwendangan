<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import { getDeckById, getDeckVersions, getLatestDeckCards, type Deck } from '$lib/db/index.js'
  import { getRelativeTime } from '$lib/services/time-helper'
  import { onMount } from 'svelte'

  // Lucide Icons (minimal usage)
  import {
    Crown,
    Layers,
    Backpack,
    History,
    ChartBar,
    ChartPie,
    Dices,
    Copy,
    Zap,
    Sword,
    Star,
    Tag,
    Check,
  } from '@lucide/svelte'

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
  let simulatedHand = $state<DeckCardDetail[]>([])
  let copied = $state(false)

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
    if (isBackward) goto('/decks')
  })

  onMount(() => {
    if (page.params.deckid) init(page.params.deckid)
  })

  const mainCards = $derived(cards.filter((c) => c.zone === 'mainDeck'))
  const sideboardCards = $derived(cards.filter((c) => c.zone === 'sideboard'))
  const legendCards = $derived(cards.filter((c) => c.zone === 'legend'))
  const totalCardCount = $derived(cards.reduce((sum, c) => sum + c.quantity, 0))

  // --- 分析功能 ---

  // 1. 费用曲线分析
  const energyCurve = $derived.by(() => {
    const counts: Record<number, number> = {}
    mainCards.forEach((c) => {
      const e = c.energy ?? 0
      counts[e] = (counts[e] || 0) + c.quantity
    })
    return Object.entries(counts)
      .map(([key, value]) => ({ energy: Number(key), count: value }))
      .sort((a, b) => a.energy - b.energy)
  })

  // 2. 卡牌构成统计
  const compositionStats = $derived.by(() => {
    const mainTotal = mainCards.reduce((sum, c) => sum + c.quantity, 0)
    const sideTotal = sideboardCards.reduce((sum, c) => sum + c.quantity, 0)
    const legendTotal = legendCards.reduce((sum, c) => sum + c.quantity, 0)
    return { mainTotal, sideTotal, legendTotal, total: mainTotal + sideTotal + legendTotal }
  })

  // 3. 模拟与测试工具
  function drawOpeningHand() {
    const pool: DeckCardDetail[] = []
    mainCards.forEach((c) => {
      for (let i = 0; i < c.quantity; i++) pool.push(c)
    })

    const hand: DeckCardDetail[] = []
    const poolCopy = [...pool]
    for (let i = 0; i < 4 && poolCopy.length > 0; i++) {
      const idx = Math.floor(Math.random() * poolCopy.length)
      hand.push(poolCopy.splice(idx, 1)[0])
    }
    simulatedHand = hand
  }

  // 4. 导出选项 (纯文本)
  const exportText = $derived.by(() => {
    let text = `${deck?.name || '未命名套牌'}\n\n`
    if (legendCards.length > 0) {
      text += '【传奇】\n'
      legendCards.forEach((c) => {
        text += `${c.quantity}x ${c.card_name_cn}\n`
      })
      text += '\n'
    }
    text += `【主卡组】 (${compositionStats.mainTotal} 张)\n`
    mainCards.forEach((c) => {
      text += `${c.quantity}x ${c.card_name_cn}\n`
    })

    if (sideboardCards.length > 0) {
      text += `\n【备牌】 (${compositionStats.sideTotal} 张)\n`
      sideboardCards.forEach((c) => {
        text += `${c.quantity}x ${c.card_name_cn}\n`
      })
    }
    return text.trim()
  })

  function copyToClipboard() {
    navigator.clipboard.writeText(exportText)
    copied = true
    setTimeout(() => {
      copied = false
    }, 2000)
  }
</script>

<svelte:head>
  <title>{deck?.name || '套牌构建器'}</title>
</svelte:head>

<div class="deck-builder-container">
  <!-- 顶部套牌信息栏 -->
  <header class="deck-header">
    <div class="deck-info">
      <div class="title-row">
        <h1>{deck?.name || '加载中...'}</h1>
        {#if deck?.format}
          <span class="badge format-badge"><Tag size={14} /> {deck.format}</span>
        {/if}
        {#if deck?.is_favorite}
          <span class="badge favorite-badge"><Star size={14} fill="currentColor" /> 收藏</span>
        {/if}
      </div>
      <p class="deck-description">{deck?.description || '暂无描述'}</p>
      <div class="deck-meta">
        <span>总卡牌数: <strong>{totalCardCount}</strong></span>
        <span class="divider">•</span>
        <span
          >创建时间: {deck?.created_at
            ? new Date(deck.created_at).toLocaleDateString()
            : '未知'}</span
        >
        {#if deck?.updated_at}
          <span class="divider">•</span>
          <span>更新时间: {getRelativeTime(deck.updated_at)}</span>
        {/if}
      </div>
    </div>

    <div class="deck-actions">
      <button class="btn btn-secondary">复制套牌</button>
      <button class="btn btn-primary">保存新版本</button>
    </div>
  </header>

  <!-- 分析面板 -->
  <section class="analysis-dashboard">
    <!-- 1. 费用曲线 -->
    <div class="analysis-card">
      <div class="card-header">
        <ChartBar size={18} />
        <h3>费用曲线</h3>
      </div>
      <div class="chart-container">
        {#if energyCurve.length === 0}
          <span class="empty-text">主卡组暂无卡牌</span>
        {:else}
          {#each energyCurve as point}
            <div class="bar-wrapper">
              <div class="bar" style="height: {Math.max(point.count * 8, 4)}px"></div>
              <span class="bar-label">{point.energy}</span>
              <span class="bar-value">{point.count}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- 2. 卡牌构成 -->
    <div class="analysis-card">
      <div class="card-header">
        <ChartPie size={18} />
        <h3>卡牌构成</h3>
      </div>
      <div class="stat-list">
        <div class="stat-row">
          <span class="stat-label">主卡组</span>
          <span class="stat-value">{compositionStats.mainTotal} 张</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">备牌</span>
          <span class="stat-value">{compositionStats.sideTotal} 张</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">传奇</span>
          <span class="stat-value">{compositionStats.legendTotal} 张</span>
        </div>
        <div class="progress-bar-bg">
          <div
            class="progress-bar-fill"
            style="width: {compositionStats.total > 0
              ? (compositionStats.mainTotal / compositionStats.total) * 100
              : 0}%"
          ></div>
        </div>
      </div>
    </div>

    <!-- 3. 起手模拟 -->
    <div class="analysis-card">
      <div class="card-header">
        <Dices size={18} />
        <h3>起手模拟</h3>
      </div>
      <button class="btn btn-outline full-width" onclick={drawOpeningHand}>
        模拟抽取起手 (7张)
      </button>
      {#if simulatedHand.length > 0}
        <div class="sim-hand">
          {#each simulatedHand as card}
            <div class="sim-card-chip">
              <Zap size={12} />
              {card.card_name_cn}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 4. 导出套牌 -->
    <div class="analysis-card">
      <div class="card-header">
        <Copy size={18} />
        <h3>导出套牌</h3>
      </div>
      <p class="export-hint">复制标准纯文本格式，便于分享或导入外部工具。</p>
      <button class="btn btn-outline full-width" onclick={copyToClipboard} class:copied>
        {#if copied}
          <Check size={16} /> 已复制！
        {:else}
          <Copy size={16} /> 复制纯文本
        {/if}
      </button>
    </div>
  </section>

  <!-- 主构建布局 -->
  <div class="builder-layout">
    <main class="card-list-section">
      <!-- 传奇卡 -->
      {#if legendCards.length > 0}
        <section class="card-zone">
          <h3>
            <Crown size={18} /> 传奇 <span class="count-badge">{compositionStats.legendTotal}</span>
          </h3>
          <ul class="card-grid">
            {#each legendCards as card}
              <li class="card-item">
                <img src={card.img_cdn} alt={card.card_name_cn} class="card-img" loading="lazy" />
                <div class="card-details">
                  <div class="card-name">{card.card_name_cn}</div>
                  <div class="card-stats">
                    <span class="stat energy"><Zap size={14} /> {card.energy ?? '-'}</span>
                    <span class="stat power"><Sword size={14} /> {card.power ?? '-'}</span>
                  </div>
                  <div class="card-meta">x{card.quantity} • {card.rarity_name}</div>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- 主卡组 -->
      <section class="card-zone">
        <h3>
          <Layers size={18} /> 主卡组 <span class="count-badge">{compositionStats.mainTotal}</span>
        </h3>
        {#if mainCards.length === 0}
          <p class="empty-hint">主卡组暂无卡牌</p>
        {:else}
          <ul class="card-list">
            {#each mainCards as card}
              <li class="card-row">
                <span class="qty">x{card.quantity}</span>
                <img src={card.img_cdn} alt={card.card_name_cn} class="card-thumb" loading="lazy" />
                <div class="card-info">
                  <div class="name">{card.card_name_cn}</div>
                  <div class="sub">{card.card_name_en} • {card.print_code}</div>
                </div>
                <div class="card-stats-inline">
                  <span class="stat-mini"><Zap size={14} /> {card.energy ?? '-'}</span>
                  <span class="stat-mini"><Sword size={14} /> {card.power ?? '-'}</span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- 备牌 -->
      {#if sideboardCards.length > 0}
        <section class="card-zone">
          <h3>
            <Backpack size={18} /> 备牌
            <span class="count-badge">{compositionStats.sideTotal}</span>
          </h3>
          <ul class="card-list">
            {#each sideboardCards as card}
              <li class="card-row">
                <span class="qty">x{card.quantity}</span>
                <img src={card.img_cdn} alt={card.card_name_cn} class="card-thumb" loading="lazy" />
                <div class="card-info">
                  <div class="name">{card.card_name_cn}</div>
                  <div class="sub">{card.card_name_en} • {card.print_code}</div>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </main>

    <!-- 版本历史侧边栏 -->
    <aside class="version-sidebar">
      <h3><History size={18} /> 版本历史</h3>
      <ul class="version-list">
        {#each versions as version}
          <li class="version-item">
            <div class="version-top">
              <span class="version-number">v{version.version_number}</span>
              <span class="version-date">{new Date(version.created_at).toLocaleDateString()}</span>
            </div>
            <div class="version-note">{version.note || '无备注'}</div>
          </li>
        {:else}
          <li class="empty-hint">暂无版本历史</li>
        {/each}
      </ul>
    </aside>
  </div>
</div>

<style>
  :global(body) {
    background-color: var(--bg-primary);
    font-family: 'Noto Sans SC', system-ui, sans-serif;
  }

  .deck-builder-container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px;
    color: var(--text-primary);
  }

  /* Header */
  .deck-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    background: #ffffff;
    padding: 24px;
    border-radius: var(--radius-lg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    margin-bottom: 24px;
    border: 1px solid var(--border-color);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .deck-info h1 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .format-badge {
    background: rgba(18, 131, 120, 0.1);
    color: var(--accent-color);
  }
  .favorite-badge {
    background: rgba(234, 179, 8, 0.15);
    color: #b45309;
  }

  .deck-description {
    color: var(--text-secondary);
    margin: 8px 0 16px 0;
    font-size: var(--text-base);
    line-height: 1.5;
  }

  .deck-meta {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .deck-meta strong {
    color: var(--accent-color);
  }
  .divider {
    color: var(--border-color);
  }

  .deck-actions {
    display: flex;
    gap: 12px;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    cursor: pointer;
    font-weight: 500;
    font-size: var(--text-sm);
    transition: all 0.15s ease;
  }

  .btn-primary {
    background: var(--accent-color);
    color: #ffffff;
  }
  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-color);
  }
  .btn-secondary:hover {
    background: var(--bg-active);
  }

  .btn-outline {
    background: transparent;
    color: var(--accent-color);
    border-color: var(--border-color);
  }
  .btn-outline:hover {
    background: var(--bg-hover);
    border-color: var(--accent-color);
  }
  .btn-outline.copied {
    background: rgba(18, 131, 120, 0.1);
    color: var(--accent-color);
    border-color: var(--accent-color);
  }

  .full-width {
    width: 100%;
    margin-top: 12px;
  }

  /* Analysis Dashboard */
  .analysis-dashboard {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px;
    margin-bottom: 32px;
  }

  .analysis-card {
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    color: var(--text-secondary);
  }

  .card-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  /* Curve Chart */
  .chart-container {
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    height: 120px;
    gap: 8px;
    padding-top: 10px;
  }

  .bar-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    height: 100%;
    justify-content: flex-end;
  }

  .bar {
    width: 100%;
    max-width: 32px;
    background: var(--accent-color);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition: height 0.3s ease;
    min-height: 4px;
    opacity: 0.85;
  }
  .bar-wrapper:hover .bar {
    opacity: 1;
  }

  .bar-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-top: 6px;
    font-weight: 600;
  }

  .bar-value {
    font-size: var(--text-xs);
    color: var(--accent-color);
    font-weight: 700;
  }

  /* Composition Stats */
  .stat-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
  }
  .stat-label {
    color: var(--text-secondary);
  }
  .stat-value {
    font-weight: 600;
    color: var(--text-primary);
  }

  .progress-bar-bg {
    height: 6px;
    background: var(--bg-hover);
    border-radius: 9999px;
    overflow: hidden;
    margin-top: 4px;
  }
  .progress-bar-fill {
    height: 100%;
    background: var(--accent-color);
    border-radius: 9999px;
    transition: width 0.4s ease;
  }

  /* Simulation & Export */
  .export-hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
  }

  .sim-hand {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
    max-height: 160px;
    overflow-y: auto;
  }

  .sim-card-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    padding: 6px 10px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  /* Builder Layout */
  .builder-layout {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 24px;
  }

  .card-zone {
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .card-zone h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px 0;
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-color);
  }

  .count-badge {
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: 9999px;
    font-weight: 600;
  }

  /* Card Grid (Legends) */
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 16px;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .card-item {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #ffffff;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }

  .card-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  }

  .card-img {
    width: 100%;
    aspect-ratio: 2.5/3.5;
    object-fit: cover;
    display: block;
    background: var(--bg-secondary);
  }

  .card-details {
    padding: 10px;
  }
  .card-name {
    font-weight: 600;
    font-size: var(--text-sm);
    margin-bottom: 6px;
    line-height: 1.3;
  }

  .card-stats {
    display: flex;
    gap: 8px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .stat.energy {
    color: #d97706;
  }
  .stat.power {
    color: #dc2626;
  }

  .card-meta {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* Card List (Main/Side) */
  .card-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .card-row {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--bg-secondary);
    gap: 12px;
    transition: background 0.15s;
    border-radius: var(--radius-md);
  }

  .card-row:hover {
    background: var(--bg-hover);
  }
  .card-row:last-child {
    border-bottom: none;
  }

  .qty {
    font-weight: 700;
    color: var(--accent-color);
    width: 32px;
    text-align: center;
    font-size: var(--text-base);
  }

  .card-thumb {
    width: 36px;
    height: 50px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
  }

  .card-info {
    flex: 1;
    min-width: 0;
  }
  .card-info .name {
    font-weight: 600;
    font-size: var(--text-base);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-info .sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .card-stats-inline {
    display: flex;
    gap: 12px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .stat-mini {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  /* Sidebar */
  .version-sidebar {
    background: #ffffff;
    padding: 20px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    height: fit-content;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .version-sidebar h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px 0;
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .version-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .version-item {
    padding: 12px 0;
    border-bottom: 1px solid var(--bg-secondary);
  }
  .version-item:last-child {
    border-bottom: none;
  }

  .version-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .version-number {
    font-weight: 700;
    color: var(--accent-color);
    font-size: var(--text-sm);
  }
  .version-date {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .version-note {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .empty-hint {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: var(--text-sm);
    padding: 12px 0;
  }
  .empty-text {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    width: 100%;
    text-align: center;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .builder-layout {
      grid-template-columns: 1fr;
    }
    .version-sidebar {
      order: 2;
    }
  }

  @media (max-width: 640px) {
    .deck-builder-container {
      padding: 16px;
    }
    .deck-header {
      flex-direction: column;
      gap: 16px;
    }
    .deck-actions {
      width: 100%;
    }
    .btn {
      flex: 1;
    }
    .analysis-dashboard {
      grid-template-columns: 1fr;
    }
    .card-stats-inline {
      display: none;
    }
  }
</style>
