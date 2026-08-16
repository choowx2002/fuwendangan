<script lang="ts">
  import {
    buildSyncBundleText,
    importSyncBundleText,
    getSyncStatus,
    getOrCreateDeviceId,
    parseBundle,
    syncViaSupabase,
    signInSupabase,
    signOutSupabase,
    testSupabaseConnection,
    buildSupabaseCreateTableSql,
    isTauri,
  } from '$lib/db'
  import {
    playerName,
    syncSupabaseUrl,
    syncSupabaseAnonKey,
    autoSyncEnabled,
  } from '$lib/stores/settings'
  import { refreshSupabaseUser, supabaseState } from '$lib/stores/supabase.svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { get } from 'svelte/store'
  import { t } from 'svelte-i18n'
  import { onMount } from 'svelte'
  import { ask, message, open } from '@tauri-apps/plugin-dialog'
  import { writeText } from '@tauri-apps/plugin-clipboard-manager'
  import { appLocalDataDir, join } from '@tauri-apps/api/path'
  import { readTextFile, writeTextFile } from '$lib/services/db-file-service'
  import { Download, Upload, FileText, RefreshCw, Cloud } from '@lucide/svelte'
  import LoadingModal from '$lib/components/ui/LoadingModal.svelte'

  // --- 状态管理 ---
  let busyText = $state('')
  let syncLastSync = $state<string>(get(t)('common.loading'))
  let deviceId = $state('')
  let syncFileInput = $state<HTMLInputElement | null>(null)
  let supabaseEmail = $state('')
  let supabasePassword = $state('')

  function _t(key: string, values?: Record<string, unknown>) {
    return get(t)(key, values)
  }

  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
    busyText = label
    try {
      return await fn()
    } finally {
      busyText = ''
    }
  }

  // --- 生命周期 ---
  onMount(async () => {
    await refreshSyncLastSync()
    try {
      deviceId = await getOrCreateDeviceId()
    } catch {
      deviceId = ''
    }
    void refreshSupabaseUser()
  })

  // URL / key 变化后自动重查登录状态；输入停顿 800ms 后触发，避免逐键查询
  let supabaseCheckTimer: ReturnType<typeof setTimeout> | undefined
  let firstSupabaseCheckRun = true
  $effect(() => {
    void $syncSupabaseUrl
    void $syncSupabaseAnonKey
    if (firstSupabaseCheckRun) {
      firstSupabaseCheckRun = false
      return
    }
    if (supabaseCheckTimer) clearTimeout(supabaseCheckTimer)
    supabaseCheckTimer = setTimeout(() => {
      void refreshSupabaseUser()
    }, 800)
    return () => {
      if (supabaseCheckTimer) clearTimeout(supabaseCheckTimer)
    }
  })

  $effect(() => {
    setTopbar({ title: $t('settings.syncTitle') })
  })

  async function refreshSyncLastSync() {
    try {
      const syncStatus = await getSyncStatus()
      syncLastSync = syncStatus.lastSync
        ? new Date(syncStatus.lastSync).toLocaleString()
        : _t('settings.neverSynced')
    } catch {
      syncLastSync = _t('settings.neverSynced')
    }
  }

  // --- 玩家数据同步：导出 Sync Bundle ---
  async function exportSyncBundleAsk() {
    const deviceName = get(playerName)
    let text = ''
    try {
      text = await withBusy(_t('settings.syncExportBusy'), () => buildSyncBundleText(deviceName))
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.syncExport'),
        kind: 'error',
      })
      return
    }

    try {
      if (isTauri) {
        const dir = await open({
          title: _t('settings.syncExportSelectDir'),
          directory: true,
          multiple: false,
        })
        if (!dir) return
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const dest = await join(String(dir), `rune-archive-sync-${stamp}.json`)
        await writeTextFile(dest, text)
        await message(_t('settings.syncExportSuccess', { values: { path: dest } }), {
          title: _t('settings.syncExport'),
          kind: 'info',
        })
      } else {
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `rune-archive-sync-${new Date().toISOString().slice(0, 10)}.json`
        anchor.click()
        URL.revokeObjectURL(url)
        await message(_t('settings.syncExportWebDone'), {
          title: _t('settings.syncExport'),
          kind: 'info',
        })
      }
      await refreshSyncLastSync()
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.syncExport'),
        kind: 'error',
      })
    }
  }

  // --- 玩家数据同步：导入 Sync Bundle（桌面文件选择） ---
  async function importSyncBundleAsk() {
    let src: string
    if (isTauri) {
      const picked = await open({
        title: _t('settings.syncImportOpenTitle'),
        multiple: false,
        filters: [{ name: _t('settings.syncJsonFilter'), extensions: ['json'] }],
      })
      if (!picked) return
      src = String(picked)
    } else {
      syncFileInput?.click()
      return
    }

    await importSyncBundleFromPath(src)
  }

  /** 玩家数据同步：导入 Sync Bundle（Web 文件选择回调） */
  async function handleSyncFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const text = await file.text()
      await runSyncImport(text, file.name)
    } catch (err) {
      await message(err instanceof Error ? err.message : _t('common.unknownError'), {
        title: _t('settings.syncImport'),
        kind: 'error',
      })
    }
  }

  /** 玩家数据同步：桌面路径导入 */
  async function importSyncBundleFromPath(path: string) {
    let text = ''
    try {
      text = await withBusy(_t('settings.syncImportReadBusy'), () => readTextFile(path))
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.syncImport'),
        kind: 'error',
      })
      return
    }
    await runSyncImport(text, path)
  }

  /** 玩家数据同步：校验 + 确认 + 合并写回 */
  async function runSyncImport(text: string, source: string) {
    const deviceName = get(playerName)
    try {
      parseBundle(text)
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.syncImport'),
        kind: 'error',
      })
      return
    }

    const confirmed = await ask(_t('settings.syncImportConfirm', { values: { path: source } }), {
      title: _t('settings.syncImportConfirmTitle'),
      kind: 'warning',
      okLabel: _t('common.confirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (!confirmed) return

    try {
      const result = await withBusy(_t('settings.syncImportBusy'), () =>
        importSyncBundleText(text, deviceName)
      )
      await message(
        _t('settings.syncImportSuccess', {
          values: {
            decks: result.upsertedDecks,
            variants: result.upsertedVariants,
            wishlist: result.upsertedWishlist,
            loans: result.upsertedLoans,
            contacts: result.upsertedContacts,
            lists: result.upsertedPurchaseLists,
            matches: result.upsertedMatches,
            lockers: result.upsertedLockers,
            customs: result.upsertedCustomPrints,
            settings: result.appliedSettings,
            missing: result.missingCards,
          },
        }),
        { title: _t('settings.syncImport'), kind: 'info' }
      )
      await refreshSyncLastSync()
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.syncImport'),
        kind: 'error',
      })
    }
  }

  // --- Supabase BYO 云同步 ---
  async function copySupabaseSql() {
    try {
      await writeText(buildSupabaseCreateTableSql())
      await message(_t('settings.supabaseCopySqlDone'), {
        title: _t('settings.supabaseTitle'),
        kind: 'info',
      })
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.supabaseTitle'),
        kind: 'error',
      })
    }
  }

  async function testSupabaseConn() {
    try {
      const res = await withBusy(_t('settings.supabaseTestBusy'), () => testSupabaseConnection())
      let text: string
      console.log('[SUPABASE]', res)
      switch (res.code) {
        case 'no_config':
          text = _t('settings.supabaseNoConfig')
          break
        case 'signed_in':
          text = _t('settings.supabaseOkSignedIn')
          break
        case 'not_signed_in':
          text = _t('settings.supabaseOkNotSignedIn')
          break
        case 'table_missing':
          text = _t('settings.supabaseTableMissing')
          break
        case 'paused_or_network':
          text = _t('settings.supabasePausedHint')
          break
        default:
          text = res.detail || _t('settings.supabaseError')
      }
      await message(text, {
        title: _t('settings.supabaseTest'),
        kind: res.ok ? 'info' : 'warning',
      })
      await refreshSupabaseUser()
      await refreshSyncLastSync()
    } catch (e) {
      console.error('[SYNC] testSupabaseConn 失败:', e)
      console.error(
        '[SYNC] testSupabaseConn 失败 string:',
        e instanceof Error ? e.message : String(e)
      )
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.supabaseTest'),
        kind: 'error',
      })
    }
  }

  async function handleSupabaseSignIn() {
    if (!supabaseEmail || !supabasePassword) return
    try {
      await withBusy(_t('settings.supabaseSignInBusy'), () =>
        signInSupabase(supabaseEmail, supabasePassword)
      )
      const email = supabaseEmail
      supabasePassword = ''
      await refreshSupabaseUser()
      await message(_t('settings.supabaseSignedIn', { values: { email } }), {
        title: _t('settings.supabaseSignIn'),
        kind: 'info',
      })
    } catch (e) {
      console.error('[SYNC] handleSupabaseSignIn 失败:', e)
      console.error(
        '[SYNC] handleSupabaseSignIn 失败 string:',
        e instanceof Error ? e.message : String(e)
      )
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.supabaseSignIn'),
        kind: 'error',
      })
    }
  }

  async function handleSupabaseSignOut() {
    try {
      await signOutSupabase()
      await refreshSupabaseUser()
    } catch (e) {
      console.error('[SYNC] handleSupabaseSignOut 失败:', e)
      console.error(
        '[SYNC] handleSupabaseSignOut 失败 string:',
        e instanceof Error ? e.message : String(e)
      )
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.supabaseSignOut'),
        kind: 'error',
      })
    }
  }

  async function syncSupabaseNow() {
    const accepted = await ask(_t('settings.supabaseSyncConfirm'), {
      title: _t('settings.supabaseSync'),
      kind: 'warning',
      okLabel: _t('settings.autoSyncConfirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (!accepted) return
    try {
      const result = await withBusy(_t('settings.supabaseSyncBusy'), () => syncViaSupabase())
      await message(
        _t('settings.supabaseSyncSuccess', {
          values: {
            decks: result.upsertedDecks,
            variants: result.upsertedVariants,
            wishlist: result.upsertedWishlist,
            loans: result.upsertedLoans,
            contacts: result.upsertedContacts,
            lists: result.upsertedPurchaseLists,
            matches: result.upsertedMatches,
            lockers: result.upsertedLockers,
            customs: result.upsertedCustomPrints,
            settings: result.appliedSettings,
            missing: result.missingCards,
          },
        }),
        { title: _t('settings.supabaseSync'), kind: 'info' }
      )
      await refreshSyncLastSync()
    } catch (e) {
      // DEBUG: 移动端同步失败的真实错误（plugin-sql reject 的是普通字符串，不是 Error）
      console.error('[SYNC] syncSupabaseNow 失败:', e)
      console.error(
        '[SYNC] syncSupabaseNow 失败 string:',
        e instanceof Error ? e.message : String(e)
      )
      await message(e instanceof Error ? e.message : _t('common.unknownError'), {
        title: _t('settings.supabaseSync'),
        kind: 'error',
      })
    }
  }
</script>

<div class="settings-container">
  <!-- 玩家数据同步 -->
  <section class="settings-card">
    <h2 class="card-title">
      <RefreshCw size={16} />
      {$t('settings.syncTitle')}
    </h2>

    <div class="notice-banner">{$t('settings.syncPrivacyNotice')}</div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.syncLastSync')}</span>
        <span class="setting-desc">{$t('settings.syncLastSyncDesc')}</span>
      </div>
      <span class="version-tag">{syncLastSync}</span>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.syncDeviceId')}</span>
        <span class="setting-desc">{$t('settings.syncDeviceIdDesc')}</span>
      </div>
      <span class="version-tag device-id-tag">{deviceId}</span>
    </div>

    <div class="db-actions">
      <button class="button button-ghost" disabled={!!busyText} onclick={exportSyncBundleAsk}>
        <Download size={16} />
        {$t('settings.syncExport')}
      </button>
      <button class="button button-ghost" disabled={!!busyText} onclick={importSyncBundleAsk}>
        <Upload size={16} />
        {$t('settings.syncImport')}
      </button>
    </div>

    <input
      bind:this={syncFileInput}
      type="file"
      accept=".json,application/json"
      hidden
      onchange={handleSyncFileChange}
    />
  </section>

  <!-- Supabase BYO 云同步 -->
  <section class="settings-card">
    <h2 class="card-title">
      <Cloud size={16} />
      {$t('settings.supabaseTitle')}
    </h2>

    <div class="notice-banner">{$t('settings.supabaseNotice')}</div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.supabaseUrl')}</span>
        <span class="setting-desc">{$t('settings.supabaseUrlDesc')}</span>
      </div>
      <input class="setting-input" type="text" bind:value={$syncSupabaseUrl} />
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.supabaseKey')}</span>
        <span class="setting-desc">{$t('settings.supabaseKeyDesc')}</span>
      </div>
      <input class="setting-input" type="password" bind:value={$syncSupabaseAnonKey} />
    </div>

    <div class="db-actions">
      <button class="button button-ghost" disabled={!!busyText} onclick={copySupabaseSql}>
        <FileText size={16} />
        {$t('settings.supabaseCopySql')}
      </button>
      <button class="button button-ghost" disabled={!!busyText} onclick={testSupabaseConn}>
        <RefreshCw size={16} />
        {$t('settings.supabaseTest')}
      </button>
      <button class="button button-primary" disabled={!!busyText} onclick={syncSupabaseNow}>
        <Upload size={16} />
        {$t('settings.supabaseSync')}
      </button>
    </div>

    {#if supabaseState.checking}
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">{$t('settings.supabaseChecking')}</span>
        </div>
      </div>
    {:else if supabaseState.userEmail}
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label"
            >{$t('settings.supabaseSignedIn', { values: { email: supabaseState.userEmail } })}</span
          >
          <span class="setting-desc">{$t('settings.supabaseSignedInDesc')}</span>
        </div>
        <button class="button button-ghost" onclick={handleSupabaseSignOut}>
          {$t('settings.supabaseSignOut')}
        </button>
      </div>
    {:else}
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">{$t('settings.supabaseEmail')}</span>
          <span class="setting-desc">{$t('settings.supabaseNotSignedIn')}</span>
        </div>
        <input class="setting-input" type="email" bind:value={supabaseEmail} />
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">{$t('settings.supabasePassword')}</span>
        </div>
        <input class="setting-input" type="password" bind:value={supabasePassword} />
      </div>
      <div class="db-actions">
        <button
          class="button button-ghost"
          disabled={!supabaseEmail || !supabasePassword}
          onclick={handleSupabaseSignIn}
        >
          {$t('settings.supabaseSignIn')}
        </button>
      </div>
    {/if}

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.supabaseLastSync')}</span>
        <span class="setting-desc">{$t('settings.supabaseLastSyncDesc')}</span>
      </div>
      <span class="version-tag">{syncLastSync}</span>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.autoSyncLabel')}</span>
        <span class="setting-desc">{$t('settings.autoSyncDesc')}</span>
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={$autoSyncEnabled} />
        <span class="slider"></span>
      </label>
    </div>
  </section>

  {#if busyText}
    <LoadingModal status="syncing" text={busyText} subtext={$t('settings.pleaseWait')} />
  {/if}
</div>

<style>
  .settings-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
    color: var(--text-primary);
  }

  .settings-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px 24px;
    margin-bottom: 20px;
  }

  .card-title {
    font-size: var(--text-lg);
    font-weight: 600;
    margin: 0 0 16px 0;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .notice-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 14px;
    margin-bottom: 4px;
    border: 1px solid color-mix(in oklab, var(--accent-color) 35%, var(--border-color));
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--accent-color) 8%, transparent);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 0;
    border-bottom: 1px solid rgba(205, 205, 203, 0.6);
  }

  .setting-item:last-child {
    border-bottom: none;
  }

  .setting-input {
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

  .setting-input:focus {
    border-color: var(--accent-color);
  }

  @media (max-width: 479.99px) {
    .setting-input {
      width: 120px;
    }
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    margin-right: 24px;
    min-width: 0;
  }

  .setting-label {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .setting-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .version-tag {
    background: var(--bg-hover);
    padding: 4px 10px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .device-id-tag {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--text-xs);
    max-width: 40%;
  }

  .db-actions {
    margin-top: 16px;
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  /* Toggle 开关样式 */
  .switch {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    flex-shrink: 0;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-color);
    transition: 0.25s;
    border-radius: 22px;
  }

  .slider:before {
    position: absolute;
    content: '';
    height: 18px;
    width: 18px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    transition: 0.25s;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(55, 53, 47, 0.2);
  }

  input:checked + .slider {
    background-color: var(--accent-color);
  }

  input:checked + .slider:before {
    transform: translateX(18px);
  }

  @media (max-width: 767.99px) {
    .settings-container {
      padding: 24px 16px 80px;
    }
  }
</style>
