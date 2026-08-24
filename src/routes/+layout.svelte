<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import AppShell from '../lib/components/layout/AppShell.svelte'
  import LoadingModal from '../lib/components/ui/LoadingModal.svelte'
  import ConfirmDialog from '../lib/components/ui/ConfirmDialog.svelte'
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
  import { confirmAction } from '$lib/utils/confirm'
  import { isSecondaryWindow } from '$lib/utils/open-window'
  import '$lib/i18n'
  import '../app.css'
  import { onMount } from 'svelte'
  import { afterNavigate } from '$app/navigation'
  import { page } from '$app/state'
  import { tick } from 'svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'

  let { children } = $props()

  /** 卡牌独立展示窗口：无 AppShell（无侧栏/顶栏/底栏），纯全屏展示 */
  const isShowcaseWindow = $derived(page.url.pathname.startsWith('/cards/show/'))
  /** 独立筛选窗口：无 AppShell（无侧栏/顶栏/底栏） */
  const isStandaloneWindow = $derived(page.url.pathname.startsWith('/cards/filter'))

  $effect(() => {
    document.documentElement.dataset.theme = $darkMode ? 'dark' : 'light'
  })

  afterNavigate(async () => {
    await tick()
    document.querySelector<HTMLElement>('.content')?.scrollTo(0, 0)
  })

  async function init() {
    try {
      // 次级窗口（openInNewWindow 创建）共享主窗口的数据库与内容，不应再触发
      // 内容同步 / 备份提醒 / 云同步等主窗口才承担的一次性启动逻辑。
      const secondary = await isSecondaryWindow()

      const needInit = !(await getVersion())

      if (needInit) {
        setLoadStatus('loading')
        setTimeout(() => {
          if (uiState.status === 'loading') setLoadStatus('syncing')
        }, 500)

        await initializeDatabase()
      } else if (!secondary) {
        // 老用户启动：后台静默检查内容更新，发现新版本再询问
        void checkContentUpdates()
      }

      setLoadStatus('success')
      if (!secondary) {
        // 启动后异步检查备份提醒（不阻塞界面）
        void maybePromptBackup()
        // 启动后异步检测云同步更新（仅 Tauri + 开关开启，弹框确认后同步，失败静默）
        void checkAutoSyncOnLaunch()
        // 启动后异步刷新 Supabase 登录状态（Sidebar 同步按钮显隐）
        void refreshSupabaseUser()
      }
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
      const accepted = await confirmAction(get(t)('common.contentUpdatePrompt'), {
        title: get(t)('common.contentUpdateTitle'),
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
  <ConfirmDialog />
  <!-- 直接使用 uiState.status -->
  {#if uiState.status === 'error'}
    <LoadingModal status={uiState.status} text={uiState.text} subtext={uiState.subText} />
  {:else if uiState.status !== 'success' && uiState.status !== 'hidden' && uiState.status !== 'downloading'}
    <LoadingModal status={uiState.status} text={uiState.text} subtext={uiState.subText} />
  {/if}

  {#if uiState.status === 'success' || uiState.status === 'hidden' || uiState.status === 'downloading'}
    {#if isShowcaseWindow || isStandaloneWindow}
      <!-- 独立展示/筛选窗口：不套 AppShell，直接渲染子内容 -->
      {@render children()}
    {:else}
      <AppShell>
        {@render children()}
      </AppShell>
    {/if}
  {/if}
</div>

<style>
  .layout-root {
    width: 100%;
    height: 100vh;
    overflow: hidden;
  }
</style>
