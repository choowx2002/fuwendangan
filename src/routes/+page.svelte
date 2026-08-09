<script lang="ts">
  import { getDeckList, getMatchStatsForDecks } from '$lib/db'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { getRelativeTime } from '$lib/utils/time-helper'
  import { isDeckPinned } from '$lib/stores/pinned-decks'
  import { playerName, settingsStoreReady } from '$lib/stores/settings'
  import { Swords, Dice6, Pin, ChevronRight, UserRound } from '@lucide/svelte'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { t } from 'svelte-i18n'

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

  let recentDecks = $state<HomeDeck[]>([])
  let homeName = $state('')
  let settingsReady = $state(false)

  const quickTools = [
    {
      icon: Swords,
      labelKey: 'home.toolsGameCounter',
      color: '#e03e3e',
      href: '/tools/gameCounter',
    },
    {
      icon: Dice6,
      labelKey: 'home.toolsDice',
      color: '#d9730d',
      href: '/tools/dice',
    },
  ]

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

  <!-- 对战工具（紧凑按钮行） -->
  <section class="section">
    <div class="section-header">
      <h2 class="section-title">{$t('home.tools')}</h2>
      <a href="/tools" class="see-all">{$t('home.openToolbox')} <ChevronRight size={14} /></a>
    </div>
    <div class="tools-row">
      {#each quickTools as tool}
        <a href={tool.href} class="tool-chip">
          <span class="tool-chip-icon" style="background: {tool.color}15; color: {tool.color}">
            <tool.icon size={16} />
          </span>
          <span class="tool-chip-label">{$t(tool.labelKey)}</span>
        </a>
      {/each}
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

  /* 对战工具 - 紧凑按钮行 */
  .tools-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-primary);
    text-decoration: none;
    color: var(--text-primary);
    font-size: var(--text-base);
    font-weight: 500;
    transition: all 0.15s;
  }
  .tool-chip:hover {
    background: var(--bg-secondary);
    border-color: var(--border-color);
    transform: translateY(-1px);
  }

  .tool-chip-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    flex-shrink: 0;
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
</style>
