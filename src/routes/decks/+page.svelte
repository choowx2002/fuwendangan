<script lang="ts">
  import { Plus, Search, Funnel, EllipsisVertical, Copy, Trash2, PenLine, Folder } from '@lucide/svelte'

  // 模拟卡组数据
  const allDecks = [
    {
      id: '1',
      name: '红绿快攻 (RG Aggro)',
      format: '1v1（比赛）',
      cardCount: 60,
      wins: 12,
      losses: 4,
      draw: 1,
      updated: '2小时前',
      favorite: true,
    },
    {
      id: '2',
      name: '蓝白控制 (WU Control)',
      format: '1v1（比赛）',
      cardCount: 75,
      wins: 8,
      losses: 7,
      draw: 0,
      updated: '昨天',
      favorite: false,
    },
    {
      id: '3',
      name: '勇得中速 (Jund Midrange)',
      format: '1v1（比赛）',
      cardCount: 60,
      wins: 15,
      losses: 5,
      draw: 4,
      updated: '3天前',
      favorite: true,
    },
    {
      id: '4',
      name: '精灵组合技 (Elves Combo)',
      format: '1v1（比赛）',
      cardCount: 60,
      wins: 20,
      losses: 8,
      draw: 1,
      updated: '1周前',
      favorite: false,
    },
    {
      id: '5',
      name: '黑绿腐化 (BG Midrange)',
      format: '1v1（决斗）',
      cardCount: 60,
      wins: 10,
      losses: 6,
      draw: 1,
      updated: '2周前',
      favorite: false,
    },
    {
      id: '6',
      name: '伊捷凤凰 (Izzet Phoenix)',
      format: '1v1（比赛）',
      cardCount: 60,
      wins: 18,
      losses: 9,
      updated: '3周前',
      favorite: true,
    },
  ]

  // 筛选状态
  let searchQuery = $state('')
  let selectedFormat = $state('全部')
  let showFavoritesOnly = $state(false)

  export const formats = [
    "1v1（决斗）",
    "1v1（比赛）",
    "3 人乱斗（遭遇战）",
    "4 人乱斗（全面战争）",
    "2v2（熔岩大厅）"
  ];

  // 筛选后的卡组列表
  const filteredDecks = $derived(
    allDecks.filter((deck) => {
      const matchesSearch = deck.name.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesFormat = selectedFormat === '全部' || deck.format === selectedFormat

      const matchesFavorite = !showFavoritesOnly || deck.favorite

      return matchesSearch && matchesFormat && matchesFavorite
    })
  )
  function toggleFavorite(deckId: string) {
    const deck = allDecks.find((d) => d.id === deckId)
    if (deck) {
      deck.favorite = !deck.favorite
    }
  }

  function deleteDeck(deckId: string) {
    console.log('删除卡组:', deckId)
  }

  function duplicateDeck(deckId: string) {
    console.log('复制卡组:', deckId)
  }
  // Calculate difference in days (or any unit: 'second', 'minute', 'hour', 'month', 'year')
  function getRelativeTime(date: number | Date) {
    const now = new Date();
    const diffInMs = date - now;
    const diffInSecs = Math.round(diffInMs / 1000);

    // Set up formatter
    const rtf = new Intl.RelativeTimeFormat('zh', { numeric: 'auto' });

    // Define time thresholds in seconds
    if (Math.abs(diffInSecs) < 60) {
      return rtf.format(diffInSecs, 'second');
    } else if (Math.abs(diffInSecs) < 3600) {
      return rtf.format(Math.round(diffInSecs / 60), 'minute');
    } else if (Math.abs(diffInSecs) < 86400) {
      return rtf.format(Math.round(diffInSecs / 3600), 'hour');
    } else {
      return rtf.format(Math.round(diffInSecs / 86400), 'day');
    }
  }

  const pastDate = new Date('2026-07-05T12:00:00');
  console.log(getRelativeTime(pastDate));

</script>

<div class="decks-page">
  <!-- 页面头部 -->
  <header class="page-header">
    <div class="header-content">
      <p class="page-desc">管理你的所有卡组，共 {allDecks.length} 副</p>
    </div>
    <button class="btn-primary new-deck-btn">
      <Plus size={18} />
      <span>新建卡组</span>
    </button>
  </header>

  <!-- 筛选工具栏 -->
  <section class="filter-bar">
    <div class="search-box">
      <div class="search-icon">
        <Search size={18} />
      </div>
      <input
        type="text"
        placeholder="搜索卡组名称..."
        bind:value={searchQuery}
        class="search-input"
      />
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
        class="favorite-filter btn-secondary"
        class:active={showFavoritesOnly}
        onclick={() => (showFavoritesOnly = !showFavoritesOnly)}
      >
        <Folder size={16} />
        <span>收藏</span>
      </button>
    </div>
  </section>

  <!-- 卡组网格 -->
  {#if filteredDecks.length === 0}
    <div class="empty-state">
      <Folder size={48} class="empty-icon" />
      <h3>没有找到匹配的卡组</h3>
      <p>试试调整筛选条件或创建新卡组</p>
    </div>
  {:else}
    <div class="decks-grid">
      {#each filteredDecks as deck (deck.id)}
        <div class="deck-card" class:favorite={deck.favorite}>
          <div class="deck-header">
            <div class="deck-info">
              <h3 class="deck-name">{deck.name}</h3>
              <span class="deck-format-badge">{deck.format}</span>
            </div>
            <button class="menu-btn" title="更多操作">
              <EllipsisVertical size={18} />
            </button>
          </div>

          <div class="deck-stats-row">
            <div class="stat-item">
              <span class="stat-label">卡牌</span>
              <span class="stat-value">{deck.cardCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">战绩</span>
              <span class="stat-value record">
                <span class="win">{deck.wins}</span>
                <span class="separator">-</span>
                <span class="loss">{deck.losses}</span>
              </span>
            </div>
            <div class="stat-item">
              <span class="stat-label">更新</span>
              <span class="stat-value time">{deck.updated}</span>
            </div>
          </div>

          <div class="deck-actions">
            <button class="action-btn" onclick={() => duplicateDeck(deck.id)} title="复制卡组">
              <Copy size={16} />
            </button>
            <button
              class="action-btn"
              onclick={() => toggleFavorite(deck.id)}
              title="收藏/取消收藏"
            >
              <PenLine size={16} />
            </button>
            <button class="action-btn danger" onclick={() => deleteDeck(deck.id)} title="删除卡组">
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
    padding: 40px 24px 80px;
  }

  @media (max-width: 767.99px) {
    .decks-page {
      padding: 24px 16px 80px;
    }
  }

  /* 页面头部 */
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
    /* color: var(--text-secondary); */
    margin: 0;
  }

  .new-deck-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--text-primary);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .new-deck-btn:hover {
    background: #2f2e29;
    transform: translateY(-1px);
  }

  /* 筛选工具栏 */
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
    border-color: var(--text-primary);
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

  .filter-icon {
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

  .btn-secondary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-base);
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-secondary:hover {
    background: var(--bg-secondary);
  }

  .btn-secondary.active {
    background: var(--text-primary);
    color: white;
    border-color: var(--text-primary);
  }

  /* 空状态 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 24px;
    text-align: center;
  }

  .empty-icon {
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

  /* 卡组网格 */
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
    margin: 0 0 8px 0;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-format-badge {
    display: inline-block;
    font-size: var(--text-sm);
    padding: 2px 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    color: var(--text-secondary);
  }

  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.1s;
    flex-shrink: 0;
  }

  .menu-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
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
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-color: #d3d1cb;
  }

  .action-btn.danger:hover {
    background: #fee;
    color: #e03e3e;
    border-color: #fcc;
  }
</style>
