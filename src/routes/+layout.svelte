<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import AppShell from '../lib/components/AppShell.svelte'
  import LoadingModal from '../lib/components/LoadingModal.svelte'
  import { getVersion, initializeDatabase } from '../lib/db'
  import { uiState, setLoadStatus } from '../lib/stores/ui-store.svelte'
  import '../app.css'
  import { onMount } from 'svelte'

  let { children } = $props()

  async function init() {
    let needInit = !(await getVersion())
    if (!needInit) return
    setLoadStatus('loading')

    try {
      setTimeout(() => {
        if (uiState.status === 'loading') setLoadStatus('syncing')
      }, 500)

      await initializeDatabase()

      setLoadStatus('success')
    } catch (error) {
      console.error('[Layout] 初始化失败:', error)
      setLoadStatus('error', '初始化失败', error instanceof Error ? error.message : '未知错误')
    }
  }

  onMount(() => {
    init()
  })
</script>

<div class="layout-root">
  <!-- 直接使用 uiState.status -->
  {#if uiState.status === 'error'}
    <LoadingModal status={uiState.status} text={uiState.text} subtext={uiState.subText} />
  {:else if uiState.status !== 'success' && uiState.status !== 'hidden' && uiState.status !== 'downloading'}
    <LoadingModal status={uiState.status} text={uiState.text} subtext={uiState.subText} />
  {/if}

  {#if uiState.status === 'success' || uiState.status === 'hidden' || uiState.status === 'downloading'}
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
