<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import AppShell from '../lib/components/AppShell.svelte'
  import LoadingModal from '../lib/components/LoadingModal.svelte'
  import { initializeDatabase } from '../lib/db'
  import { uiState, setLoadStatus } from '../lib/stores/ui-store.svelte'
  import '../app.css'

  let { children } = $props()

  async function init() {
    setLoadStatus('loading') // 使用全局方法更新状态

    try {
      setTimeout(() => {
        if (uiState.status === 'loading') setLoadStatus('syncing')
      }, 500)

      await initializeDatabase()

      // setLoadStatus('success')
      setTimeout(() => {
        setLoadStatus('success')
      }, 900)
    } catch (error) {
      console.error('[Layout] 初始化失败:', error)
      setLoadStatus('error', '初始化失败', error instanceof Error ? error.message : '未知错误')
    }
  }

  $effect(() => {
    init()
  })

  function handleRetry() {
    init()
  }
</script>

<div class="layout-root">
  <!-- 直接使用 uiState.status -->
  {#if uiState.status === 'error'}
    <LoadingModal
      status={uiState.status}
      text={uiState.text}
      subtext={uiState.subText}
      onRetry={handleRetry}
    />
  {:else if uiState.status !== 'success' && uiState.status !== 'hidden'}
    <LoadingModal status={uiState.status} text={uiState.text} subtext={uiState.subText} />
  {/if}

  {#if uiState.status === 'success' || uiState.status === 'hidden'}
    <AppShell>
      {@render children()}
    </AppShell>
  {/if}
</div>

<style>
  .layout-root {
    width: 100%;
    height: 100vh;
    overflow: hidden;
  }
</style>
