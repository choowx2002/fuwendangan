<script lang="ts">
  import { getCardCount, getDeckList, getMatchStatsForDecks } from '$lib/db'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { getRelativeTime } from '$lib/utils/time-helper'
  import { Plus, Clock, TrendingUp, Dice5, Coins, ChevronRight } from '@lucide/svelte'
  import { onMount } from 'svelte'

  interface HomeDeck {
    id: string
    name: string
    format: string | null
    wins: number
    losses: number
    updated: string
  }

  let recentDecks = $state<HomeDeck[]>([])

  const quickTools = [
    {
      icon: Dice5,
      label: '生命计数器',
      desc: '双人对战计分',
      color: '#e03e3e',
      href: '/tools',
      disabled: false,
    },
    {
      icon: Coins,
      label: '掷币/掷骰',
      desc: '随机数生成',
      color: '#d9730d',
      href: '/tools',
      disabled: false,
    },
    {
      icon: TrendingUp,
      label: '胜率统计',
      desc: '查看近期战绩',
      color: '#0f7b6c',
      href: '',
      disabled: true,
    },
  ]

  onMount(async () => {
    try {
      await getCardCount()
    } catch (error) {}
    try {
      const { decks } = await getDeckList()
      const stats = await getMatchStatsForDecks(decks.map((d) => d.id))
      recentDecks = decks.slice(0, 5).map((d) => {
        const s = stats.get(d.id)
        return {
          id: d.id,
          name: d.name,
          format: d.format,
          wins: s?.wins ?? 0,
          losses: s?.losses ?? 0,
          updated: d.updated_at ? getRelativeTime(d.updated_at) : '未知',
        }
      })
    } catch (error) {}
  })

  $effect(() => {
    setTopbar({ title: '首页', description: '欢迎回来，天龠wx。今天想玩点什么？' })
  })
</script>

<div class="page-container">
  <!-- 快速操作区 -->
  <section class="section">
    <div class="section-header">
      <h2 class="section-title">快速开始</h2>
    </div>
    <div class="quick-actions">
      <button class="action-card primary">
        <Plus size={20} />
        <span>新建卡组</span>
      </button>
      <button class="action-card">
        <Clock size={20} />
        <span>导入单卡</span>
      </button>
    </div>
  </section>

  <!-- 常用工具 -->
  <section class="section">
    <div class="section-header">
      <h2 class="section-title">对战工具</h2>
      <a href="/tools" class="see-all">查看全部 <ChevronRight size={14} /></a>
    </div>
    <div class="tools-grid">
      {#each quickTools as tool}
        {#if tool.disabled}
          <div class="tool-card tool-card-disabled" title="暂未开放">
            <div class="tool-icon" style="background: {tool.color}15; color: {tool.color}">
              <tool.icon size={22} />
            </div>
            <div class="tool-info">
              <span class="tool-label">{tool.label}</span>
              <span class="tool-desc">{tool.desc}</span>
            </div>
            <span class="tool-badge">暂未开放</span>
          </div>
        {:else}
          <a href={tool.href} class="tool-card">
            <div class="tool-icon" style="background: {tool.color}15; color: {tool.color}">
              <tool.icon size={22} />
            </div>
            <div class="tool-info">
              <span class="tool-label">{tool.label}</span>
              <span class="tool-desc">{tool.desc}</span>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  </section>

  <!-- 最近卡组 -->
  <section class="section">
    <div class="section-header">
      <h2 class="section-title">最近使用的卡组</h2>
      <a href="/decks" class="see-all">管理卡组 <ChevronRight size={14} /></a>
    </div>
    <div class="deck-list">
      {#each recentDecks as deck}
        <!-- svelte-ignore a11y_invalid_attribute -->
        <a href="/decks/{deck.id}" class="deck-item">
          <div class="deck-main">
            <span class="deck-name">{deck.name}</span>
            {#if deck.format}
              <span class="deck-format">{deck.format}</span>
            {/if}
          </div>
          <div class="deck-stats">
            <span class="stat win">{deck.wins}胜</span>
            <span class="stat loss">{deck.losses}负</span>
            <span class="stat time">{deck.updated}</span>
          </div>
        </a>
      {:else}
        <p class="deck-empty">暂无卡组，去创建一个吧。</p>
      {/each}
    </div>
  </section>
</div>

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

  /* 快速操作 */
  .quick-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .action-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s;
  }
  .action-card:hover {
    background: var(--bg-secondary);
    border-color: #d3d1cb;
  }
  .action-card.primary {
    background: var(--text-primary);
    color: white;
    border-color: var(--text-primary);
  }
  .action-card.primary:hover {
    background: #2f2e29;
  }

  /* 工具网格 */
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  .tool-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s;
  }
  .tool-card:hover {
    background: var(--bg-secondary);
    border-color: #d3d1cb;
    transform: translateY(-1px);
  }

  .tool-card-disabled {
    opacity: 0.55;
    position: relative;
    cursor: not-allowed;
  }
  .tool-card-disabled:hover {
    border-color: var(--border-color);
    transform: none;
  }

  .tool-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-tertiary);
  }

  .tool-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tool-info {
    display: flex;
    flex-direction: column;
  }
  .tool-label {
    font-size: var(--text-base);
    font-weight: 600;
  }
  .tool-desc {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    margin-top: 2px;
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
    gap: 12px;
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
</style>
