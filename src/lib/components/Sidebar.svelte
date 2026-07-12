<script lang="ts">
  import { page } from '$app/state'
  import { beforeNavigate, goto, onNavigate, pushState } from '$app/navigation'
  import {
    LayoutDashboard,
    Library,
    Swords,
    Wrench,
    Settings,
    ChevronRight,
    Plus,
    Sparkles,
    ChevronLeft,
    Gamepad2,
  } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import {
    selectedTTSColor,
    colorOptions,
    type colorValue,
    ttsState,
  } from '../stores/ui-store.svelte'
  import { detectTTSServer } from '$lib/services/tts-communication-service'
  import { showTTSFeatures } from '$lib/stores/settings'
  let { isOpen = $bindable(), isMinimized = $bindable() } = $props()

  const navItems = [
    { icon: LayoutDashboard, label: '首页', href: '/' },
    { icon: Library, label: '单卡库', href: '/cards' },
    { icon: Swords, label: '我的卡组', href: '/decks' },
    { icon: Sparkles, label: '收藏与闪卡', href: '/collection' },
    { icon: Gamepad2, label: '模拟器', href: '/simulator' },
  ]

  const routeBackConfig = {
    // 主页面
    '/': { backTo: null, description: '首页 - 正常退出' },

    // 二级页面
    '/cards': { backTo: '/', description: '单卡库 → 首页' },
    '/decks': { backTo: '/', description: '我的卡组 → 首页' },
    '/collection': { backTo: '/', description: '收藏与闪卡 → 首页' },
    '/simulator': { backTo: '/', description: '模拟器 → 首页' },

    // 工具与设置
    '/tools': { backTo: '/', description: '对战工具 → 首页' },
    '/settings': { backTo: '/', description: '设置 → 首页' },

    // 可以扩展嵌套页面
    '/cards/detail': { backTo: '/cards', description: '卡牌详情 → 单卡库' },
    '/decks/builder': { backTo: '/decks', description: '编辑卡组 → 我的卡组' },

    // 特殊：如果你想留在当前页（比如筛选面板打开时）
    // 这个在 FilterPanel 里单独处理，不放在这里
  }

  const toolItems = [
    { icon: Wrench, label: '对战工具', href: '/tools' },
    { icon: Settings, label: '设置', href: '/settings' },
  ]

  function closeIfMobile() {
    if (window.innerWidth < 767.99) {
      isOpen = false
    }
  }

  function navigateTo(href: string) {
    goto(href)
    closeIfMobile()
  }

  onMount(() => {
    window.addEventListener('resize', () => {
      if (window.innerWidth < 767.99 && isMinimized) {
        isMinimized = false
      }
    })

    return () => {
      window.removeEventListener('resize', () => {
        if (window.innerWidth < 767.99 && isMinimized) {
          isMinimized = false
        }
      })
    }
  })

  const colorMap: Record<colorValue, string> = {
    Black: 'rgb(0,0,0)',
    Red: 'rgb(218,26,24)',
    Green: 'rgb(49,179,43)',
    Purple: 'rgb(160,32,240)',
    Blue: 'rgb(30,135,255)',
  }

  function toggleMinimize() {
    isMinimized = !isMinimized
  }
</script>

<aside class="sidebar" class:open={isOpen} class:isMinimized>
  <div class="sidebar-header">
    <div class="workspace willHidden" class:isHidden={isMinimized}>
      <div class="workspace-icon">
        <img src="/fuwendangan_logo_zn.webp" alt="logo" />
      </div>
    </div>

    <button class="icon-btn" aria-label="最小化" onclick={toggleMinimize}>
      {#if !isMinimized}
        <ChevronLeft size={16} />
      {:else}
        <ChevronRight class="nav-item" size={18} strokeWidth={2} />
      {/if}
    </button>
  </div>

  <nav class="nav-section">
    {#each navItems as item}
      <a
        href={item.href}
        class="nav-item"
        class:active={page.url.pathname === item.href}
        onclick={(e) => {
          e.preventDefault() // ← 阻止默认跳转
          navigateTo(item.href)
        }}
      >
        <item.icon size={18} strokeWidth={1.75} />
        <span class="willHidden" class:isHidden={isOpen && isMinimized}>{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="divider"></div>

  <nav class="nav-section willHidden" class:isHidden={isOpen && isMinimized}>
    <div class="section-title">工具与设置</div>
    {#each toolItems as item}
      <a
        href={item.href}
        class="nav-item"
        class:active={page.url.pathname === item.href}
        onclick={(e) => {
          e.preventDefault() // ← 阻止默认跳转
          navigateTo(item.href)
        }}
      >
        <item.icon size={18} strokeWidth={1.75} />
        <span class="willHidden" class:isHidden={isOpen && isMinimized}>{item.label}</span>
      </a>
    {/each}
  </nav>

  {#if $showTTSFeatures}
    <div class="sidebar-footer">
      <div class="tts-info">
        <p title="点击链接" onclick={detectTTSServer} role="presentation">
          TTS链接：{$ttsState.sendPort ? '已连接' : '未连接'}
        </p>
      </div>
      <div class="user-info">
        <div class="avatar" style="background: {colorMap[$selectedTTSColor as colorValue]}"></div>
        <select bind:value={$selectedTTSColor}>
          {#each colorOptions as color}
            <option value={color.value}>
              {color.name}
            </option>
          {/each}
        </select>
      </div>
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--sidebar-width);
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    z-index: 50;
    transform: translateX(-100%);
    transition:
      transform 0.2s ease,
      width 0.2s ease;
    will-change: transform, width;
    padding-top: env(safe-area-inset-top);
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .sidebar.isMinimized {
    width: 64px;
    text-align: center;
  }

  .sidebar-header {
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sidebar.isMinimized .sidebar-header {
    justify-content: center;
  }

  .workspace {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: var(--text-base);
  }

  .workspace-icon {
    width: 100%;
    height: 22px;
    /*background: var(--accent-color);*/
    /*color: white;*/
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
  }
  .workspace-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    mix-blend-mode: difference;
  }

  .icon-btn {
    background: none;
    border: none;
    padding: 4px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
  }

  .nav-section {
    padding: 0 8px;
    margin-bottom: 8px;
  }

  .section-title {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    padding: 8px 12px 4px;
    font-weight: 500;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    text-decoration: none;
    font-size: var(--text-base);
    cursor: pointer;
    transition: background 0.1s;
  }

  .sidebar.isMinimized .nav-item {
    justify-content: center;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
  }

  .tts-info {
    font-size: var(--text-base);
    font-weight: bold;
    cursor: pointer;
  }

  .divider {
    height: 1px;
    background: var(--border-color);
    margin: 8px 16px;
  }

  .sidebar-footer {
    margin-top: auto;
    padding: 12px;
    border-top: 1px solid var(--border-color);
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-base);
    font-weight: 500;
  }

  .avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .willHidden {
    transition:
      width 0.2s ease,
      opacity 0.2s ease,
      display 0s 0.2s ease;
    opacity: 1;
    max-width: 999px;
  }

  .isHidden {
    opacity: 0;
    max-width: 0;
    display: none;
    overflow: hidden;
  }

  @media (min-width: 767.99px) {
    .sidebar {
      transform: translateX(0);
    }
  }

  @media (max-width: 767.99px) {
    .icon-btn {
      display: none;
    }

    .sidebar {
      padding-top: env(safe-area-inset-top);
    }
    .nav-item,
    .tts-info {
      font-size: var(--text-lg);
    }
  }
</style>
