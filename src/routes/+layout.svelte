<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import AppShell from '../lib/components/layout/AppShell.svelte'
  import LoadingModal from '../lib/components/ui/LoadingModal.svelte'
  import Toast from '../lib/components/ui/Toast.svelte'
  import {
    getVersion,
    initializeDatabase,
    checkForContentUpdates,
    checkAutoSyncOnLaunch,
  } from '../lib/db'
  import { uiState, setLoadStatus } from '../lib/stores/ui-store.svelte'
  import { darkMode } from '../lib/stores/settings'
  import { refreshSupabaseUser } from '../lib/stores/supabase.svelte'
  import { initLogService } from '$lib/services/log-service'
  import { maybePromptBackup } from '$lib/services/backup-reminder'
  import { ask } from '@tauri-apps/plugin-dialog'
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
      } else {
        // 老用户启动：后台静默检查内容更新，发现新版本再询问
        void checkContentUpdates()
      }

      setLoadStatus('success')
      // 启动后异步检查备份提醒（不阻塞界面）
      void maybePromptBackup()
      // 启动后异步检测云同步更新（仅 Tauri + 开关开启，弹框确认后同步，失败静默）
      void checkAutoSyncOnLaunch()
      // 启动后异步刷新 Supabase 登录状态（Sidebar 同步按钮显隐）
      void refreshSupabaseUser()
    } catch (error) {
      // DEBUG: 启动初始化失败的真实错误（plugin-sql reject 为普通字符串）
      console.error('[Layout] 初始化失败:', error)
      console.error(
        '[Layout] 初始化失败 string:',
        error instanceof Error ? error.message : String(error)
      )
      setLoadStatus(
        'error',
        get(t)('loading.error'),
        error instanceof Error ? error.message : get(t)('common.unknownError')
      )
    }
  }

  /** 后台静默检查卡牌数据更新；发现更新则询问用户是否同步 */
  async function checkContentUpdates() {
    try {
      const hasUpdate = await checkForContentUpdates()
      if (!hasUpdate) return
      const accepted = await ask(get(t)('common.contentUpdatePrompt'), {
        title: get(t)('common.contentUpdateTitle'),
        kind: 'info',
        okLabel: get(t)('common.contentUpdateConfirm'),
        cancelLabel: get(t)('common.cancel'),
      })
      if (!accepted) return
      await initializeDatabase({ skipMetered: false, confirm: false })
    } catch (error) {
      console.error('[Layout] 检查卡牌数据更新失败:', error)
      console.error(
        '[Layout] 检查卡牌数据更新失败 string:',
        error instanceof Error ? error.message : String(error)
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
