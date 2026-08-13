<script lang="ts">
  import {
    formatBytes,
    DB_NAME,
    resetDatabase,
    initializeDatabase,
    getDbStats,
    getTableRows,
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
    clearHistory,
    captureCollectionSnapshot,
    type CustomLanguage,
    type ImportDeckPayload,
    type ImportMatchPayload,
  } from '$lib/db'
  import {
    showForeignCardArt as showFCA,
    showTTSFeatures,
    playerName,
    darkMode,
    locale,
    defaultLanguage,
    revertLayout,
    builderShowAllZones,
    builderZoneDisplayModes,
    builderGraphicColumns,
    builderMainDeckDisplayMode,
    builderSideboardDisplayMode,
  } from '$lib/stores/settings'
  import { SUPPORTED_LOCALES } from '$lib/i18n'
  import { ZONE_CONFIG, type ZoneKey } from '$lib/decks/zone'
  import { CARD_IMAGE, clearLocalCache, getImageDirSize } from '$lib/services/image-cache-service'

  import {
    prepareCardImageDownload,
    startCardImageDownload,
    isCardImageDownloading,
  } from '$lib/services/card-image-download-service'
  import { appConfigDir, appLocalDataDir, join } from '@tauri-apps/api/path'
  import { copyFile, writeTextFile, readTextFile } from '$lib/services/db-file-service'
  import { onMount } from 'svelte'
  import { setLoadStatus, setTopbar, downloadState, showToast } from '$lib/stores/ui-store.svelte'
  import { getNetworkStatus } from '$lib/stores/network.svelte'
  import { writeText } from '@tauri-apps/plugin-clipboard-manager'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { getVersion as getAppVersion } from '@tauri-apps/api/app'
  import { isMobile } from '$lib/utils/os'
  import { ask, message, open, save } from '@tauri-apps/plugin-dialog'
  import { beforeNavigate, goto } from '$app/navigation'
  import { Download, Upload, FileText, FileUp, ChevronRight } from '@lucide/svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import LoadingModal from '$lib/components/ui/LoadingModal.svelte'
  import { get } from 'svelte/store'
  import { t } from 'svelte-i18n'

  // --- 状态管理 ---
  let appVersion = $state('1.0.0')
  let cardDataUpdateStatus = $state<'idle' | 'checking' | 'upToDate' | 'error'>('idle')
  let busyText = $state('')

  let dbSize = $state<string>(get(t)('common.calculating'))
  let dbPath = $state<string>(get(t)('common.loading'))
  let dbFilePath = $state<string>('')
  let imagePath = $state<string>(get(t)('common.loading'))
  let imageCacheSize = $state<string>(get(t)('common.calculating'))
  let imageCoverage = $state<{
    existingCount: number
    totalCount: number
    missingCount: number
  } | null>(null)
  let inMobile = $state<boolean>(false)
  let onloadInfo = $state<boolean>(false)
  let imageInfoLoading = $state<boolean>(false)
  let showStats = $state<boolean>(false)

  let showTableModal = $state(false)
  let tableLoading = $state(false)
  let tableModal = $state<{
    name: string
    label: string
    rows: Record<string, unknown>[]
    total: number
  } | null>(null)

  let showBuilderZoneModes = $state(false)
  const builderZoneKeys: ZoneKey[] = [
    'legend',
    'champion',
    'mainDeck',
    'battlefields',
    'runes',
    'sideboard',
  ]
  const builderGlobalMode = $derived.by(() => {
    const modes = Object.values($builderZoneDisplayModes)
    return modes.every((m) => m === modes[0]) ? modes[0] : 'text'
  })

  function setBuilderGlobalMode(mode: 'text' | 'graphic') {
    const next: Record<ZoneKey, 'text' | 'graphic'> = { ...$builderZoneDisplayModes }
    for (const zone of builderZoneKeys) next[zone] = mode
    builderZoneDisplayModes.set(next)
  }

  function setBuilderZoneMode(zone: ZoneKey, mode: 'text' | 'graphic') {
    builderZoneDisplayModes.update((prev) => ({ ...prev, [zone]: mode }))
  }

  let lastSyncText = $state<string>(get(t)('common.loading'))
  let deckCount = $state<number>(0)
  let statRows = $state<{ name: string | null; label: string; count: number; size: string }[]>([])

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
    await Promise.all([loadImageCacheInfo(), loadImageCoverage()])
    await loadCustomLangs()
  })

  // 下载结束后刷新缓存覆盖统计
  $effect(() => {
    if (downloadState.active && downloadState.status !== 'downloading') {
      loadImageCoverage()
    }
  })

  function _t(key: string, values?: Record<string, unknown>) {
    return get(t)(key, values)
  }

  async function loadImageCoverage() {
    imageInfoLoading = true
    try {
      const { missing, existingCount, totalCount } = await prepareCardImageDownload()
      imageCoverage = { existingCount, totalCount, missingCount: missing.length }
    } catch (error) {
      console.error('[Settings] 读取卡图覆盖统计失败:', error)
    } finally {
      imageInfoLoading = false
    }
  }

  async function loadImageCacheInfo() {
    imageInfoLoading = true
    try {
      const base = await appLocalDataDir()
      imagePath = await join(base, CARD_IMAGE)
      const imageCacheSizeByte = await getImageDirSize()
      imageCacheSize = formatBytes(imageCacheSizeByte)
    } catch (e) {
      imageCacheSize = _t('settings.getFailed')
      console.error('[Settings] 读取卡图缓存信息失败:', e)
    } finally {
      imageInfoLoading = false
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
      const [stats, configDir, dbVersion] = await Promise.all([
        getDbStats(),
        appConfigDir(),
        getDbVersion(),
      ])

      // 1. 计算 DB size（文件真实大小）
      dbSize = formatBytes(stats.totalBytes)

      // 2. db 路径（实际存储于 appConfigDir，文件名由 DB_NAME 派生）
      const dbFileName = DB_NAME.replace(/^sqlite:/, '')
      dbFilePath = await join(configDir, dbFileName)
      dbPath = dbFilePath

      // 3. 最后同步时间（各同步表中最新的 updated_at）
      lastSyncText = dbVersion?.updated_at
        ? `${_t('settings.dataLabel')} · ${new Date(dbVersion.updated_at).toLocaleString()}`
        : _t('settings.neverSynced')

      // 4. 各表统计
      const rows: { name: string | null; label: string; count: number; size: string }[] =
        stats.tables.map((t) => ({
          name: t.name,
          label: t.label,
          count: t.count,
          size: formatBytes(t.bytes),
        }))
      const tableBytes = stats.tables.reduce((sum, t) => sum + t.bytes, 0)
      const residual = stats.totalBytes - tableBytes
      if (residual > 0) {
        rows.push({
          name: null,
          label: _t('settings.otherTable'),
          count: 0,
          size: formatBytes(residual),
        })
      }
      statRows = rows
      deckCount = stats.tables.find((t) => t.name === 'decks')?.count ?? 0
    } catch (e) {
      dbSize = _t('settings.getFailed')
      dbPath = _t('settings.getFailed')
      lastSyncText = _t('settings.getFailed')
      console.error('[初始化失败]', e)
    } finally {
      onloadInfo = false
    }
  }

  function cellValue(v: unknown): string {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v)
      } catch {
        return String(v)
      }
    }
    return String(v)
  }

  async function openTable(row: { name: string | null; label: string }) {
    if (!row.name) return
    showTableModal = true
    tableLoading = true
    try {
      const res = await getTableRows(row.name, 200)
      tableModal = { name: row.name, label: row.label, rows: res.rows, total: res.total }
    } finally {
      tableLoading = false
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case 'checking':
        return _t('settings.checkingUpdate')
      case 'upToDate':
        return _t('settings.upToDate')
      case 'error':
        return _t('settings.checkUpdateFailed')
      default:
        return ''
    }
  }

  async function checkCardDataUpdate() {
    cardDataUpdateStatus = 'checking'
    try {
      const net = await getNetworkStatus()
      if (!net.online) {
        cardDataUpdateStatus = 'error'
        showToast(_t('settings.networkUnavailable'), 'error')
        return
      }
      setLoadStatus('syncing')
      await initializeDatabase({ skipMetered: false })
      setLoadStatus('success')
      cardDataUpdateStatus = 'upToDate'
      await loadDbInfo()
    } catch (e) {
      cardDataUpdateStatus = 'error'
      setLoadStatus('error')
    }
  }

  async function handleResetDb() {
    const accpected = await ask(_t('settings.resetDbConfirm'), {
      title: _t('settings.resetDb'),
      kind: 'warning',
      okLabel: _t('common.confirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (accpected) {
      await withBusy(_t('settings.resetDbBusy'), async () => {
        await resetDatabase()
        await loadDbInfo()
      })
      message(_t('settings.resetDbSuccess'))
    }
  }

  function openHelpDoc() {
    openUrl(HELP_DOC_URL)
  }

  async function handleResetImageCache() {
    const accpected = await ask(_t('settings.resetImageCacheConfirm'), {
      title: _t('settings.resetImageCache'),
      kind: 'warning',
      okLabel: _t('common.confirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (accpected) {
      try {
        await withBusy(_t('settings.resetImageCacheBusy'), async () => {
          await clearLocalCache()
        })
        await loadImageCacheInfo()
        await message(_t('settings.resetImageCacheSuccess'))
      } catch (e) {
        setLoadStatus(
          'error',
          _t('settings.resetImageCacheFailed'),
          e instanceof Error ? e.message : _t('common.unknownError')
        )
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
        await message(_t('settings.imagesExist'), {
          title: _t('settings.cardResourceTitle'),
          kind: 'info',
        })

        return
      }

      const accepted = await ask(
        _t('settings.downloadConfirm', { values: { count: missing.length } }),
        {
          title: _t('settings.cardResourceDownloadTitle'),
          kind: 'warning',
          okLabel: _t('common.confirm'),
          cancelLabel: _t('common.cancel'),
        }
      )

      if (!accepted) {
        return
      }

      startCardImageDownload(missing)
    } catch (error) {
      console.error('[Settings] 准备卡图下载失败:', error)

      await message(error instanceof Error ? error.message : _t('settings.prepareDownloadFailed'), {
        title: _t('settings.cardResourceDownloadTitle'),
        kind: 'error',
      })
    }
  }

  // --- 备份 / 恢复 / 导出 ---
  async function backupDatabase() {
    if (!dbFilePath) return

    const dest = await save({
      title: _t('settings.backupSaveTitle'),
      defaultPath: `rune-archive-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: _t('settings.sqliteFilter'), extensions: ['db', 'sqlite', 'sqlite3'] }],
    })
    if (!dest) return

    try {
      await withBusy(_t('settings.backupBusy'), async () => {
        await closeDatabase()
        try {
          await copyFile(dbFilePath, dest)
        } finally {
          await getDatabase()
          await loadDbInfo()
        }
      })
      await message(_t('settings.backupSuccess'), { title: _t('settings.backup'), kind: 'info' })
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('settings.backupFailed'), {
        title: _t('settings.backup'),
        kind: 'error',
      })
    }
  }

  async function restoreDatabase() {
    if (!dbFilePath) return

    const src = await open({
      title: _t('settings.restoreOpenTitle'),
      multiple: false,
      filters: [{ name: _t('settings.sqliteFilter'), extensions: ['db', 'sqlite', 'sqlite3'] }],
    })
    if (!src) return

    const confirmed = await ask(_t('settings.restoreConfirm'), {
      title: _t('settings.restoreConfirmTitle'),
      kind: 'warning',
      okLabel: _t('common.confirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (!confirmed) return

    try {
      await withBusy(_t('settings.restoreBusy'), async () => {
        await closeDatabase()
        try {
          await copyFile(String(src), dbFilePath)
        } finally {
          await getDatabase()
          await loadDbInfo()
        }
      })
      await message(_t('settings.restoreSuccess'), { title: _t('settings.restore'), kind: 'info' })
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('settings.restoreFailed'), {
        title: _t('settings.restore'),
        kind: 'error',
      })
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
    toggleAll(
      selectedDeckIds,
      exportDeckList.map((d) => d.id),
      (next) => (selectedDeckIds = next)
    )
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
      title: _t('settings.exportSaveTitle'),
      defaultPath: `rune-archive-decks-${exportMode}-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: _t('settings.jsonFilter'), extensions: ['json'] }],
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

      await withBusy(_t('settings.exportBusy'), async () => {
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
              player_name: m.player_name,
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
      await message(_t('settings.exportSuccess', { values: { count: data.decks.length } }), {
        title: _t('settings.export'),
        kind: 'info',
      })
      showExportModal = false
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('settings.exportFailed'), {
        title: _t('settings.export'),
        kind: 'error',
      })
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
            player_name: asNullableString(rawMatch.player_name),
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
    toggleAll(
      selectedImportDeckIds,
      importDeckList.map((d) => d.id),
      (next) => {
        selectedImportDeckIds = next
      }
    )
  }

  async function openImportModal() {
    const src = await open({
      title: _t('settings.importOpenTitle'),
      multiple: false,
      filters: [{ name: _t('settings.jsonFilter'), extensions: ['json'] }],
    })
    if (!src) return

    let content: string
    try {
      content = await withBusy(_t('settings.importReadBusy'), async () => readTextFile(String(src)))
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('settings.importReadFailed'), {
        title: _t('settings.import'),
        kind: 'error',
      })
      return
    }

    const decks = parseImportFile(content)
    if (decks.length === 0) {
      await message(_t('settings.importInvalidFile'), {
        title: _t('settings.import'),
        kind: 'error',
      })
      return
    }

    importFileName = String(src).split(/[\\/]/).pop() ?? String(src)
    importDeckList = decks.map((d) => ({
      id: d.name,
      name: d.name,
      updatedAt: d.updated_at ? new Date(d.updated_at).toLocaleString() : _t('common.unknown'),
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
      const { imported, missingCards } = await withBusy(_t('settings.importBusy'), () =>
        importDecksFromJson(chosen, {
          latestOnly: importMode === 'latest',
          filterMissingCards: true,
        })
      )
      const missingText =
        missingCards > 0
          ? _t('settings.importSkippedMissing', { values: { count: missingCards } })
          : ''
      await message(
        _t('settings.importSuccess', { values: { count: imported, extra: missingText } }),
        { title: _t('settings.import'), kind: 'info' }
      )
      showImportModal = false
      await loadDbInfo()
    } catch (e) {
      await message(e instanceof Error ? e.message : _t('settings.importFailed'), {
        title: _t('settings.import'),
        kind: 'error',
      })
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
      okLabel: _t('common.confirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (!confirmed) return

    try {
      await withBusy(_t('settings.confirmAndRunBusy', { values: { action: title } }), action)
    } catch (e) {
      await message(
        e instanceof Error ? e.message : _t('settings.actionFailed', { values: { action: title } }),
        {
          title,
          kind: 'error',
        }
      )
      return
    }
    if (successMsg) await message(successMsg, { kind: 'info' })
    await loadDbInfo()
  }

  function clearAllDecksAsk() {
    return confirmAndRun(
      _t('settings.clearAllDecks'),
      _t('settings.clearAllDecksConfirm', { values: { count: deckCount } }),
      () => deleteAllDecks(),
      _t('settings.clearAllDecksSuccess')
    )
  }

  async function manualSnapshot() {
    await captureCollectionSnapshot('manual')
    await message(_t('settings.snapshotRecorded'), {
      title: _t('settings.snapshotTitle'),
      kind: 'info',
    })
  }

  function clearHistoryAsk() {
    const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    return confirmAndRun(
      _t('settings.clearHistory'),
      _t('settings.clearHistoryConfirm'),
      () => clearHistory({ before }),
      _t('settings.clearHistorySuccess')
    )
  }

  async function cleanupVersionsAsk() {
    const confirmed = await ask(_t('settings.cleanupVersionsConfirm'), {
      title: _t('settings.cleanupVersions'),
      kind: 'warning',
      okLabel: _t('common.confirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (!confirmed) return

    const deleted = await withBusy(_t('settings.cleanupVersionsBusy'), () => cleanupDeckVersions())
    await message(_t('settings.cleanupVersionsSuccess', { values: { count: deleted } }), {
      kind: 'info',
    })
    await loadDbInfo()
  }

  async function clearCardDataAsk() {
    const confirmed = await ask(_t('settings.clearCardDataConfirm'), {
      title: _t('settings.clearCardData'),
      kind: 'warning',
      okLabel: _t('common.confirm'),
      cancelLabel: _t('common.cancel'),
    })
    if (!confirmed) return

    await withBusy(_t('settings.clearCardDataBusy'), () => clearCardData())
    await message(_t('settings.clearCardDataSuccess'), { kind: 'info' })
    await loadDbInfo()
  }

  function clearRulesAsk() {
    return confirmAndRun(
      _t('settings.clearRules'),
      _t('settings.clearRulesConfirm'),
      () => clearRules(),
      _t('settings.clearRulesSuccess')
    )
  }

  function clearIconsAsk() {
    return confirmAndRun(
      _t('settings.clearIcons'),
      _t('settings.clearIconsConfirm'),
      () => clearIcons(),
      _t('settings.clearIconsSuccess')
    )
  }

  function clearFilterAsk() {
    return confirmAndRun(
      _t('settings.clearFilter'),
      _t('settings.clearFilterConfirm'),
      () => clearFilterOptions(),
      _t('settings.clearFilterSuccess')
    )
  }

  function resetSyncAsk() {
    return confirmAndRun(
      _t('settings.resetSync'),
      _t('settings.resetSyncConfirm'),
      () => clearVersion(),
      _t('settings.resetSyncSuccess')
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
      langMsg = _t('settings.langAdded')
    } catch (e) {
      langMsgError = true
      langMsg = e instanceof Error ? e.message : _t('settings.addFailed')
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
      langMsg = _t('settings.renamed')
    } catch (e) {
      langMsgError = true
      langMsg = e instanceof Error ? e.message : _t('settings.renameFailed')
    }
  }

  async function removeLang(code: string) {
    langMsg = ''
    langMsgError = false
    const confirmed = await ask(_t('settings.deleteLangConfirm', { values: { code } }), {
      title: _t('settings.deleteCustomLang'),
      kind: 'warning',
      okLabel: _t('common.delete'),
      cancelLabel: _t('common.cancel'),
    })
    if (!confirmed) return
    try {
      await deleteCustomLanguage(code)
      await loadCustomLangs()
      langMsg = _t('settings.deleted')
    } catch (e) {
      langMsgError = true
      langMsg = e instanceof Error ? e.message : _t('settings.deleteFailed')
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
    setTopbar({ title: $t('settings.title') })
  })
</script>

<div class="settings-container">
  <!-- 1. 通用设置 -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.general')}</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.playerName')}</span>
        <span class="setting-desc"> {$t('settings.playerNameDesc')} </span>
      </div>
      <input
        class="setting-input"
        type="text"
        maxlength="20"
        placeholder={$t('settings.playerNamePlaceholder')}
        bind:value={$playerName}
      />
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.language')}</span>
        <span class="setting-desc">{$t('settings.languageDesc')}</span>
      </div>
      <select class="setting-input lang-select" bind:value={$locale}>
        {#each SUPPORTED_LOCALES as code}
          <option value={code}>{code}</option>
        {/each}
      </select>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.defaultLang')}</span>
        <span class="setting-desc">{$t('settings.defaultLangDesc')}</span>
      </div>
      <select class="setting-input lang-select" bind:value={$defaultLanguage}>
        {#each [...PRESET_LANGUAGE_CODES, ...customLangs.map((c) => c.code)] as code (code)}
          <option value={code}>{code}</option>
        {/each}
      </select>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.darkMode')}</span>
        <span class="setting-desc">{$t('settings.darkModeDesc')}</span>
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={$darkMode} />
        <span class="slider"></span>
      </label>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.showForeignArt')}</span>
        <span class="setting-desc">
          {$t('settings.showForeignArtDesc')}
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
          <span class="setting-label">{$t('settings.showTTS')}</span>
          <span class="setting-desc">{$t('settings.showTTSDesc')}</span>
        </div>
        <label class="switch">
          <input type="checkbox" bind:checked={$showTTSFeatures} />
          <span class="slider"></span>
        </label>
      </div>
    {/if}
  </section>

  <!-- 卡组构建 -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.cardBuilder')}</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.revertLayout')}</span>
        <span class="setting-desc">{$t('settings.revertLayoutDesc')}</span>
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={$revertLayout} />
        <span class="slider"></span>
      </label>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.builderShowAllZones')}</span>
        <span class="setting-desc">{$t('settings.builderShowAllZonesDesc')}</span>
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={$builderShowAllZones} />
        <span class="slider"></span>
      </label>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.builderDisplayMode')}</span>
        <span class="setting-desc">{$t('settings.builderDisplayModeDesc')}</span>
      </div>
      <div class="toggle-button-group">
        <button
          class="toggle-btn {builderGlobalMode === 'text' ? 'active' : ''}"
          onclick={() => setBuilderGlobalMode('text')}
        >
          {$t('builder.textMode')}
        </button>
        <button
          class="toggle-btn {builderGlobalMode === 'graphic' ? 'active' : ''}"
          onclick={() => setBuilderGlobalMode('graphic')}
        >
          {$t('builder.graphicMode')}
        </button>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.builderZoneModes')}</span>
        <span class="setting-desc">{$t('settings.builderZoneModesDesc')}</span>
      </div>
      <button
        class="button button-ghost"
        onclick={() => (showBuilderZoneModes = !showBuilderZoneModes)}
      >
        {showBuilderZoneModes ? $t('builder.collapse') : $t('download.expand')}
      </button>
    </div>
    {#if showBuilderZoneModes}
      <div class="builder-zone-modes">
        {#each builderZoneKeys as zone (zone)}
          <div class="builder-zone-row">
            <span class="zone-label">{$t(ZONE_CONFIG[zone].labelKey)}</span>
            <div class="toggle-button-group">
              <button
                class="toggle-btn {$builderZoneDisplayModes[zone] === 'text' ? 'active' : ''}"
                onclick={() => setBuilderZoneMode(zone, 'text')}
              >
                {$t('builder.textMode')}
              </button>
              <button
                class="toggle-btn {$builderZoneDisplayModes[zone] === 'graphic' ? 'active' : ''}"
                onclick={() => setBuilderZoneMode(zone, 'graphic')}
              >
                {$t('builder.graphicMode')}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.builderGraphicColumns')}</span>
        <span class="setting-desc">{$t('settings.builderGraphicColumnsDesc')}</span>
      </div>
      <input
        class="setting-input builder-columns-input"
        type="number"
        min="2"
        value={$builderGraphicColumns}
        oninput={(e) => {
          const target = e.target as HTMLInputElement
          $builderGraphicColumns = parseInt(target.value || '4')
        }}
      />
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.builderMainDeckDisplay')}</span>
        <span class="setting-desc">{$t('settings.builderMainDeckDisplayDesc')}</span>
      </div>
      <div class="toggle-button-group">
        <button
          class="toggle-btn {$builderMainDeckDisplayMode === 'grouped' ? 'active' : ''}"
          onclick={() => ($builderMainDeckDisplayMode = 'grouped')}
        >
          {$t('builder.grouped')}
        </button>
        <button
          class="toggle-btn {$builderMainDeckDisplayMode === 'single' ? 'active' : ''}"
          onclick={() => ($builderMainDeckDisplayMode = 'single')}
        >
          {$t('builder.single')}
        </button>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.builderSideboardDisplay')}</span>
        <span class="setting-desc">{$t('settings.builderSideboardDisplayDesc')}</span>
      </div>
      <div class="toggle-button-group">
        <button
          class="toggle-btn {$builderSideboardDisplayMode === 'grouped' ? 'active' : ''}"
          onclick={() => ($builderSideboardDisplayMode = 'grouped')}
        >
          {$t('builder.grouped')}
        </button>
        <button
          class="toggle-btn {$builderSideboardDisplayMode === 'single' ? 'active' : ''}"
          onclick={() => ($builderSideboardDisplayMode = 'single')}
        >
          {$t('builder.single')}
        </button>
      </div>
    </div>
  </section>

  <!-- 收藏历史 -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.collectionHistory')}</h2>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.manualSnapshot')}</span>
        <span class="setting-desc">{$t('settings.manualSnapshotDesc')}</span>
      </div>
      <button class="button button-secondary" onclick={manualSnapshot}
        >{$t('settings.recordSnapshot')}</button
      >
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.clearHistory')}</span>
        <span class="setting-desc">{$t('settings.clearHistoryDesc')}</span>
      </div>
      <button class="button button-ghost" onclick={clearHistoryAsk}
        >{$t('settings.clear30d')}</button
      >
    </div>
  </section>

  <!-- 4. 语言设置 -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.customLang')}</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.presetLang')}</span>
        <span class="setting-desc">
          {$t('settings.presetLangDesc', { values: { codes: PRESET_LANGUAGE_CODES.join(' / ') } })}
        </span>
      </div>
    </div>

    <div class="add-lang-row">
      <input
        class="settings-input lang-code-input"
        bind:value={newLangCode}
        placeholder={$t('settings.langCodePlaceholder')}
      />
      <input
        class="settings-input"
        bind:value={newLangName}
        placeholder={$t('settings.langNamePlaceholder')}
      />
      <button class="button button-primary" onclick={addLang}>{$t('common.add')}</button>
    </div>

    {#if langMsg}
      <div class="lang-msg" class:lang-msg-error={langMsgError}>{langMsg}</div>
    {/if}

    {#if customLangs.length === 0}
      <div class="lang-empty">{$t('settings.noCustomLang')}</div>
    {:else}
      <div class="manage-list">
        {#each customLangs as lang (lang.code)}
          <div class="manage-row">
            <div class="manage-info">
              <span class="manage-title">{lang.code}</span>
              <span class="manage-desc">
                {#if editingCode === lang.code}
                  <input
                    class="settings-input"
                    bind:value={editingName}
                    placeholder={$t('settings.langNameEditPlaceholder')}
                  />
                {:else}
                  {lang.name}
                {/if}
              </span>
            </div>
            <div class="lang-actions">
              {#if editingCode === lang.code}
                <button class="button button-ghost" onclick={() => saveRename(lang.code)}>
                  {$t('common.save')}
                </button>
                <button
                  class="button button-ghost"
                  onclick={() => {
                    editingCode = ''
                  }}
                >
                  {$t('common.cancel')}
                </button>
              {:else}
                <button class="button button-ghost" onclick={() => startEdit(lang)}>
                  {$t('common.rename')}
                </button>
                <button class="button button-danger-outline" onclick={() => removeLang(lang.code)}>
                  {$t('common.delete')}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- 5. 本地数据库 -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.localDb')}</h2>

    <div class="notice-banner">{$t('settings.localOnlyNotice')}</div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.dbPath')}</span>
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
        <span class="setting-label">{$t('settings.dbSize')}</span>
        <span class="setting-desc">{$t('settings.dbSizeDesc')}</span>
      </div>
      <span class="version-tag">{dbSize}</span>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.lastSync')}</span>
        <span class="setting-desc">{$t('settings.lastSyncDesc')}</span>
      </div>
      <span class="version-tag">{lastSyncText}</span>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.tableStats')}</span>
        <span class="setting-desc">{$t('settings.tableStatsDesc')}</span>
      </div>
      <button class="button button-ghost" onclick={() => (showStats = !showStats)}>
        {showStats ? $t('builder.collapse') : $t('download.expand')}
      </button>
    </div>

    {#if showStats}
      <div class="stat-breakdown">
        {#each statRows as row}
          <button
            class="stat-row"
            class:stat-row-disabled={!row.name}
            onclick={() => openTable(row)}
          >
            <span class="stat-label">{row.label}</span>
            <span class="stat-right">
              <span class="stat-value"
                >{$t('settings.statRowsFormat', { values: { count: row.count, size: row.size } })}</span
              >
              {#if row.name}
                <ChevronRight size={14} />
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="db-actions">
      <button class="button button-ghost" disabled={onloadInfo} onclick={backupDatabase}>
        <Download size={16} />
        {$t('settings.backupDb')}
      </button>
      <button class="button button-ghost" disabled={onloadInfo} onclick={restoreDatabase}>
        <Upload size={16} />
        {$t('settings.restoreBackup')}
      </button>
      <button
        class="button button-ghost"
        disabled={onloadInfo || deckCount === 0}
        onclick={openExportModal}
      >
        <FileText size={16} />
        {$t('settings.exportAllDecks')}
      </button>
      <button class="button button-ghost" disabled={onloadInfo} onclick={openImportModal}>
        <FileUp size={16} />
        {$t('settings.importDecks')}
      </button>
      <button class="button button-danger-outline" disabled={onloadInfo} onclick={handleResetDb}>
        {$t('settings.resetDb')}
      </button>
    </div>
  </section>

  <!-- 6. 本地图片 -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.localImageCache')}</h2>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.cacheCoverage')}</span>
        <span class="setting-desc">
          {$t('settings.cachedImages', {
            values: {
              existing: imageCoverage?.existingCount ?? '-',
              total: imageCoverage?.totalCount ?? '-',
            },
          })}
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
        <span class="setting-label">{$t('settings.cardResourceDownload')}</span>
        <span class="setting-desc">{$t('settings.cardResourceDownloadDesc')}</span>
      </div>
      {#if isCardImageDownloading()}
        <button class="button button-primary" disabled>
          {$t('settings.downloadingPercent', {
            values: { percent: Math.round((downloadState.completed / downloadState.total) * 100) },
          })}
        </button>
      {:else}
        <button
          class="button button-primary"
          disabled={imageInfoLoading || !imageCoverage || imageCoverage.missingCount === 0}
          onclick={startDownloadAll}
        >
          {#if imageCoverage && imageCoverage.missingCount === 0}
            {$t('settings.alreadyLatest')}
          {:else if imageCoverage}
            {$t('settings.downloadAllImages', { values: { count: imageCoverage.missingCount } })}
          {:else}
            {$t('settings.startDownload')}
          {/if}
        </button>
      {/if}
    </div>

    {#if isCardImageDownloading()}
      <p class="download-hint">{$t('settings.downloadHint')}</p>
    {/if}

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.imageCachePath')}</span>
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
        <span class="setting-label">{$t('settings.imageCacheSize')}</span>
      </div>
      <span class="version-tag">{imageCacheSize}</span>
    </div>

    <div class="db-actions">
      <button
        class="button button-danger-outline"
        disabled={imageInfoLoading}
        onclick={handleResetImageCache}
      >
        {$t('settings.resetImageCache')}
      </button>
    </div>
  </section>

  <!-- 7. 数据管理（删除） -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.dataManage')}</h2>

    <div class="manage-block-header">
      <span class="manage-block-title">{$t('settings.batchDelete')}</span>
      <span class="manage-block-desc">{$t('settings.batchDeleteDesc')}</span>
    </div>

    <div class="manage-list">
      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">{$t('settings.clearAllDecks')}</span>
          <span class="manage-desc">{$t('settings.clearAllDecksDesc')}</span>
        </div>
        <button
          class="button button-danger-outline"
          disabled={deckCount === 0}
          onclick={clearAllDecksAsk}
        >
          {$t('common.clear')}
        </button>
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">{$t('settings.cleanupVersions')}</span>
          <span class="manage-desc">{$t('settings.cleanupVersionsDesc')}</span>
        </div>
        <button class="button button-ghost" onclick={cleanupVersionsAsk}
          >{$t('common.cleanup')}</button
        >
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">{$t('settings.clearCardData')}</span>
          <span class="manage-desc">{$t('settings.clearCardDataDesc')}</span>
        </div>
        <button class="button button-danger-outline" onclick={clearCardDataAsk}
          >{$t('common.clear')}</button
        >
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">{$t('settings.clearRules')}</span>
          <span class="manage-desc">{$t('settings.clearRulesDesc')}</span>
        </div>
        <button class="button button-danger-outline" onclick={clearRulesAsk}
          >{$t('common.clear')}</button
        >
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">{$t('settings.clearIcons')}</span>
          <span class="manage-desc">{$t('settings.clearIconsDesc')}</span>
        </div>
        <button class="button button-danger-outline" onclick={clearIconsAsk}
          >{$t('common.clear')}</button
        >
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">{$t('settings.clearFilter')}</span>
          <span class="manage-desc">{$t('settings.clearFilterDesc')}</span>
        </div>
        <button class="button button-danger-outline" onclick={clearFilterAsk}
          >{$t('common.clear')}</button
        >
      </div>

      <div class="manage-row">
        <div class="manage-info">
          <span class="manage-title">{$t('settings.resetSync')}</span>
          <span class="manage-desc">{$t('settings.resetSyncDesc')}</span>
        </div>
        <button class="button button-ghost" onclick={resetSyncAsk}>{$t('common.reset')}</button>
      </div>
    </div>
  </section>

  <!-- 8. 关于 -->
  <section class="settings-card">
    <h2 class="card-title">{$t('settings.about')}</h2>

    <div class="about-group-title">{$t('settings.versionUpdate')}</div>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.appVersion')}</span>
        <span class="setting-desc">{$t('settings.appVersionDesc')}</span>
      </div>
      <span class="version-tag">{appVersion}</span>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.cardDataUpdate')}</span>
        <span
          class="setting-desc status-text"
          class:text-success={cardDataUpdateStatus === 'upToDate'}
          class:text-error={cardDataUpdateStatus === 'error'}
        >
          {getStatusText(cardDataUpdateStatus) || $t('settings.clickCheckUpdate')}
        </span>
      </div>
      <button
        class="button button-secondary"
        onclick={checkCardDataUpdate}
        disabled={cardDataUpdateStatus === 'checking'}
      >
        {cardDataUpdateStatus === 'checking' ? $t('settings.checking') : $t('settings.checkUpdate')}
      </button>
    </div>

    <div class="about-group-title">{$t('settings.feedback')}</div>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-label">{$t('settings.feedbackDoc')}</span>
        <span class="setting-desc">{$t('settings.feedbackDocDesc')}</span>
      </div>
      <button class="button button-ghost" onclick={openHelpDoc}>
        {$t('settings.visitLink')}
      </button>
    </div>
  </section>

  <CommonModal
    open={showExportModal}
    title={$t('settings.exportModalTitle')}
    subtitle={$t('settings.exportModalSubtitle')}
    closable={!isExporting}
    onclose={() => (showExportModal = false)}
  >
    <div class="export-mode-row">
      <span class="export-mode-label">{$t('settings.versionRange')}</span>
      <div class="export-mode-group">
        <button
          class="button button-ghost"
          class:export-mode-active={exportMode === 'all'}
          disabled={isExporting}
          onclick={() => (exportMode = 'all')}
        >
          {$t('settings.allVersions')}
        </button>
        <button
          class="button button-ghost"
          class:export-mode-active={exportMode === 'latest'}
          disabled={isExporting}
          onclick={() => (exportMode = 'latest')}
        >
          {$t('settings.latestOnly')}
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
      <span>{$t('settings.selectAllDecks', { values: { count: exportDeckList.length } })}</span>
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
              {$t('settings.versionCountInfo', {
                values: { count: deck.versionCount, time: deck.updatedAt },
              })}
            </span>
          </span>
        </label>
      {/each}
      {#if exportDeckList.length === 0}
        <div class="export-deck-empty">{$t('settings.noDecksToExport')}</div>
      {/if}
    </div>

    {#snippet footer()}
      <button
        class="button button-ghost"
        disabled={isExporting}
        onclick={() => (showExportModal = false)}
      >
        {$t('common.cancel')}
      </button>
      <button
        class="button button-primary"
        disabled={isExporting || selectedDeckIds.length === 0}
        onclick={confirmExport}
      >
        {isExporting
          ? $t('settings.exporting')
          : $t('settings.exportCount', { values: { count: selectedDeckIds.length } })}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={showImportModal}
    title={$t('settings.importModalTitle')}
    subtitle={importFileName
      ? $t('settings.importModalFile', { values: { name: importFileName } })
      : ''}
    closable={!isImporting}
    onclose={() => (showImportModal = false)}
  >
    <div class="export-mode-row">
      <span class="export-mode-label">{$t('settings.versionRange')}</span>
      <div class="export-mode-group">
        <button
          class="button button-ghost"
          class:export-mode-active={importMode === 'all'}
          disabled={isImporting}
          onclick={() => (importMode = 'all')}
        >
          {$t('settings.allVersions')}
        </button>
        <button
          class="button button-ghost"
          class:export-mode-active={importMode === 'latest'}
          disabled={isImporting}
          onclick={() => (importMode = 'latest')}
        >
          {$t('settings.latestOnly')}
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
      <span>{$t('settings.selectAllDecks', { values: { count: importDeckList.length } })}</span>
    </label>

    <div class="export-deck-list">
      {#each importDeckList as deck, index (`${deck.id}-${index}`)}
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
              {$t('settings.versionCountInfo', {
                values: { count: deck.versionCount, time: deck.updatedAt },
              })}
            </span>
          </span>
        </label>
      {/each}
      {#if importDeckList.length === 0}
        <div class="export-deck-empty">{$t('settings.noDecksToImport')}</div>
      {/if}
    </div>

    {#snippet footer()}
      <button
        class="button button-ghost"
        disabled={isImporting}
        onclick={() => (showImportModal = false)}
      >
        {$t('common.cancel')}
      </button>
      <button
        class="button button-primary"
        disabled={isImporting || selectedImportDeckIds.length === 0}
        onclick={confirmImport}
      >
        {isImporting
          ? $t('settings.importing')
          : $t('settings.importCount', { values: { count: selectedImportDeckIds.length } })}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={showTableModal}
    title={tableModal?.label ?? ''}
    subtitle={tableModal
      ? $t('settings.tableRowsPreview', { values: { total: tableModal.total, limit: 200 } })
      : ''}
    width="min(720px, 92vw)"
    onclose={() => (showTableModal = false)}
  >
    {#if tableLoading}
      <div class="table-loading">{$t('common.loading')}</div>
    {:else if !tableModal || tableModal.rows.length === 0}
      <div class="table-loading">{$t('settings.tableEmpty')}</div>
    {:else}
      {@const cols = Object.keys(tableModal.rows[0])}
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              {#each cols as col (col)}
                <th>{col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each tableModal.rows as row, i (i)}
              <tr>
                {#each cols as col (col)}
                  <td title={cellValue(row[col])}>{cellValue(row[col])}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </CommonModal>

  {#if busyText}
    <LoadingModal status="syncing" text={busyText} subtext={$t('settings.pleaseWait')} />
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

  .lang-select {
    /*width: 140px;
    height: 36px;*/
    cursor: pointer;
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
    background: color-mix(in oklab, var(--accent-color) 8%, var(--surface));
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
    margin-top: 8px;
    border: 1px solid rgba(205, 205, 203, 0.6);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .stat-row {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: none;
    border-radius: 0;
    background: transparent;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .stat-row:hover {
    background: var(--bg-hover);
  }

  .stat-row-disabled {
    cursor: default;
    opacity: 0.7;
  }

  .stat-row-disabled:hover {
    background: transparent;
  }

  .stat-row + .stat-row {
    border-top: 1px solid rgba(205, 205, 203, 0.4);
  }

  .stat-label {
    color: var(--text-secondary);
    text-align: left;
  }

  .stat-right {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-tertiary);
  }

  .stat-value {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  /* 数据表明细弹窗 */
  .table-loading {
    padding: 32px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .table-scroll {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }

  .data-table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-xs);
  }

  .data-table th,
  .data-table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    text-align: left;
    vertical-align: top;
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .data-table th {
    position: sticky;
    top: 0;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-weight: 600;
    z-index: 1;
  }

  .data-table tr:last-child td {
    border-bottom: none;
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

  /* 关于页分组标题 */
  .about-group-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    padding: 14px 0 0;
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

  .toggle-button-group {
    display: flex;
    gap: 2px;
    background-color: var(--bg-primary);
    border-radius: var(--radius-sm);
    padding: 2px;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .toggle-btn {
    padding: 4px 14px;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .toggle-btn.active {
    background-color: var(--accent-color);
    color: white;
  }

  .toggle-btn.active:hover {
    background-color: color-mix(in oklab, var(--accent-color) 85%, black);
  }

  .builder-columns-input {
    width: 80px;
    text-align: center;
    flex-shrink: 0;
  }

  .builder-zone-modes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 0 14px;
  }

  .builder-zone-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }

  .builder-zone-row .zone-label {
    font-size: var(--text-base);
    color: var(--text-primary);
  }
</style>
