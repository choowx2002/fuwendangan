<!-- src/lib/components/layout/AppShell.svelte -->
<script lang="ts">
  import Topbar from './Topbar.svelte'
  import Sidebar from './Sidebar.svelte'
  import BottomNav from './BottomNav.svelte'
  import DownloadProgressBar from '../ui/DownloadProgressBar.svelte'
  import { sidebarState } from '../../stores/ui-store.svelte'
  import { networkState, reconnectNow } from '../../stores/network.svelte'
  import { showToast } from '../../stores/ui-store.svelte'
  import { page } from '$app/state'
  import { RefreshCw } from '@lucide/svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  let { children } = $props()
  let isSidebarOpen = $state(false)
  let reconnecting = $state(false)

  async function handleReconnect() {
    if (reconnecting) return
    reconnecting = true
    try {
      const ok = await reconnectNow()
      if (ok) {
        showToast(get(t)('common.networkRestored'), 'success')
      } else {
        showToast(get(t)('appShell.offlineRetryFailed'), 'error')
      }
    } finally {
      reconnecting = false
    }
  }

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
      page.url.pathname === '/scanner' ||
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
    <button
      class="offline-banner"
      type="button"
      title={$t('appShell.offlineRetry')}
      disabled={reconnecting}
      onclick={handleReconnect}
    >
      {reconnecting ? $t('appShell.offlineConnecting') : $t('appShell.offline')}
      <RefreshCw size={12} class={reconnecting ? 'spin' : ''} />
    </button>
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
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
  }

  .offline-banner:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--accent-color);
  }

  .offline-banner:disabled {
    opacity: 0.75;
    cursor: default;
  }

  :global(.spin) {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
