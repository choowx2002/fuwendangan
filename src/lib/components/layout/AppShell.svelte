<!-- src/lib/components/layout/AppShell.svelte -->
<script lang="ts">
  import Topbar from './Topbar.svelte'
  import Sidebar from './Sidebar.svelte'
  import BottomNav from './BottomNav.svelte'
  import DownloadProgressBar from '../ui/DownloadProgressBar.svelte'
  import { sidebarState } from '../../stores/ui-store.svelte'
  import { networkState } from '../../stores/network.svelte'
  import { page } from '$app/state'
  import { t } from 'svelte-i18n'
  let { children } = $props()
  let isSidebarOpen = $state(false)

  // 监听窗口大小变化，桌面端自动展开侧边栏
  function handleResize() {
    if (window.innerWidth >= 767.99) {
      isSidebarOpen = true
    } else {
      isSidebarOpen = false
    }
  }

  $effect(() => {
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  })

  let isNotShowBothPage = $derived(
    page.url.pathname === '/decks/builder' ||
      page.url.pathname.startsWith('/rules/') ||
      page.url.pathname === '/tools/gameCounter' ||
      page.url.pathname === '/tools/dice'
  )
</script>

<div
  class="app-shell"
  class:sidebar-open={isSidebarOpen}
  class:isMinimized={sidebarState.isMinimized}
  class:fullPage={isNotShowBothPage}
>
  {#if !isNotShowBothPage}
    <Sidebar bind:isOpen={isSidebarOpen} />
  {/if}

  <div class="main-area">
    {#if !isNotShowBothPage}
      <Topbar bind:isSidebarOpen />
    {/if}
    <main class="content">
      {@render children()}
    </main>
    {#if !isNotShowBothPage}
      <BottomNav />
    {/if}
  </div>

  <!-- 移动端遮罩层 -->
  {#if isSidebarOpen && window.innerWidth < 767.99}
    <div class="overlay" onclick={() => (isSidebarOpen = false)} role="presentation"></div>
  {/if}

  <DownloadProgressBar />

  {#if !networkState.online && networkState.checked}
    <div class="offline-banner" role="status">{$t('appShell.offline')}</div>
  {/if}
</div>

<style>
  .app-shell {
    display: flex;
    height: 100vh;
    width: 100vw;
    position: relative;
    overflow: hidden;
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0; /* 防止 flex 子元素溢出 */
    transition: margin-left 0.2s ease;
  }

  /* 桌面端布局 */
  @media (min-width: 767.99px) {
    .sidebar-open .main-area {
      margin-left: var(--sidebar-width);
    }

    .isMinimized .main-area {
      margin-left: 64px;
    }

    .fullPage .main-area {
      margin-left: 0;
    }
  }

  .content {
    flex: 1;
    overflow-y: auto;
    background-color: var(--bg-primary);
  }

  .overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.4);
    z-index: 40;
    backdrop-filter: blur(2px);
  }

  .offline-banner {
    position: fixed;
    top: calc(var(--topbar-height, 48px) + env(safe-area-inset-top) + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    pointer-events: none;
    white-space: nowrap;
  }
</style>
