<script lang="ts">
  import { getTableState, formatBytes, resetDatabase, initializeDatabase } from '$lib/db'
  import { showForeignCardArt as showFCA, showTTSFeatures } from '$lib/stores/settings'
  import { CARD_IMAGE, clearLocalCache, getImageDirSize } from '$lib/services/image-cache-service'
  import { appDataDir, appLocalDataDir, join } from '@tauri-apps/api/path'
  import { onMount } from 'svelte'
  import { setLoadStatus } from '$lib/stores/ui-store.svelte'
  import { writeText } from '@tauri-apps/plugin-clipboard-manager'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { getVersion } from '@tauri-apps/api/app'
  import { isMobile } from '$lib/services/os-serives'

  // import { invoke } from '@tauri-apps/api/core';
  // import { open } from '@tauri-apps/plugin-opener';

  // --- 状态管理 ---
  let appVersion = $state('1.0.0')
  let appUpdateStatus = $state<'idle' | 'checking' | 'available' | 'upToDate' | 'error'>('idle')
  let cardDataUpdateStatus = $state<'idle' | 'checking' | 'available' | 'upToDate' | 'error'>(
    'idle'
  )

  let dbSize = $state<string>('计算中...')
  let dbPath = $state<string>('加载中...')
  let imagePath = $state<string>('加载中...')
  let imageCacheSize = $state<string>('加载中...')
  let inMobile = $state<boolean>(false)

  // --- 常量 ---
  const HELP_DOC_URL =
    'https://wjp00vpskyvs.jp.larksuite.com/wiki/MeISwlCQeiiOK6kMxrujfVC2pcf?from=from_copylink'

  // --- 生命周期 ---
  onMount(async () => {
    appVersion = await getVersion()
    await loadDbInfo()
    inMobile = await isMobile()
  })

  // --- 逻辑函数 ---
  async function loadDbInfo() {
    try {
      const [db, base, appDir] = await Promise.all([
        getTableState(),
        appLocalDataDir(),
        appDataDir(),
      ])

      // 1. 计算 DB size
      let total = 0
      db?.forEach((d: any) => {
        total += d.bytes
      })
      dbSize = formatBytes(total)

      // 2. 图片路径
      imagePath = await join(base, CARD_IMAGE)

      const imageCacheSizeByte = await getImageDirSize()
      imageCacheSize = formatBytes(imageCacheSizeByte)

      // 3. db 路径
      dbPath = appDir
    } catch (e) {
      dbSize = '获取失败'
      imageCacheSize = '获取失败'
      dbPath = '获取失败'
      console.log('[初始化失败]', e)
    }
  }

  async function checkAppUpdate() {
    appUpdateStatus = 'checking'
    try {
      // TODO: 替换为 Crabnabula Cloud 检查更新逻辑
      await new Promise((r) => setTimeout(r, 1500))
      appUpdateStatus = 'upToDate' // 或 'available'
    } catch (e) {
      appUpdateStatus = 'error'
    }
  }

  async function checkCardDataUpdate() {
    cardDataUpdateStatus = 'checking'
    try {
      setLoadStatus('syncing')
      await initializeDatabase()
      setLoadStatus('success')
    } catch (e) {
      cardDataUpdateStatus = 'error'
    }
  }

  async function handleResetDb() {
    if (confirm('确定要重置数据库吗？\n此操作会删除您的卡组数据，并重新初始化数据库连接。')) {
      await resetDatabase()
      alert('数据库已成功重置！')
    }
  }

  function openHelpDoc() {
    openUrl(HELP_DOC_URL)
  }

  // --- 辅助函数 ---
  function getStatusText(status: string) {
    switch (status) {
      case 'checking':
        return '检查中...'
      case 'available':
        return '有可用更新'
      case 'upToDate':
        return '已是最新版本'
      case 'error':
        return '检查失败，请重试'
      default:
        return ''
    }
  }

  function handleResetImageCache() {
    if (confirm('确定要重置卡图缓存吗？\n此操作会删除您所有卡图缓存。')) {
      clearLocalCache()
        .then(async () => {
          const imageCacheSizeByte = await getImageDirSize()
          imageCacheSize = formatBytes(imageCacheSizeByte)
        })
        .catch((e) => {
          setLoadStatus('error', '重置缓存失败', e instanceof Error ? e.message : '未知错误')
        })
    }
  }
</script>

<div class="settings-container">
  <h1 class="page-title">设置</h1>

  <!-- 1. 通用设置 -->
  <section class="settings-card">
    <h2 class="card-title">通用设置</h2>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">展示其他语言卡图</span>
        <span class="setting-desc">
          在卡组中显示非默认语言的卡牌原画。中国大陆地区受网络环境影响，图片可能无法正常加载。
        </span>
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={$showFCA} />
        <span class="slider"></span>
      </label>
    </div>

    {#if !inMobile}
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">显示TTS功能</span>
          <span class="setting-desc"> 单机的时候可以导入卡牌到TTS里 </span>
        </div>
        <label class="switch">
          <input type="checkbox" bind:checked={$showTTSFeatures} />
          <span class="slider"></span>
        </label>
      </div>
    {/if}
  </section>

  <!-- 2. 版本与更新 -->
  <section class="settings-card">
    <h2 class="card-title">版本与更新</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">应用版本</span>
        <span class="setting-desc">当前客户端版本号</span>
      </div>
      <span class="version-tag">{appVersion}</span>
    </div>

    <!-- <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">Crabnabula Cloud 应用更新</span>
        <span
          class="setting-desc status-text"
          class:text-success={appUpdateStatus === 'upToDate'}
          class:text-warning={appUpdateStatus === 'available'}
          class:text-error={appUpdateStatus === 'error'}
        >
          {getStatusText(appUpdateStatus) || '点击检查客户端更新'}
        </span>
      </div>
      <button
        class="btn btn-secondary"
        onclick={checkAppUpdate}
        disabled={appUpdateStatus === 'checking'}
      >
        {appUpdateStatus === 'checking' ? '检查中' : '检查更新'}
      </button>
    </div> -->

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">卡牌数据更新</span>
        <span
          class="setting-desc status-text"
          class:text-success={cardDataUpdateStatus === 'upToDate'}
          class:text-warning={cardDataUpdateStatus === 'available'}
          class:text-error={cardDataUpdateStatus === 'error'}
        >
          {getStatusText(cardDataUpdateStatus) || '点击检查卡牌数据库更新'}
        </span>
      </div>
      <button
        class="btn btn-secondary"
        onclick={checkCardDataUpdate}
        disabled={cardDataUpdateStatus === 'checking'}
      >
        {cardDataUpdateStatus === 'checking' ? '检查中' : '检查更新'}
      </button>
    </div>

    <!-- <div class="update-actions">
      <button
        class="btn btn-primary"
        onclick={performOneClickUpdate}
        disabled={appUpdateStatus !== 'available' && cardDataUpdateStatus !== 'available'}
      >
        一键更新
      </button>
    </div> -->
  </section>

  <!-- 3. 反馈与帮助 -->
  <section class="settings-card">
    <h2 class="card-title">反馈与帮助</h2>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">反馈文档</span>
        <span class="setting-desc">打开反馈页面，提交 Bug 或功能建议。</span>
      </div>
      <button class="btn btn-outline" onclick={openHelpDoc}> 访问链接 ↗ </button>
    </div>
  </section>

  <!-- 4. 本地数据库 -->
  <section class="settings-card">
    <h2 class="card-title">本地数据库</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">数据库存储路径</span>
        <span
          role="presentation"
          class="setting-desc file-path"
          onclick={async () => {
            await writeText(dbPath)
          }}>{dbPath}</span
        >
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">数据库占用大小</span>
        <span class="setting-desc">包含卡组数据、卡牌基础数据及缓存</span>
      </div>
      <span class="version-tag">{dbSize}</span>
    </div>

    <div class="db-actions">
      <button class="btn btn-danger-outline" onclick={handleResetDb}> 重置数据库 </button>
    </div>
  </section>

  <!-- 5. 本地图片 -->
  <section class="settings-card">
    <h2 class="card-title">本地卡图缓存</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">卡图缓存路径</span>
        <span
          role="presentation"
          class="setting-desc file-path"
          onclick={async () => {
            await writeText(imagePath)
          }}>{imagePath}</span
        >
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">卡图缓存占用大小</span>
      </div>
      <span class="version-tag">{imageCacheSize}</span>
    </div>

    <div class="db-actions">
      <button class="btn btn-danger-outline" onclick={handleResetImageCache}> 重置卡图缓存 </button>
    </div>
  </section>
</div>

<style>
  /* 基础变量与容器 - 继承 app.css 的设计系统 */
  .settings-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
    color: var(--text-primary);
  }

  .page-title {
    font-size: var(--text-2xl);
    font-weight: 700;
    margin: 0 0 24px 0;
    color: var(--text-primary);
  }

  /* 卡片样式 */
  .settings-card {
    background: var(--bg-secondary); /* #f7f7f5 */
    border: 1px solid var(--border-color); /* #cdcdcb */
    border-radius: var(--radius-lg); /* 10px */
    padding: 20px 24px;
    margin-bottom: 20px;
  }

  .card-title {
    font-size: var(--text-lg); /* 16px */
    font-weight: 600;
    margin: 0 0 16px 0;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 12px;
  }

  /* 设置项布局 */
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

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    margin-right: 24px;
  }

  .setting-label {
    font-size: var(--text-base); /* 14px */
    font-weight: 500;
    color: var(--text-primary);
  }

  .setting-desc {
    font-size: var(--text-sm); /* 12px */
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .file-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--text-xs); /* 11px */
    color: var(--text-tertiary);
    word-break: break-all;
    cursor: copy;
  }

  .version-tag {
    background: var(--bg-hover);
    padding: 4px 10px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  /* 状态文本颜色 - 适配 Notion 经典配色 */
  .status-text {
    font-weight: 500;
  }
  .text-success {
    color: #0f7b6c;
  } /* Notion 绿 */
  .text-warning {
    color: #d9730d;
  } /* Notion 橙 */
  .text-error {
    color: #e03e3e;
  } /* Notion 红 */

  /* 按钮基础样式 */
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.15s,
      border-color 0.15s;
    border: none;
    white-space: nowrap;
    line-height: 1.5;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /*
  .btn-primary {
    background: var(--accent-color);
    color: #ffffff;
  }
  .btn-primary:hover:not(:disabled) {
    background: #0e6b62;
  }*/

  .btn-secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-active);
  }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }
  .btn-outline:hover {
    background: var(--bg-hover);
    border-color: #aeaca6;
  }

  .btn-danger-outline {
    background: transparent;
    border: 1px solid #e03e3e;
    color: #e03e3e;
  }
  .btn-danger-outline:hover {
    background: rgba(224, 62, 62, 0.08);
  }

  /* 操作组 */
  /*.update-actions,*/
  .db-actions {
    margin-top: 16px;
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }

  /* Toggle 开关样式 - 精致化 Notion 风格 */
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
    background-color: var(--border-color); /* 关闭状态 */
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
    box-shadow: 0 1px 3px rgba(55, 53, 47, 0.2); /* 增加微阴影提升质感 */
  }

  input:checked + .slider {
    background-color: var(--accent-color); /* 激活状态使用主题色 */
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
