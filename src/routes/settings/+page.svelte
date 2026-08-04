<script lang="ts">
  import {
    getTableState,
    formatBytes,
    resetDatabase,
    initializeDatabase,
    getTableCounts,
    getTableSizes,
    getVersion as getDbVersion,
    getDecks,
    deleteAllDecks,
    cleanupDeckVersions,
    clearCardData,
    clearRules,
    clearIcons,
    clearFilterOptions,
    clearVersion,
    getDeckVersions,
    getDeckVersionCards,
    getDatabase,
    closeDatabase,
    importDecksFromJson,
    type ImportDeckPayload,
  } from '$lib/db'
  import { showForeignCardArt as showFCA, showTTSFeatures } from '$lib/stores/settings'
  import { CARD_IMAGE, clearLocalCache, getImageDirSize } from '$lib/services/image-cache-service'

  import {
    prepareCardImageDownload,
    startCardImageDownload,
    isCardImageDownloading,
  } from '$lib/services/card-image-download-service'
  import { appConfigDir, appLocalDataDir, join } from '@tauri-apps/api/path'
  import { copyFile, writeTextFile, readTextFile } from '$lib/services/db-file-service'
  import { onMount } from 'svelte'
  import { setLoadStatus } from '$lib/stores/ui-store.svelte'
  import { writeText } from '@tauri-apps/plugin-clipboard-manager'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { getVersion as getAppVersion } from '@tauri-apps/api/app'
  import { isMobile } from '$lib/utils/os'
  import { ask, message, open, save } from '@tauri-apps/plugin-dialog'
  import { beforeNavigate, goto } from '$app/navigation'
  import { Download, Upload, FileText, FileUp } from '@lucide/svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'

  // --- 状态管理 ---
  let appVersion = $state('1.0.0')
  let cardDataUpdateStatus = $state<'idle' | 'checking' | 'available' | 'upToDate' | 'error'>(
    'idle'
  )

  let dbSize = $state<string>('计算中...')
  let dbPath = $state<string>('加载中...')
  let dbFilePath = $state<string>('')
  let imagePath = $state<string>('加载中...')
  let imageCacheSize = $state<string>('计算中...')
  let inMobile = $state<boolean>(false)
  let onloadInfo = $state<boolean>(false)

  let lastSyncText = $state<string>('加载中...')
  let deckCount = $state<number>(0)
  let statRows = $state<{ label: string; count: number; size: string }[]>([])

  let showExportModal = $state(false)
  let exportMode = $state<'all' | 'latest'>('all')
  let exportDeckList = $state<
    { id: string; name: string; updatedAt: string; versionCount: number }[]
  >([])
  let selectedDeckIds = $state<string[]>([])
  let isExporting = $state(false)

  let showImportModal = $state(false)
  let importMode = $state<'all' | 'latest'>('all')
  let importFileName = $state('')
  let importDeckList = $state<
    { id: string; name: string; updatedAt: string; versionCount: number }[]
  >([])
  let selectedImportDeckIds = $state<string[]>([])
  let pendingImportDecks = $state<ImportDeckPayload[]>([])
  let isImporting = $state(false)

  // --- 常量 ---
  const HELP_DOC_URL =
    'https://wjp00vpskyvs.jp.larksuite.com/wiki/MeISwlCQeiiOK6kMxrujfVC2pcf?from=from_copylink'

  const TABLE_LABELS: Record<string, string> = {
    cards_base: '卡牌基础数据',
    card_prints: '卡图数据',
    decks: '卡组',
    deck_versions: '卡组版本',
    deck_cards: '卡组卡牌',
    rules: '规则',
    icons: '图标',
    filter_options: '筛选设置',
    version: '同步版本',
  }

  // --- 生命周期 ---
  onMount(async () => {
    inMobile = await isMobile()
    appVersion = await getAppVersion()
    await loadDbInfo()
  })

  // --- 逻辑函数 ---
  async function loadDbInfo() {
    onloadInfo = true
    try {
      const [db, base, configDir, counts, sizes, dbVersion] = await Promise.all([
        getTableState(),
        appLocalDataDir(),
        appConfigDir(),
        getTableCounts(),
        getTableSizes(),
        getDbVersion(),
      ])

      // 1. 计算 DB size
      let total = 0
      db?.forEach((d: any) => {
        total += d.bytes
      })
      dbSize = formatBytes(total)

      // 2. 图片路径
      imagePath = await join(base, CARD_IMAGE)

      // 3. db 路径（实际存储于 appConfigDir）
      dbFilePath = await join(configDir, 'tcg_cards.db')
      dbPath = dbFilePath

      // 4. 最后同步时间
      lastSyncText = dbVersion?.updated_at
        ? `${dbVersion.name ?? '数据'} · ${new Date(dbVersion.updated_at).toLocaleString()}`
        : '从未同步'

      // 5. 各表统计
      deckCount = counts.decks
      const sizeMap = new Map(sizes.map((s) => [s.name, s.bytes]))
      const countMap: Record<string, number> = {
        cards_base: counts.cards,
        card_prints: counts.prints,
        decks: counts.decks,
        deck_versions: counts.deckVersions,
        deck_cards: counts.deckCards,
        rules: counts.rules,
        icons: counts.icons,
      }
      statRows = Object.entries(TABLE_LABELS)
        .filter(([name]) => name !== 'version' && name !== 'filter_options')
        .map(([name, label]) => ({
          label,
          count: countMap[name] ?? 0,
          size: formatBytes(sizeMap.get(name) ?? 0),
        }))
      statRows.push({
        label: '筛选设置',
        count: counts.filterExists ? 1 : 0,
        size: formatBytes(sizeMap.get('filter_options') ?? 0),
      })
      statRows.push({
        label: '同步版本',
        count: dbVersion ? 1 : 0,
        size: formatBytes(sizeMap.get('version') ?? 0),
      })

      // 7. 卡图缓存大小
      const imageCacheSizeByte = await getImageDirSize()
      imageCacheSize = formatBytes(imageCacheSizeByte)
    } catch (e) {
      dbSize = '获取失败'
      imageCacheSize = '获取失败'
      dbPath = '获取失败'
      lastSyncText = '获取失败'
      console.log('[初始化失败]', e)
    } finally {
      onloadInfo = false
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case 'checking':
        return '正在检查更新...'
      case 'available':
        return '发现新版本可用'
      case 'upToDate':
        return '卡牌数据已是最新'
      case 'error':
        return '检查更新失败'
      default:
        return ''
    }
  }

  async function checkCardDataUpdate() {
    cardDataUpdateStatus = 'checking'
    try {
      setLoadStatus('syncing')
      await initializeDatabase()
      setLoadStatus('success')
      cardDataUpdateStatus = 'upToDate'
      await loadDbInfo()
    } catch (e) {
      cardDataUpdateStatus = 'error'
      setLoadStatus('error')
    }
  }

  async function handleResetDb() {
    const accpected = await ask(
      '确定要重置数据库吗？\n此操作会删除您的卡组数据，并重新初始化数据库连接。',
      {
        title: '重置数据库',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (accpected) {
      await resetDatabase()
      await loadDbInfo()
      message('数据库已成功重置！')
    }
  }

  function openHelpDoc() {
    openUrl(HELP_DOC_URL)
  }

  async function handleResetImageCache() {
    const accpected = await ask('确定要重置卡图缓存吗？\n此操作会删除您所有卡图缓存。', {
      title: '重置卡图缓存',
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })
    if (accpected) {
      clearLocalCache()
        .then(async () => {
          const imageCacheSizeByte = await getImageDirSize()
          imageCacheSize = formatBytes(imageCacheSizeByte)
          message('卡图缓存已清除')
        })
        .catch((e) => {
          setLoadStatus('error', '重置缓存失败', e instanceof Error ? e.message : '未知错误')
        })
    }
  }

  async function startDownloadAll() {
    if (isCardImageDownloading()) {
      return
    }

    try {
      const { missing } = await prepareCardImageDownload()

      if (missing.length === 0) {
        await message('所有卡牌资源已经存在，无需下载。', {
          title: '卡牌资源',
          kind: 'info',
        })

        return
      }

      const accepted = await ask(
        `为了下载大约${missing.length}张卡牌资源，本应用需要下载数据。如果您正在使用手机热点或移动网络，下载可能会消耗较多流量。\n\n是否继续执行？`,
        {
          title: '卡牌资源下载',
          kind: 'warning',
          okLabel: '确定',
          cancelLabel: '取消',
        }
      )

      if (!accepted) {
        return
      }

      startCardImageDownload(missing)
    } catch (error) {
      console.error('[Settings] 准备卡图下载失败:', error)

      await message(error instanceof Error ? error.message : '无法准备卡图下载任务。', {
        title: '卡牌资源下载',
        kind: 'error',
      })
    }
  }

  // --- 备份 / 恢复 / 导出 ---
  async function backupDatabase() {
    if (!dbFilePath) return

    const dest = await save({
      title: '选择备份保存位置',
      defaultPath: `rune-archive-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }],
    })
    if (!dest) return

    await closeDatabase()
    try {
      await copyFile(dbFilePath, dest)
      await message('数据库备份成功！', { title: '备份', kind: 'info' })
    } catch (e) {
      await message(e instanceof Error ? e.message : '备份失败', { title: '备份', kind: 'error' })
    } finally {
      await getDatabase()
      await loadDbInfo()
    }
  }

  async function restoreDatabase() {
    if (!dbFilePath) return

    const src = await open({
      title: '选择备份文件',
      multiple: false,
      filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }],
    })
    if (!src) return

    const confirmed = await ask(
      '恢复备份将覆盖当前全部本地数据（含卡组、卡牌、规则等）。\n确定要继续吗？',
      {
        title: '恢复备份',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (!confirmed) return

    await closeDatabase()
    try {
      await copyFile(String(src), dbFilePath)
      await message('数据库恢复成功！', { title: '恢复', kind: 'info' })
    } catch (e) {
      await message(e instanceof Error ? e.message : '恢复失败', { title: '恢复', kind: 'error' })
    } finally {
      await getDatabase()
      await loadDbInfo()
    }
  }

  function toggleDeck(id: string) {
    selectedDeckIds = selectedDeckIds.includes(id)
      ? selectedDeckIds.filter((d) => d !== id)
      : [...selectedDeckIds, id]
  }

  function toggleAllDecks() {
    selectedDeckIds =
      selectedDeckIds.length === exportDeckList.length ? [] : exportDeckList.map((d) => d.id)
  }

  async function openExportModal() {
    const decks = await getDecks()
    const versionCounts = new Map<string, number>()
    for (const deck of decks) {
      const versions = await getDeckVersions(deck.id)
      versionCounts.set(deck.id, versions.length)
    }
    exportDeckList = decks.map((d) => ({
      id: d.id,
      name: d.name,
      updatedAt: new Date(d.updated_at ?? Date.now()).toLocaleString(),
      versionCount: versionCounts.get(d.id) ?? 0,
    }))
    selectedDeckIds = exportDeckList.map((d) => d.id)
    exportMode = 'all'
    showExportModal = true
  }

  async function confirmExport() {
    if (selectedDeckIds.length === 0) return

    const dest = await save({
      title: '选择导出文件位置',
      defaultPath: `rune-archive-decks-${exportMode}-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    })
    if (!dest) return

    isExporting = true
    try {
      const data = {
        app: 'Rune Archive',
        type: 'decks-export',
        exportMode,
        exportedAt: new Date().toISOString(),
        decks: [] as unknown[],
      }

      const allDecks = await getDecks()
      for (const deck of allDecks) {
        if (!selectedDeckIds.includes(deck.id)) continue

        const versions = await getDeckVersions(deck.id)
        const versionCards = await getDeckVersionCards(deck.id)
        const cardsByVersion = new Map<string, typeof versionCards>()
        for (const card of versionCards) {
          const list = cardsByVersion.get(card.deck_version_id) ?? []
          list.push(card)
          cardsByVersion.set(card.deck_version_id, list)
        }

        let picked = versions.map((v) => ({
          ...v,
          cards: cardsByVersion.get(v.id) ?? [],
        }))
        if (exportMode === 'latest' && versions.length > 0) {
          const latest = versions[0]
          picked = [
            {
              ...latest,
              cards: cardsByVersion.get(latest.id) ?? [],
            },
          ]
        }

        data.decks.push({
          ...deck,
          versions: picked,
        })
      }

      await writeTextFile(dest, JSON.stringify(data, null, 2))
      await message(`已导出 ${data.decks.length} 副卡组！`, { title: '导出', kind: 'info' })
      showExportModal = false
    } catch (e) {
      await message(e instanceof Error ? e.message : '导出失败', { title: '导出', kind: 'error' })
    } finally {
      isExporting = false
    }
  }

  function parseImportFile(content: string): ImportDeckPayload[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return []
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).decks)) return []

    const decks: ImportDeckPayload[] = []
    for (const d of (parsed as any).decks) {
      if (!d || typeof d !== 'object' || !d.name) continue
      const versions = Array.isArray(d.versions) ? d.versions : []
      const cleanVersions = versions
        .filter((v: any) => v && typeof v.version_number === 'number')
        .map((v: any) => ({
          version_number: v.version_number,
          note: v.note ?? null,
          created_at: v.created_at ?? null,
          cards: (Array.isArray(v.cards) ? v.cards : [])
            .filter((c: any) => c && (c.card_id || c.print_code) && c.quantity > 0 && c.zone)
            .map((c: any) => ({
              card_id: c.card_id,
              print_code: c.print_code ?? null,
              quantity: c.quantity,
              zone: c.zone,
            })),
        }))

      decks.push({
        name: d.name,
        description: d.description ?? null,
        format: d.format ?? null,
        cover_image: d.cover_image ?? null,
        tags: Array.isArray(d.tags)
          ? d.tags.filter((t: any) => typeof t === 'string')
          : [],
        is_favorite: !!d.is_favorite,
        created_at: d.created_at ?? null,
        updated_at: d.updated_at ?? null,
        versions: cleanVersions,
      })
    }
    return decks
  }

  function toggleImportDeck(id: string) {
    selectedImportDeckIds = selectedImportDeckIds.includes(id)
      ? selectedImportDeckIds.filter((d) => d !== id)
      : [...selectedImportDeckIds, id]
  }

  function toggleAllImportDecks() {
    selectedImportDeckIds =
      selectedImportDeckIds.length === importDeckList.length ? [] : importDeckList.map((d) => d.id)
  }

  async function openImportModal() {
    const src = await open({
      title: '选择导出的 JSON 文件',
      multiple: false,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    })
    if (!src) return

    let content: string
    try {
      content = await readTextFile(String(src))
    } catch (e) {
      await message(e instanceof Error ? e.message : '读取文件失败', {
        title: '导入',
        kind: 'error',
      })
      return
    }

    const decks = parseImportFile(content)
    if (decks.length === 0) {
      await message('文件格式不正确或没有可导入的卡组，请选择 Rune Archive 导出的 JSON 文件。', {
        title: '导入',
        kind: 'error',
      })
      return
    }

    importFileName = String(src).split(/[\\/]/).pop() ?? String(src)
    importDeckList = decks.map((d, i) => ({
      id: String(i),
      name: d.name,
      updatedAt: d.updated_at ? new Date(d.updated_at).toLocaleString() : '未知',
      versionCount: d.versions.length,
    }))
    selectedImportDeckIds = importDeckList.map((d) => d.id)
    pendingImportDecks = decks
    importMode = 'all'
    showImportModal = true
  }

  async function confirmImport() {
    if (selectedImportDeckIds.length === 0) return

    isImporting = true
    try {
      const chosen = pendingImportDecks.filter((_, i) => selectedImportDeckIds.includes(String(i)))
      const { imported, missingCards } = await importDecksFromJson(chosen, {
        latestOnly: importMode === 'latest',
        filterMissingCards: true,
      })
      const missingText = missingCards > 0 ? `（跳过 ${missingCards} 张本地缺失的卡牌）` : ''
      await message(`已导入 ${imported} 副卡组${missingText}！`, { title: '导入', kind: 'info' })
      showImportModal = false
      await loadDbInfo()
    } catch (e) {
      await message(e instanceof Error ? e.message : '导入失败', { title: '导入', kind: 'error' })
    } finally {
      isImporting = false
    }
  }

  // --- 数据删除操作 ---
  async function clearAllDecksAsk() {
    const confirmed = await ask(
      `确定要清空所有卡组吗？\n当前共 ${deckCount} 副卡组，其版本与卡牌引用都将被删除。`,
      {
        title: '清空所有卡组',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (!confirmed) return

    await deleteAllDecks()
    await message('所有卡组已清空', { kind: 'info' })
    await loadDbInfo()
  }

  async function cleanupVersionsAsk() {
    const confirmed = await ask(
      '确定要清理冗余版本吗？\n每个卡组仅保留最新版本，其余历史版本及其卡牌引用将被删除。',
      {
        title: '清理冗余版本',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (!confirmed) return

    const deleted = await cleanupDeckVersions()
    await message(`已清理 ${deleted} 个冗余版本`, { kind: 'info' })
    await loadDbInfo()
  }

  async function clearCardDataAsk() {
    const confirmed = await ask(
      '确定要清空卡牌数据吗？\n此操作会删除所有卡牌基础数据与卡图（卡组将被保留），并清空筛选设置与同步标记。\n下次启动应用时将自动重新同步，卡组中的卡牌会重新关联。',
      {
        title: '清空卡牌数据',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (!confirmed) return

    await clearCardData()
    await message('卡牌数据已清空，下次启动将重新同步', { kind: 'info' })
    await loadDbInfo()
  }

  async function clearRulesAsk() {
    const confirmed = await ask('确定要清空规则数据吗？', {
      title: '清空规则数据',
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    await clearRules()
    await message('规则数据已清空', { kind: 'info' })
    await loadDbInfo()
  }

  async function clearIconsAsk() {
    const confirmed = await ask('确定要清空图标数据吗？', {
      title: '清空图标数据',
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    await clearIcons()
    await message('图标数据已清空', { kind: 'info' })
    await loadDbInfo()
  }

  async function clearFilterAsk() {
    const confirmed = await ask('确定要清空筛选设置吗？', {
      title: '清空筛选设置',
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    await clearFilterOptions()
    await message('筛选设置已清空', { kind: 'info' })
    await loadDbInfo()
  }

  async function resetSyncAsk() {
    const confirmed = await ask(
      '确定要重置同步状态吗？\n仅清除本地同步标记，不会删除任何数据。下次启动应用时将重新同步数据。',
      {
        title: '重置同步状态',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (!confirmed) return

    await clearVersion()
    await message('同步状态已重置', { kind: 'info' })
    await loadDbInfo()
  }

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0

    if (isBackward) {
      cancel()
      goto('/', { replaceState: true })
    }
  })
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
        class="button button-secondary"
        onclick={checkCardDataUpdate}
        disabled={cardDataUpdateStatus === 'checking'}
      >
        {cardDataUpdateStatus === 'checking' ? '检查中' : '检查更新'}
      </button>
    </div>
  </section>

  <!-- 3. 反馈与帮助 -->
  <section class="settings-card">
    <h2 class="card-title">反馈与帮助</h2>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">反馈文档</span>
        <span class="setting-desc">打开反馈页面，提交 Bug 或功能建议。</span>
      </div>
      <button class="button button-ghost" onclick={openHelpDoc}> 访问链接 ↗ </button>
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

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">最后同步时间</span>
        <span class="setting-desc">本地数据与远端数据的同步状态</span>
      </div>
      <span class="version-tag">{lastSyncText}</span>
    </div>

    <div class="stat-breakdown">
      {#each statRows as row}
        <div class="stat-row">
          <span class="stat-label">{row.label}</span>
          <span class="stat-value">{row.count} 条 · {row.size}</span>
        </div>
      {/each}
    </div>

    <div class="db-actions">
      <button class="button button-ghost" disabled={onloadInfo} onclick={backupDatabase}>
        <Download size={16} />
        备份数据库
      </button>
      <button class="button button-ghost" disabled={onloadInfo} onclick={restoreDatabase}>
        <Upload size={16} />
        恢复备份
      </button>
      <button
        class="button button-ghost"
        disabled={onloadInfo || deckCount === 0}
        onclick={openExportModal}
      >
        <FileText size={16} />
        导出全部卡组
      </button>
      <button class="button button-ghost" disabled={onloadInfo} onclick={openImportModal}>
        <FileUp size={16} />
        导入卡组
      </button>
      <button class="button button-danger-outline" disabled={onloadInfo} onclick={handleResetDb}>
        重置数据库
      </button>
    </div>
  </section>

  <!-- 5. 数据管理（删除） -->
  <section class="settings-card">
    <h2 class="card-title">数据管理</h2>

    <div class="manage-block-header">
      <span class="manage-block-title">批量删除</span>
      <span class="manage-block-desc">对全部本地数据执行删除操作</span>
    </div>

    <div class="manage-list">
      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">清空所有卡组</span>
          <span class="manage-desc">删除全部卡组及其版本与卡牌引用</span>
        </div>
        <button
          class="button button-danger-outline"
          disabled={deckCount === 0}
          onclick={clearAllDecksAsk}
        >
          清空
        </button>
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">清理冗余版本</span>
          <span class="manage-desc">每个卡组仅保留最新版本，删除历史版本</span>
        </div>
        <button class="button button-ghost" onclick={cleanupVersionsAsk}>清理</button>
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">清空卡牌数据</span>
          <span class="manage-desc">删除卡牌与卡图，并同时清空卡组、筛选与同步标记</span>
        </div>
        <button class="button button-danger-outline" onclick={clearCardDataAsk}>清空</button>
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">清空规则数据</span>
          <span class="manage-desc">删除所有规则文档内容</span>
        </div>
        <button class="button button-danger-outline" onclick={clearRulesAsk}>清空</button>
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">清空图标数据</span>
          <span class="manage-desc">删除所有卡牌图标信息</span>
        </div>
        <button class="button button-danger-outline" onclick={clearIconsAsk}>清空</button>
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">清空筛选设置</span>
          <span class="manage-desc">删除保存的筛选选项</span>
        </div>
        <button class="button button-danger-outline" onclick={clearFilterAsk}>清空</button>
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">重置同步状态</span>
          <span class="manage-desc">清除本地同步标记，下次启动自动重新同步</span>
        </div>
        <button class="button button-ghost" onclick={resetSyncAsk}>重置</button>
      </div>
    </div>
  </section>

  <!-- 6. 本地图片 -->
  <section class="settings-card">
    <h2 class="card-title">本地卡图缓存</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">卡牌资源下载</span>
        <span class="setting-desc">下载所有中文卡图作为缓存</span>
      </div>
      <button class="button button-ghost" onclick={startDownloadAll}> 开始下载 </button>
    </div>

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
      <button
        class="button button-danger-outline"
        disabled={onloadInfo}
        onclick={handleResetImageCache}
      >
        重置卡图缓存
      </button>
    </div>
  </section>

  <CommonModal
    open={showExportModal}
    title="导出卡组"
    subtitle="选择要导出的卡组与版本范围"
    closable={!isExporting}
    onclose={() => (showExportModal = false)}
  >
    <div class="export-mode-row">
      <span class="export-mode-label">版本范围</span>
      <div class="export-mode-group">
        <button
          class="button button-ghost"
          class:export-mode-active={exportMode === 'all'}
          disabled={isExporting}
          onclick={() => (exportMode = 'all')}
        >
          所有版本
        </button>
        <button
          class="button button-ghost"
          class:export-mode-active={exportMode === 'latest'}
          disabled={isExporting}
          onclick={() => (exportMode = 'latest')}
        >
          仅最新版本
        </button>
      </div>
    </div>

    <label class="export-select-all">
      <input
        type="checkbox"
        checked={selectedDeckIds.length === exportDeckList.length && exportDeckList.length > 0}
        onchange={toggleAllDecks}
        disabled={isExporting}
      />
      <span>全选（{exportDeckList.length} 副卡组）</span>
    </label>

    <div class="export-deck-list">
      {#each exportDeckList as deck}
        <label class="export-deck-row">
          <input
            type="checkbox"
            checked={selectedDeckIds.includes(deck.id)}
            onchange={() => toggleDeck(deck.id)}
            disabled={isExporting}
          />
          <span class="export-deck-info">
            <span class="export-deck-name">{deck.name}</span>
            <span class="export-deck-meta">
              {deck.versionCount} 个版本 · {deck.updatedAt}
            </span>
          </span>
        </label>
      {/each}
      {#if exportDeckList.length === 0}
        <div class="export-deck-empty">暂无卡组可导出</div>
      {/if}
    </div>

    {#snippet footer()}
      <button
        class="button button-ghost"
        disabled={isExporting}
        onclick={() => (showExportModal = false)}
      >
        取消
      </button>
      <button
        class="button button-primary"
        disabled={isExporting || selectedDeckIds.length === 0}
        onclick={confirmExport}
      >
        {isExporting ? '导出中...' : `导出 ${selectedDeckIds.length} 副卡组`}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={showImportModal}
    title="导入卡组"
    subtitle={importFileName ? `文件：${importFileName}` : ''}
    closable={!isImporting}
    onclose={() => (showImportModal = false)}
  >
    <div class="export-mode-row">
      <span class="export-mode-label">版本范围</span>
      <div class="export-mode-group">
        <button
          class="button button-ghost"
          class:export-mode-active={importMode === 'all'}
          disabled={isImporting}
          onclick={() => (importMode = 'all')}
        >
          所有版本
        </button>
        <button
          class="button button-ghost"
          class:export-mode-active={importMode === 'latest'}
          disabled={isImporting}
          onclick={() => (importMode = 'latest')}
        >
          仅最新版本
        </button>
      </div>
    </div>

    <label class="export-select-all">
      <input
        type="checkbox"
        checked={selectedImportDeckIds.length === importDeckList.length &&
          importDeckList.length > 0}
        onchange={toggleAllImportDecks}
        disabled={isImporting}
      />
      <span>全选（{importDeckList.length} 副卡组）</span>
    </label>

    <div class="export-deck-list">
      {#each importDeckList as deck}
        <label class="export-deck-row">
          <input
            type="checkbox"
            checked={selectedImportDeckIds.includes(deck.id)}
            onchange={() => toggleImportDeck(deck.id)}
            disabled={isImporting}
          />
          <span class="export-deck-info">
            <span class="export-deck-name">{deck.name}</span>
            <span class="export-deck-meta">
              {deck.versionCount} 个版本 · {deck.updatedAt}
            </span>
          </span>
        </label>
      {/each}
      {#if importDeckList.length === 0}
        <div class="export-deck-empty">文件中没有可导入的卡组</div>
      {/if}
    </div>

    {#snippet footer()}
      <button
        class="button button-ghost"
        disabled={isImporting}
        onclick={() => (showImportModal = false)}
      >
        取消
      </button>
      <button
        class="button button-primary"
        disabled={isImporting || selectedImportDeckIds.length === 0}
        onclick={confirmImport}
      >
        {isImporting ? '导入中...' : `导入 ${selectedImportDeckIds.length} 副卡组`}
      </button>
    {/snippet}
  </CommonModal>
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
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .file-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--text-xs);
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
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  /* 操作组 */
  .db-actions {
    margin-top: 16px;
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  /* 各表统计明细 */
  .stat-breakdown {
    margin-top: 12px;
    border: 1px solid rgba(205, 205, 203, 0.6);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    font-size: var(--text-sm);
  }

  .stat-row + .stat-row {
    border-top: 1px solid rgba(205, 205, 203, 0.4);
  }

  .stat-label {
    color: var(--text-secondary);
  }

  .stat-value {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  /* 数据管理 */
  .manage-block-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 0;
  }

  .manage-block-title {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .manage-block-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .manage-list {
    display: flex;
    flex-direction: column;
  }

  .manage-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid rgba(205, 205, 203, 0.6);
  }

  .manage-row:last-child {
    border-bottom: none;
  }

  .manage-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .manage-title {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .manage-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.4;
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

  /* 导出卡组弹窗 */
  .export-mode-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .export-mode-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .export-mode-group {
    display: flex;
    gap: 8px;
  }

  .export-mode-group .button.export-mode-active {
    background: var(--accent-color);
    color: #fff;
    border-color: var(--accent-color);
  }

  .export-select-all {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(205, 205, 203, 0.6);
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .export-select-all input,
  .export-deck-row input {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .export-deck-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 320px;
    overflow-y: auto;
  }

  .export-deck-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 6px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .export-deck-row:hover {
    background: var(--bg-hover);
  }

  .export-deck-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .export-deck-name {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .export-deck-meta {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .export-deck-empty {
    padding: 16px 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  @media (max-width: 767.99px) {
    .settings-container {
      padding: 24px 16px 80px;
    }
  }
</style>
