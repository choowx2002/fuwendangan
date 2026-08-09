<script lang="ts">
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import {
    LayoutDashboard,
    Library,
    Swords,
    Wrench,
    Settings,
    ChevronRight,
    Sparkles,
    ChevronLeft,
    Gamepad2,
    Pin,
    PinOff,
  } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { sidebarState } from '../../stores/ui-store.svelte'
  import { showTTSFeatures, windowAlwaysOnTop } from '$lib/stores/settings'
  import { isTauri } from '$lib/db'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import TTSStatusPanel from './TTSStatusPanel.svelte'
  import { t } from 'svelte-i18n'
  let { isOpen = $bindable() } = $props()

  const navItems = [
    { icon: LayoutDashboard, key: 'home', href: '/' },
    { icon: Library, key: 'cards', href: '/cards' },
    { icon: Swords, key: 'decks', href: '/decks' },
    { icon: Sparkles, key: 'collection', href: '/collection' },
    { icon: Gamepad2, key: 'simulator', href: '/simulator' },
  ]

  const toolItems = [
    { icon: Library, key: 'rules', href: '/rules' },
    { icon: Wrench, key: 'tools', href: '/tools' },
    { icon: Settings, key: 'settings', href: '/settings' },
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
    const handleResize = () => {
      // 3. 使用全局状态
      if (window.innerWidth < 767.99 && sidebarState.isMinimized) {
        sidebarState.isMinimized = false
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  })

  function toggleMinimize() {
    sidebarState.isMinimized = !sidebarState.isMinimized
  }

  function togglePin() {
    windowAlwaysOnTop.set(!$windowAlwaysOnTop)
  }

  $effect(() => {
    if (!isTauri) return
    getCurrentWindow()
      .setAlwaysOnTop($windowAlwaysOnTop)
      .catch(() => {})
  })
</script>

<aside class="sidebar" class:open={isOpen} class:isMinimized={sidebarState.isMinimized}>
  <div class="sidebar-header">
    <div class="workspace willHidden" class:isHidden={sidebarState.isMinimized}>
      <div class="workspace-icon">
        <img src="/fuwendangan_logo_zn.webp" alt="logo" />
      </div>
    </div>

    <button class="icon-btn" aria-label={$t('common.minimize')} onclick={toggleMinimize}>
      {#if !sidebarState.isMinimized}
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
        <span class="willHidden" class:isHidden={isOpen && sidebarState.isMinimized}
          >{$t(`nav.${item.key}`)}</span
        >
      </a>
    {/each}
  </nav>

  <div class="divider"></div>

  <nav class="nav-section">
    <div class="section-title willHidden" class:isHidden={isOpen && sidebarState.isMinimized}>
      {$t('nav.sectionTools')}
    </div>
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
        <span class="willHidden" class:isHidden={isOpen && sidebarState.isMinimized}
          >{$t(`nav.${item.key}`)}</span
        >
      </a>
    {/each}
  </nav>

  <div class="sidebar-footer">
    {#if isTauri}
      <button
        class="button button-text"
        class:active={$windowAlwaysOnTop}
        onclick={togglePin}
        aria-pressed={$windowAlwaysOnTop}
      >
        {#if $windowAlwaysOnTop}
          <PinOff size={18} strokeWidth={1.75} />
        {:else}
          <Pin size={18} strokeWidth={1.75} />
        {/if}
        <span class="willHidden" class:isHidden={isOpen && sidebarState.isMinimized}
          >{$t('common.pinWindow')}</span
        >
      </button>
    {/if}

    {#if $showTTSFeatures}
      <TTSStatusPanel />
    {/if}
  </div>
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
    font-weight: 600;
    font-size: var(--text-base);
    /* 添加平滑隐藏支持 */
    overflow: hidden;
    max-width: 150px;
    opacity: 1;
    transition:
      max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.2s ease;
  }

  .workspace.isHidden {
    max-width: 0;
    opacity: 0;
  }

  .workspace-icon {
    width: 100%;
    height: 22px;
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
    font-weight: 500;
    /* 添加平滑隐藏支持 */
    white-space: nowrap;
    overflow: hidden;
    opacity: 1;
    max-width: 120px;
    padding: 8px 12px 4px;
    transition:
      max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.2s ease,
      padding-left 0.25s ease,
      padding-right 0.25s ease;
  }

  .section-title.isHidden {
    opacity: 0;
    max-width: 0;
    padding-left: 0;
    padding-right: 0;
  }

  .nav-item {
    display: flex;
    align-items: center;
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

  .willHidden {
    white-space: nowrap;
    overflow: hidden;
    opacity: 1;
    max-width: 120px;
    transition:
      max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.2s ease;
  }

  .nav-item .willHidden {
    margin-left: 10px;
    transition:
      max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.2s ease,
      margin-left 0.25s ease;
  }

  /* 隐藏状态 */
  .isHidden {
    opacity: 0;
    max-width: 0;
  }

  .nav-item .isHidden {
    margin-left: 0;
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
    .nav-item {
      font-size: var(--text-lg);
    }
  }
</style>
