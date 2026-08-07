<script lang="ts">
  import {
    formatBytes,
    DB_NAME,
    resetDatabase,
    initializeDatabase,
    getDbStats,
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
    getMatchesByDeck,
    getDatabase,
    closeDatabase,
    importDecksFromJson,
    getCustomLanguages,
    addCustomLanguage,
    renameCustomLanguage,
    deleteCustomLanguage,
    PRESET_LANGUAGE_CODES,
    type CustomLanguage,
    type ImportDeckPayload,
    type ImportMatchPayload,
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
  import { setLoadStatus, setTopbar, downloadState } from '$lib/stores/ui-store.svelte'
  import { writeText } from '@tauri-apps/plugin-clipboard-manager'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { getVersion as getAppVersion } from '@tauri-apps/api/app'
  import { isMobile } from '$lib/utils/os'
  import { ask, message, open, save } from '@tauri-apps/plugin-dialog'
  import { beforeNavigate, goto } from '$app/navigation'
  import { Download, Upload, FileText, FileUp } from '@lucide/svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import LoadingModal from '$lib/components/ui/LoadingModal.svelte'

  // --- 状态管理 ---
  let appVersion = $state('1.0.0')
  let cardDataUpdateStatus = $state<'idle' | 'checking' | 'upToDate' | 'error'>('idle')
  let busyText = $state('')

  let dbSize = $state<string>('计算中...')
  let dbPath = $state<string>('加载中...')
  let dbFilePath = $state<string>('')
  let imagePath = $state<string>('加载中...')
  let imageCacheSize = $state<string>('计算中...')
  let imageCoverage = $state<{
    existingCount: number
    totalCount: number
    missingCount: number
  } | null>(null)
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

  // --- 自定义语言 ---
  let customLangs = $state<CustomLanguage[]>([])
  let newLangCode = $state('')
  let newLangName = $state('')
  let editingCode = $state('')
  let editingName = $state('')
  let langMsg = $state('')
  let langMsgError = $state(false)

  // --- 常量 ---
  const HELP_DOC_URL =
    'https://wjp00vpskyvs.jp.larksuite.com/wiki/MeISwlCQeiiOK6kMxrujfVC2pcf?from=from_copylink'

  // --- 生命周期 ---
  onMount(async () => {
    inMobile = await isMobile()
    appVersion = await getAppVersion()
    await loadDbInfo()
    await loadImageCoverage()
    await loadCustomLangs()
  })

  // 下载结束后刷新缓存覆盖统计
  $effect(() => {
    if (downloadState.active && downloadState.status !== 'downloading') {
      loadImageCoverage()
    }
  })

  async function loadImageCoverage() {
    try {
      const { missing, existingCount, totalCount } = await prepareCardImageDownload()
      imageCoverage = { existingCount, totalCount, missingCount: missing.length }
    } catch (error) {
      console.error('[Settings] 读取卡图覆盖统计失败:', error)
    }
  }

  // --- 逻辑函数 ---
  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
    busyText = label
    try {
      return await fn()
    } finally {
      busyText = ''
    }
  }

  async function loadDbInfo() {
    onloadInfo = true
    try {
      const [stats, base, configDir, dbVersion] = await Promise.all([
        getDbStats(),
        appLocalDataDir(),
        appConfigDir(),
        getDbVersion(),
      ])

      // 1. 计算 DB size（文件真实大小）
      dbSize = formatBytes(stats.totalBytes)

      // 2. 图片路径
      imagePath = await join(base, CARD_IMAGE)

      // 3. db 路径（实际存储于 appConfigDir，文件名由 DB_NAME 派生）
      const dbFileName = DB_NAME.replace(/^sqlite:/, '')
      dbFilePath = await join(configDir, dbFileName)
      dbPath = dbFilePath

      // 4. 最后同步时间
      lastSyncText = dbVersion?.updated_at
        ? `${dbVersion.name ?? '数据'} · ${new Date(dbVersion.updated_at).toLocaleString()}`
        : '从未同步'

      // 5. 各表统计
      const rows = stats.tables.map((t) => ({
        label: t.label,
        count: t.count,
        size: formatBytes(t.bytes),
      }))
      const tableBytes = stats.tables.reduce((sum, t) => sum + t.bytes, 0)
      const residual = stats.totalBytes - tableBytes
      if (residual > 0) {
        rows.push({
          label: '其他（空闲/系统页）',
          count: 0,
          size: formatBytes(residual),
        })
      }
      statRows = rows
      deckCount = stats.tables.find((t) => t.name === 'decks')?.count ?? 0

      // 6. 卡图缓存大小
      const imageCacheSizeByte = await getImageDirSize()
      imageCacheSize = formatBytes(imageCacheSizeByte)
    } catch (e) {
      dbSize = '获取失败'
      imageCacheSize = '获取失败'
      dbPath = '获取失败'
      lastSyncText = '获取失败'
      console.error('[初始化失败]', e)
    } finally {
      onloadInfo = false
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case 'checking':
        return '正在检查更新...'
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
      '确定要重置数据库吗？\n此操作会删除全部本地数据（卡组、卡牌、规则、收藏等）并重新初始化。',
      {
        title: '重置数据库',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (accpected) {
      await withBusy('正在重置数据库...', async () => {
        await resetDatabase()
        await loadDbInfo()
      })
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
      try {
        await withBusy('正在清空卡图缓存...', async () => {
          await clearLocalCache()
          const imageCacheSizeByte = await getImageDirSize()
          imageCacheSize = formatBytes(imageCacheSizeByte)
        })
        await message('卡图缓存已清除')
      } catch (e) {
        setLoadStatus('error', '重置缓存失败', e instanceof Error ? e.message : '未知错误')
      }
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

    try {
      await withBusy('正在备份数据库...', async () => {
        await closeDatabase()
        try {
          await copyFile(dbFilePath, dest)
        } finally {
          await getDatabase()
          await loadDbInfo()
        }
      })
      await message('数据库备份成功！', { title: '备份', kind: 'info' })
    } catch (e) {
      await message(e instanceof Error ? e.message : '备份失败', { title: '备份', kind: 'error' })
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

    try {
      await withBusy('正在恢复数据库...', async () => {
        await closeDatabase()
        try {
          await copyFile(String(src), dbFilePath)
        } finally {
          await getDatabase()
          await loadDbInfo()
        }
      })
      await message('数据库恢复成功！', { title: '恢复', kind: 'info' })
    } catch (e) {
      await message(e instanceof Error ? e.message : '恢复失败', { title: '恢复', kind: 'error' })
    }
  }

  function toggleSelection(list: string[], id: string, setter: (next: string[]) => void) {
    setter(list.includes(id) ? list.filter((d) => d !== id) : [...list, id])
  }

  function toggleAll(list: string[], allIds: string[], setter: (next: string[]) => void) {
    setter(list.length === allIds.length ? [] : [...allIds])
  }

  function toggleDeck(id: string) {
    toggleSelection(selectedDeckIds, id, (next) => (selectedDeckIds = next))
  }

  function toggleAllDecks() {
    toggleAll(selectedDeckIds, exportDeckList.map((d) => d.id), (next) => (selectedDeckIds = next))
  }

  async function openExportModal() {
    const decks = await getDecks()
    const counts = await Promise.all(
      decks.map(async (d) => [d.id, (await getDeckVersions(d.id)).length] as const)
    )
    const versionCounts = new Map<string, number>(counts)
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
        matchRecords: true,
        decks: [] as unknown[],
      }

      await withBusy('正在导出卡组...', async () => {
        const allDecks = await getDecks()
        const jobs = allDecks
          .filter((deck) => selectedDeckIds.includes(deck.id))
          .map(async (deck) => {
            const [versions, versionCards, matches] = await Promise.all([
              getDeckVersions(deck.id),
              getDeckVersionCards(deck.id),
              getMatchesByDeck(deck.id),
            ])
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

            return {
              deck,
              versions: picked,
              matches,
            }
          })
        const results = await Promise.all(jobs)
        for (const { deck, versions, matches } of results) {
          data.decks.push({
            ...deck,
            versions,
            matches: matches.map((m) => ({
              group_name: m.group_name,
              opponent_name: m.opponent_name,
              opponent_deck: m.opponent_deck,
              opp_legend_id: m.opp_legend_id,
              opp_legend_print_id: m.opp_legend_print_id,
              opp_legend_name: m.opp_legend_name,
              opp_legend_image: m.opp_legend_image,
              deck_version_id: m.deck_version_id,
              deck_version_number: m.deck_version_number,
              best_of: m.best_of,
              note: m.note,
              played_at: m.played_at,
              created_at: m.created_at,
              updated_at: m.updated_at,
              games: m.games.map((g) => ({
                game_number: g.game_number,
                my_score: g.my_score,
                opp_score: g.opp_score,
                win_type: g.win_type,
                is_win: g.is_win,
                is_first: g.is_first,
                win_reason: g.win_reason,
                log: g.log,
              })),
            })),
          })
        }
        await writeTextFile(dest, JSON.stringify(data, null, 2))
      })
      await message(`已导出 ${data.decks.length} 副卡组！`, { title: '导出', kind: 'info' })
      showExportModal = false
    } catch (e) {
      await message(e instanceof Error ? e.message : '导出失败', { title: '导出', kind: 'error' })
    } finally {
      isExporting = false
    }
  }

  function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
  }

  function asNullableString(v: unknown): string | null {
    return typeof v === 'string' ? v : null
  }

  function asNullableNumber(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  function parseImportFile(content: string): ImportDeckPayload[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return []
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.decks)) return []

    const decks: ImportDeckPayload[] = []
    for (const raw of parsed.decks) {
      if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name) continue
      const d = raw

      const versions: ImportDeckPayload['versions'] = []
      if (Array.isArray(d.versions)) {
        for (const rawVersion of d.versions) {
          if (!isRecord(rawVersion) || typeof rawVersion.version_number !== 'number') continue
          const cards: ImportDeckPayload['versions'][number]['cards'] = []
          if (Array.isArray(rawVersion.cards)) {
            for (const rawCard of rawVersion.cards) {
              if (!isRecord(rawCard)) continue
              const cardId = typeof rawCard.card_id === 'string' ? rawCard.card_id : null
              const printCode = typeof rawCard.print_code === 'string' ? rawCard.print_code : null
              if (
                (!cardId && !printCode) ||
                typeof rawCard.quantity !== 'number' ||
                rawCard.quantity <= 0 ||
                typeof rawCard.zone !== 'string' ||
                !rawCard.zone
              ) {
                continue
              }
              cards.push({
                card_id: cardId ?? '',
                print_code: printCode,
                quantity: rawCard.quantity,
                zone: rawCard.zone,
              })
            }
          }
          versions.push({
            version_number: rawVersion.version_number,
            note: asNullableString(rawVersion.note),
            created_at: asNullableString(rawVersion.created_at),
            cards,
          })
        }
      }

      const matches: ImportMatchPayload[] = []
      if (Array.isArray(d.matches)) {
        for (const rawMatch of d.matches) {
          if (!isRecord(rawMatch) || !Array.isArray(rawMatch.games) || rawMatch.games.length === 0)
            continue
          const games: ImportMatchPayload['games'] = []
          for (const rawGame of rawMatch.games) {
            if (!isRecord(rawGame) || typeof rawGame.game_number !== 'number') continue
            const rawFirst = rawGame.is_first
            games.push({
              game_number: rawGame.game_number,
              my_score: asNullableNumber(rawGame.my_score),
              opp_score: asNullableNumber(rawGame.opp_score),
              win_type: (typeof rawGame.win_type === 'string'
                ? rawGame.win_type
                : 'normal') as ImportMatchPayload['games'][number]['win_type'],
              is_win: Boolean(rawGame.is_win),
              is_first:
                rawFirst === true || rawFirst === 1
                  ? true
                  : rawFirst === false || rawFirst === 0
                    ? false
                    : null,
              win_reason: asNullableString(rawGame.win_reason),
              log: asNullableString(rawGame.log),
            })
          }
          if (games.length === 0) continue
          matches.push({
            group_name: asNullableString(rawMatch.group_name),
            opponent_name: asNullableString(rawMatch.opponent_name),
            opponent_deck: asNullableString(rawMatch.opponent_deck),
            opp_legend_id: asNullableString(rawMatch.opp_legend_id),
            opp_legend_print_id: asNullableString(rawMatch.opp_legend_print_id),
            opp_legend_name: asNullableString(rawMatch.opp_legend_name),
            opp_legend_image: asNullableString(rawMatch.opp_legend_image),
            deck_version_id: asNullableString(rawMatch.deck_version_id),
            deck_version_number: asNullableNumber(rawMatch.deck_version_number),
            best_of: asNullableNumber(rawMatch.best_of),
            note: asNullableString(rawMatch.note),
            played_at: asNullableString(rawMatch.played_at),
            created_at: asNullableString(rawMatch.created_at),
            updated_at: asNullableString(rawMatch.updated_at),
            games,
          })
        }
      }

      decks.push({
        name: raw.name,
        description: asNullableString(d.description),
        format: asNullableString(d.format),
        cover_image: asNullableString(d.cover_image),
        tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : [],
        is_favorite: Boolean(d.is_favorite),
        created_at: asNullableString(d.created_at),
        updated_at: asNullableString(d.updated_at),
        versions,
        matches,
      })
    }
    return decks
  }

  function toggleImportDeck(id: string) {
    toggleSelection(selectedImportDeckIds, id, (next) => (selectedImportDeckIds = next))
  }

  function toggleAllImportDecks() {
    toggleAll(selectedImportDeckIds, importDeckList.map((d) => d.id), (next) => {
      selectedImportDeckIds = next
    })
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
      content = await withBusy('正在读取并解析文件...', async () => readTextFile(String(src)))
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
    importDeckList = decks.map((d) => ({
      id: d.name,
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
      const chosen = pendingImportDecks.filter((p) => selectedImportDeckIds.includes(p.name))
      const { imported, missingCards } = await withBusy('正在导入卡组...', () =>
        importDecksFromJson(chosen, {
          latestOnly: importMode === 'latest',
          filterMissingCards: true,
        })
      )
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
  async function confirmAndRun(
    title: string,
    desc: string,
    action: () => Promise<unknown>,
    successMsg?: string
  ) {
    const confirmed = await ask(desc, {
      title,
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })
    if (!confirmed) return

    try {
      await withBusy(`正在${title}...`, action)
    } catch (e) {
      await message(e instanceof Error ? e.message : `${title}失败`, {
        title,
        kind: 'error',
      })
      return
    }
    if (successMsg) await message(successMsg, { kind: 'info' })
    await loadDbInfo()
  }

  function clearAllDecksAsk() {
    return confirmAndRun(
      '清空所有卡组',
      `确定要清空所有卡组吗？\n当前共 ${deckCount} 副卡组，其版本与卡牌引用都将被删除。`,
      () => deleteAllDecks(),
      '所有卡组已清空'
    )
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

    const deleted = await withBusy('正在清理冗余版本...', () => cleanupDeckVersions())
    await message(`已清理 ${deleted} 个冗余版本`, { kind: 'info' })
    await loadDbInfo()
  }

  async function clearCardDataAsk() {
    const confirmed = await ask(
      '确定要清空卡牌数据吗？\n此操作会删除卡牌基础数据与卡图，并清空筛选设置与同步标记（卡组与收藏将保留）。\n下次同步将重新拉取数据。',
      {
        title: '清空卡牌数据',
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '取消',
      }
    )
    if (!confirmed) return

    await withBusy('正在清空卡牌数据...', () => clearCardData())
    await message('卡牌数据已清空，下次同步将重新拉取', { kind: 'info' })
    await loadDbInfo()
  }

  function clearRulesAsk() {
    return confirmAndRun(
      '清空规则数据',
      '确定要清空规则数据吗？',
      () => clearRules(),
      '规则数据已清空'
    )
  }

  function clearIconsAsk() {
    return confirmAndRun(
      '清空图标数据',
      '确定要清空图标数据吗？',
      () => clearIcons(),
      '图标数据已清空'
    )
  }

  function clearFilterAsk() {
    return confirmAndRun(
      '清空筛选设置',
      '确定要清空筛选设置吗？',
      () => clearFilterOptions(),
      '筛选设置已清空'
    )
  }

  function resetSyncAsk() {
    return confirmAndRun(
      '重置同步状态',
      '确定要重置同步状态吗？\n仅清除本地同步标记，不会删除任何数据。下次启动应用时将重新同步数据。',
      () => clearVersion(),
      '同步状态已重置'
    )
  }

  // --- 自定义语言管理 ---
  async function loadCustomLangs() {
    customLangs = await getCustomLanguages()
  }

  async function addLang() {
    langMsg = ''
    langMsgError = false
    try {
      await addCustomLanguage(newLangCode, newLangName)
      newLangCode = ''
      newLangName = ''
      await loadCustomLangs()
      langMsg = '已添加自定义语言'
    } catch (e) {
      langMsgError = true
      langMsg = e instanceof Error ? e.message : '添加失败'
    }
  }

  function startEdit(lang: CustomLanguage) {
    editingCode = lang.code
    editingName = lang.name
  }

  async function saveRename(code: string) {
    langMsg = ''
    langMsgError = false
    try {
      await renameCustomLanguage(code, editingName)
      editingCode = ''
      await loadCustomLangs()
      langMsg = '已重命名'
    } catch (e) {
      langMsgError = true
      langMsg = e instanceof Error ? e.message : '重命名失败'
    }
  }

  async function removeLang(code: string) {
    langMsg = ''
    langMsgError = false
    const confirmed = await ask(`确定删除自定义语言 ${code} 吗？`, {
      title: '删除自定义语言',
      kind: 'warning',
      okLabel: '删除',
      cancelLabel: '取消',
    })
    if (!confirmed) return
    try {
      await deleteCustomLanguage(code)
      await loadCustomLangs()
      langMsg = '已删除'
    } catch (e) {
      langMsgError = true
      langMsg = e instanceof Error ? e.message : '删除失败'
    }
  }

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0

    if (isBackward) {
      cancel()
      goto('/', { replaceState: true })
    }
  })

  $effect(() => {
    setTopbar({ title: '设置' })
  })
</script>

<div class="settings-container">
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
          <span class="manage-desc">删除卡牌基础数据与卡图，并清空筛选与同步标记（卡组与收藏保留），下次同步重新拉取。</span>
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
        <span class="setting-label">缓存覆盖</span>
        <span class="setting-desc">
          本地已缓存 {imageCoverage?.existingCount ?? '-'} / {imageCoverage?.totalCount ?? '-'} 张卡图
          {#if imageCoverage && imageCoverage.totalCount > 0}
            （{Math.round((imageCoverage.existingCount / imageCoverage.totalCount) * 100)}%）
          {/if}
        </span>
      </div>
      {#if imageCoverage && imageCoverage.totalCount > 0}
        <div class="coverage-bar">
          <div
            class="coverage-fill"
            style={`width: ${(imageCoverage.existingCount / imageCoverage.totalCount) * 100}%`}
          ></div>
        </div>
      {/if}
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">卡牌资源下载</span>
        <span class="setting-desc">下载所有缺失的中文卡图作为缓存</span>
      </div>
      {#if isCardImageDownloading()}
        <button class="button button-primary" disabled>
          下载中 {Math.round((downloadState.completed / downloadState.total) * 100)}%...
        </button>
      {:else}
        <button
          class="button button-primary"
          disabled={!imageCoverage || imageCoverage.missingCount === 0}
          onclick={startDownloadAll}
        >
          {#if imageCoverage && imageCoverage.missingCount === 0}
            已是最新 ✓
          {:else if imageCoverage}
            下载全部卡图（{imageCoverage.missingCount} 张）
          {:else}
            开始下载
          {/if}
        </button>
      {/if}
    </div>

    {#if isCardImageDownloading()}
      <p class="download-hint">正在后台下载，窗口底部有实时进度条，可随时取消。</p>
    {/if}

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

  <!-- 7. 自定义语言 -->
  <section class="settings-card">
    <h2 class="card-title">自定义语言</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">预设语言</span>
        <span class="setting-desc">
          {PRESET_LANGUAGE_CODES.join(' / ')}。收藏中的语言使用标准语言码，预设之外的语言可在此添加。
        </span>
      </div>
    </div>

    <div class="add-lang-row">
      <input
        class="settings-input lang-code-input"
        bind:value={newLangCode}
        placeholder="语言码，如 DE（2-6 位大写字母/数字）"
      />
      <input class="settings-input" bind:value={newLangName} placeholder="显示名，如 法语" />
      <button class="button button-primary" onclick={addLang}>添加</button>
    </div>

    {#if langMsg}
      <div class="lang-msg" class:lang-msg-error={langMsgError}>{langMsg}</div>
    {/if}

    {#if customLangs.length === 0}
      <div class="lang-empty">暂无自定义语言</div>
    {:else}
      <div class="manage-list">
        {#each customLangs as lang (lang.code)}
          <div class="manage-row">
            <div class="manage-info">
              <span class="manage-title">{lang.code}</span>
              <span class="manage-desc">
                {#if editingCode === lang.code}
                  <input class="settings-input" bind:value={editingName} placeholder="语言名称" />
                {:else}
                  {lang.name}
                {/if}
              </span>
            </div>
            <div class="lang-actions">
              {#if editingCode === lang.code}
                <button class="button button-ghost" onclick={() => saveRename(lang.code)}>
                  保存
                </button>
                <button
                  class="button button-ghost"
                  onclick={() => {
                    editingCode = ''
                  }}
                >
                  取消
                </button>
              {:else}
                <button class="button button-ghost" onclick={() => startEdit(lang)}>
                  重命名
                </button>
                <button class="button button-danger-outline" onclick={() => removeLang(lang.code)}>
                  删除
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
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
      {#each importDeckList as deck (deck.id)}
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

  {#if busyText}
    <LoadingModal status="syncing" text={busyText} subtext="请稍候，正在处理..." />
  {/if}
</div>

<style>
  /* 基础变量与容器 - 继承 app.css 的设计系统 */
  .settings-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
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

  .coverage-bar {
    flex: 0 0 auto;
    width: 120px;
    height: 8px;
    margin-left: 16px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--bg-hover);
  }

  .coverage-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent-color);
    transition: width 0.3s ease;
  }

  .download-hint {
    margin: 2px 0 12px;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--accent-color) 8%, white);
    font-size: var(--text-sm);
    color: var(--text-secondary);
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

  /* 自定义语言 */
  .add-lang-row {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    flex-wrap: wrap;
  }

  .settings-input {
    flex: 1;
    min-width: 160px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .lang-code-input {
    flex: 0 1 220px;
  }

  .lang-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .lang-msg {
    font-size: var(--text-sm);
    color: #0f7b6c;
    padding: 4px 0;
  }

  .lang-msg-error {
    color: #e03e3e;
  }

  .lang-empty {
    padding: 12px 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
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
