<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import AppShell from '../lib/components/layout/AppShell.svelte'
  import LoadingModal from '../lib/components/ui/LoadingModal.svelte'
  import Toast from '../lib/components/ui/Toast.svelte'
  import { getVersion, initializeDatabase } from '../lib/db'
  import { uiState, setLoadStatus } from '../lib/stores/ui-store.svelte'
  import { darkMode } from '../lib/stores/settings'
  import { initLogService } from '$lib/services/log-service'
  import '$lib/i18n'
  import '../app.css'
  import { onMount } from 'svelte'
  import { afterNavigate } from '$app/navigation'
  import { tick } from 'svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'

  let { children } = $props()

  $effect(() => {
    document.documentElement.dataset.theme = $darkMode ? 'dark' : 'light'
  })

  afterNavigate(async () => {
    await tick()
    document.querySelector<HTMLElement>('.content')?.scrollTo(0, 0)
  })

  async function init() {
    try {
      const needInit = !(await getVersion())

      if (needInit) {
        setLoadStatus('loading')
        setTimeout(() => {
          if (uiState.status === 'loading') setLoadStatus('syncing')
        }, 500)

        await initializeDatabase()
      }

      setLoadStatus('success')
    } catch (error) {
      console.error('[Layout] 初始化失败:', error)
      setLoadStatus(
        'error',
        get(t)('loading.error'),
        error instanceof Error ? error.message : get(t)('common.unknownError')
      )
    }
  }

  onMount(() => {
    initLogService()
    init()
  })
</script>

<div class="layout-root">
  <Toast />
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
