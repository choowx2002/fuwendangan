<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { setReplayBundle } from '$lib/stores/replay-import.svelte'
  import { isTauri } from '$lib/db/env'
  import {
    getAllReplayBindings,
    deleteMatchByReplayKey,
    relinkReplayToSyncedMatch,
    getLatestDeckCards,
  } from '$lib/db'
  import { parseRiftExport, ReplayImportError } from '$lib/replay/import-parser'
  import type { ImportBundle, RiftAtlasMatchRecord } from '$lib/replay/types'
  import {
    loadLibrary,
    removeRoom,
    removeFile,
    hashText,
    writeImportTmp,
    cleanupImportTmp,
    saveSeriesFile,
    type StoredReplayFile,
  } from '$lib/services/replay-library-service'
  import ReplayImportDropzone from '$lib/components/replay/ReplayImportDropzone.svelte'
  import ReplayImportSelect from '$lib/components/replay/ReplayImportSelect.svelte'
  import ReplayGroupCard from '$lib/components/replay/ReplayGroupCard.svelte'
  import ReplayInfoModal from '$lib/components/replay/ReplayInfoModal.svelte'
  import { deckOverlapRatio } from '$lib/replay/deck-overlap'
  import SortModal from '$lib/components/cards/SortModal.svelte'
  import type { SortKeyItem } from '$lib/db/types'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import {
    Upload,
    LoaderCircle,
    ListChecks,
    CheckSquare,
    X,
    Trash2,
    ArrowUpDown,
  } from '@lucide/svelte'

  interface MergedGroup {
    group: RiftAtlasMatchRecord
    fileId: string
  }

  // 排序字段（SortModal fields 模式同 DECK_IMAGE_SORT_FIELDS）
  const REPLAY_SORT_FIELDS = [
    { value: 'created_at', label: 'created_at', labelKey: 'replay.sortCreatedAt' },
    { value: 'game_time', label: 'game_time', labelKey: 'replay.sortGameTime' },
    { value: 'format', label: 'format', labelKey: 'replay.sortFormat' },
    { value: 'self_legend', label: 'self_legend', labelKey: 'replay.sortSelfLegend' },
  ]

  let files = $state<StoredReplayFile[]>([])
  let brokenIds = $state<string[]>([])
  let errorText = $state<string | null>(null)
  let loaded = $state(false)
  let deleting = $state(false)
  let importOpen = $state(false)
  let selectMode = $state(false)
  let selectedKeys = $state(new Set<string>())
  // 导入两段式：'drop' 选文件 → 'parsing' 解析 → 'select' 选择系列 → 确认落盘
  let importStage = $state<'drop' | 'parsing' | 'select'>('drop')
  let pendingFileName = $state<string | null>(null)
  let pendingGroups = $state<RiftAtlasMatchRecord[]>([])
  let importSelectKeys = $state(new Set<string>())
  let importing = $state(false)
  // 排序：空规则 = 保持库默认（最近导入倒序）
  let sortList = $state<SortKeyItem[]>([])
  let sortOpen = $state(false)
  // 对局资料弹窗 + 卡组绑定指示
  let infoKey = $state<string | null>(null)
  let bindings = $state(new Map<string, string>())
  let deckOverlaps = $state(new Map<string, number>())

  // 跨文件按 room 去重（库按导入时间倒序，先扫到的即最新文件）
  const mergedGroups = $derived.by<MergedGroup[]>(() => {
    const seen = new Set<string>()
    const out: MergedGroup[] = []
    for (const f of files) {
      for (const g of f.groups) {
        if (seen.has(g.key)) continue
        seen.add(g.key)
        out.push({ group: g, fileId: f.id })
      }
    }
    return out
  })

  const infoGroup = $derived(
    infoKey ? (mergedGroups.find((m) => m.group.key === infoKey)?.group ?? null) : null
  )

  // 「我方传奇」取值：有我方取 perspective.localPlayerId，观战（无我方）取左边 player（与列表展示一致）
  function selfLegendOf(g: RiftAtlasMatchRecord): string {
    const list = Object.values(g.players ?? {})
    const p = g.perspective?.isSpectator
      ? (list[0] ?? null)
      : g.perspective?.localPlayerId
        ? (g.players?.[g.perspective.localPlayerId] ?? null)
        : null
    return p?.legend?.cardCode ?? ''
  }

  function sortValueOf(name: string, m: MergedGroup): string | number {
    switch (name) {
      case 'created_at':
        return files.find((f) => f.id === m.fileId)?.importedAt ?? 0
      case 'game_time':
        return m.group.meta?.startedAt ?? 0
      case 'format':
        return m.group.meta?.format ?? ''
      case 'self_legend':
        return selfLegendOf(m.group)
      default:
        return m.group.key
    }
  }

  // 多重排序：按规则 order 升序逐条稳定排序（语义同 SortModal 弹窗顺序）
  const sortedGroups = $derived.by<MergedGroup[]>(() => {
    const out = [...mergedGroups]
    const byOrder = [...sortList].sort((a, b) => a.order - b.order)
    for (const rule of byOrder) {
      const dir = rule.isAsc ? 1 : -1
      out.sort((x, y) => {
        const av = sortValueOf(rule.name, x)
        const bv = sortValueOf(rule.name, y)
        if (typeof av === 'number' && typeof bv === 'number') {
          return av === bv ? 0 : av < bv ? -dir : dir
        }
        return String(av).localeCompare(String(bv)) * dir
      })
    }
    return out
  })

  $effect(() => {
    const hasContent = mergedGroups.length > 0 || brokenIds.length > 0
    setTopbar({
      title: $t('replay.title'),
      onBack: () => {
        if (selectMode) {
          cancelSelect()
        } else {
          void goto('/')
        }
      },
      // 已有复盘时导入入口收敛到 topbar 按钮（空库时页面内直接显示导入区）；
      // 多选模式下顶栏切换为批量操作
      actions: !hasContent
        ? []
        : selectMode
          ? [
              {
                key: 'select-all',
                label: $t('replay.selectAll'),
                icon: CheckSquare,
                onClick: selectAll,
                priority: 8,
              },
              {
                key: 'delete-selected',
                label: $t('replay.deleteSelected', { values: { count: selectedKeys.size } }),
                icon: Trash2,
                variant: 'danger',
                disabled: deleting || selectedKeys.size === 0,
                title: $t('replay.deleteSelected', { values: { count: selectedKeys.size } }),
                onClick: () => void onDeleteMany(),
                priority: 5,
              },
              {
                key: 'cancel-select',
                label: $t('common.cancel'),
                icon: X,
                onClick: cancelSelect,
              },
            ]
          : [
              {
                key: 'import',
                label: $t('replay.importAction'),
                icon: Upload,
                variant: 'primary',
                onClick: () => (importOpen = true),
                priority: 1,
              },
              {
                key: 'sort',
                label: $t('replay.sortAction'),
                icon: ArrowUpDown,
                active: sortList.length > 0,
                onClick: () => (sortOpen = true),
                priority: 2,
              },
              {
                key: 'multi-select',
                label: $t('replay.multiSelect'),
                icon: ListChecks,
                onClick: enterSelect,
              },
            ],
    })
  })

  onMount(refresh)

  async function refresh() {
    const res = await loadLibrary()
    files = res.files
    brokenIds = res.brokenIds
    loaded = true
    await loadBindings()
  }

  /** 加载全部复盘绑定关系 + 已绑定卡组的主牌重叠率（复盘卡片 FileLock / 匹配徽标用） */
  async function loadBindings() {
    if (!isTauri) {
      bindings = new Map()
      deckOverlaps = new Map()
      return
    }
    const b = await getAllReplayBindings()
    bindings = b
    const byDeck = new Map<string, string[]>()
    for (const [key, deckId] of b) {
      const arr = byDeck.get(deckId) ?? []
      arr.push(key)
      byDeck.set(deckId, arr)
    }
    const overlaps = new Map<string, number>()
    for (const [deckId, keys] of byDeck) {
      let cards
      try {
        cards = await getLatestDeckCards(deckId)
      } catch {
        continue
      }
      for (const key of keys) {
        const g = mergedGroups.find((m) => m.group.key === key)?.group
        if (!g) continue
        const self = g.perspective?.localPlayerId ? g.players?.[g.perspective.localPlayerId] : null
        if (!self) continue
        overlaps.set(key, deckOverlapRatio(self.deck?.mainDeck ?? [], cards))
      }
    }
    deckOverlaps = overlaps
  }

  /** 阶段1：解析文件并暂存各 series，随后打开「选择要导入的系列」弹窗 */
  async function onFile(text: string, name: string): Promise<boolean> {
    errorText = null
    console.log('[replay-import] 阶段1 开始解析文件', { name, sizeBytes: text.length })
    importStage = 'parsing'
    importOpen = true
    let bundle: ImportBundle
    try {
      bundle = parseRiftExport(text, { fileName: name })
    } catch (e) {
      importStage = 'drop'
      console.error('[replay-import] 解析失败', e)
      if (e instanceof ReplayImportError) {
        errorText = get(t)(
          e.code === 'not-json'
            ? 'replay.parseNotJson'
            : e.code === 'no-matches'
              ? 'replay.noMatches'
              : e.code === 'no-replay-data'
                ? 'replay.noReplayData'
                : 'replay.parseFailed',
          { values: { error: e.message } }
        )
      } else {
        errorText = get(t)('replay.parseFailed', { values: { error: String(e) } })
      }
      return false
    }
    console.log('[replay-import] 解析成功', {
      rawMatchCount: bundle.rawMatchCount,
      seriesCount: bundle.groups.length,
      warnings: bundle.warnings,
    })
    bundle.groups.forEach((g, i) => {
      console.log(`[replay-import]   series#${i + 1}`, {
        key: g.key,
        seriesId: g.meta.seriesId,
        roomCode: g.meta.roomCode,
        format: g.meta.format,
        source: g.meta.source,
        startedAt: g.meta.startedAt,
        games: g.games.map((x) => ({
          n: x.gameNumber,
          room: x.roomCode,
          score: x.score,
          startedAt: x.startedAt,
        })),
        players: Object.values(g.players).map((p) => ({
          name: p.name,
          legend: p.legend?.cardCode,
        })),
      })
    })
    setReplayBundle(bundle)
    pendingFileName = name
    pendingGroups = bundle.groups
    importSelectKeys = new Set(bundle.groups.map((g) => g.key))
    // Tauri：为每个 series 写暂存文件（确认后写入真实文件并清理）
    const tmpResults = await Promise.all(bundle.groups.map((g) => writeImportTmp(g.key, g)))
    console.log('[replay-import] 暂存文件写入结果', tmpResults)
    importStage = 'select'
    importOpen = true
    return true
  }

  async function onFileFromModal(text: string, name: string) {
    await onFile(text, name)
  }

  function toggleImportSelect(key: string) {
    const m = new Set(importSelectKeys)
    if (m.has(key)) {
      m.delete(key)
    } else {
      m.add(key)
    }
    importSelectKeys = m
  }

  function selectAllImport() {
    importSelectKeys = new Set(pendingGroups.map((g) => g.key))
  }

  function toggleAllImport() {
    if (importSelectKeys.size === pendingGroups.length) {
      importSelectKeys = new Set()
    } else {
      selectAllImport()
    }
  }

  async function closeImportModal() {
    if (importing) return
    importOpen = false
    importStage = 'drop'
    pendingFileName = null
    pendingGroups = []
    importSelectKeys = new Set()
    await cleanupImportTmp()
  }

  /** 阶段2：确认导入选中系列 → 逐系列写真实文件 → 清理 tmp → 关闭/刷新 */
  async function confirmImport() {
    if (importing || importSelectKeys.size === 0) return
    const selected = pendingGroups.filter((g) => importSelectKeys.has(g.key))
    if (selected.length === 0) return
    console.log('[replay-import] 阶段2 确认导入', {
      selectedKeys: [...importSelectKeys],
      total: pendingGroups.length,
    })
    importing = true
    try {
      if (isTauri) {
        for (const g of selected) {
          const saved = await saveSeriesFile(g, pendingFileName)
          console.log('[replay-import] 写入真实文件', {
            key: g.key,
            fileId: saved?.id,
            fileName: saved?.fileName,
            groupsInFile: saved?.groups.length,
          })
          // 静默重链：本机无绑定但云端已同步该局记录时，补上 replay_key 关联
          const linked = await relinkReplayToSyncedMatch(g.key, {
            roomCode: g.meta.roomCode ?? null,
            startedAt: g.meta.startedAt ?? null,
          })
          if (linked) {
            console.log('[replay-import] 自动关联已同步对局记录', g.key)
          }
        }
        await cleanupImportTmp()
        await refresh()
      } else {
        // 非桌面环境无持久化：以会话内伪文件展示本次导入
        const sessionFiles: StoredReplayFile[] = selected.map((g) => ({
          id: `session-${Date.now()}-${g.key}`,
          fileName: pendingFileName ?? 'replay.json',
          importedAt: Date.now(),
          hash: hashText(JSON.stringify(g)),
          version: 3,
          groups: [g],
        }))
        files = [...sessionFiles, ...files]
        loaded = true
      }
      console.log('[replay-import] 导入完成', { count: selected.length, isTauri })
      showToast(get(t)('replay.importSaved', { values: { count: selected.length } }), 'success')
    } finally {
      importing = false
      await closeImportModal()
    }
  }

  async function onDelete(fileId: string, key: string, label: string) {
    if (deleting) return
    const message = get(t)('replay.deleteConfirm', { values: { room: label } })
    let ok = false
    if (isTauri) {
      const { ask } = await import('@tauri-apps/plugin-dialog')
      ok = await ask(message, {
        title: get(t)('replay.deleteReplay'),
        kind: 'warning',
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      })
    } else {
      ok = window.confirm(message)
    }
    if (!ok) return
    deleting = true
    try {
      const removed = await removeRoom(fileId, key)
      if (!removed) {
        files = files
          .map((f) =>
            f.id === fileId ? { ...f, groups: f.groups.filter((g) => g.key !== key) } : f
          )
          .filter((f) => f.groups.length > 0)
      } else {
        await refresh()
      }
      // 联动清理：该局的 match 记录（含同步墓碑）随复盘删除
      if (isTauri) {
        await deleteMatchByReplayKey(key)
        await loadBindings()
      }
      showToast(get(t)('replay.deleted'), 'success')
    } finally {
      deleting = false
    }
  }

  function enterSelect() {
    selectMode = true
  }

  function cancelSelect() {
    selectMode = false
    selectedKeys = new Set()
  }

  function toggleSelectKey(key: string) {
    const m = new Set(selectedKeys)
    if (m.has(key)) {
      m.delete(key)
    } else {
      m.add(key)
    }
    selectedKeys = m
  }

  function selectAll() {
    selectedKeys = new Set(mergedGroups.map((m) => m.group.key))
  }

  async function onDeleteMany() {
    if (deleting || selectedKeys.size === 0) return
    const selected = mergedGroups.filter((m) => selectedKeys.has(m.group.key))
    if (selected.length === 0) return
    const message = get(t)('replay.deleteSelectedConfirm', {
      values: { count: selected.length },
    })
    let ok = false
    if (isTauri) {
      const { ask } = await import('@tauri-apps/plugin-dialog')
      ok = await ask(message, {
        title: get(t)('replay.deleteReplay'),
        kind: 'warning',
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      })
    } else {
      ok = window.confirm(message)
    }
    if (!ok) return
    deleting = true
    try {
      let removedOnDisk = 0
      const removedKeys = new Set<string>()
      for (const m of selected) {
        const removed = await removeRoom(m.fileId, m.group.key)
        if (removed) {
          removedOnDisk++
        } else {
          removedKeys.add(m.group.key)
        }
      }
      if (removedKeys.size > 0) {
        // 非桌面/未持久化：以会话内伪文件本地过滤
        files = files
          .map((f) => ({
            ...f,
            groups: f.groups.filter((g) => !removedKeys.has(g.key)),
          }))
          .filter((f) => f.groups.length > 0)
      }
      if (removedOnDisk > 0) {
        await refresh()
      }
      // 联动清理：批量删除各局的 match 记录
      if (isTauri) {
        for (const m of selected) {
          await deleteMatchByReplayKey(m.group.key)
        }
        await loadBindings()
      }
      showToast(get(t)('replay.deletedMany', { values: { count: selected.length } }), 'success')
    } finally {
      deleting = false
      cancelSelect()
    }
  }

  async function onRemoveBroken(id: string) {
    await removeFile(id)
    await refresh()
  }
</script>

<div class="page">
  {#if !loaded}
    <div class="loading-hint">
      <span class="spin"><LoaderCircle size={18} /></span>
      <span>{$t('replay.libraryLoading')}</span>
    </div>
  {:else if mergedGroups.length === 0 && brokenIds.length === 0}
    <!-- 空库引导：页面内直接显示导入区；已有复盘时入口收敛到 topbar 按钮 + Modal -->
    <ReplayImportDropzone {onFile} />
    {#if errorText}
      <div class="error-box">{errorText}</div>
    {/if}
    <div class="empty-hint">{$t('replay.emptySaved')}</div>
  {:else}
    <div class="group-title">{$t('replay.savedTitle')} · {mergedGroups.length}</div>
    <div class="group-list">
      {#each sortedGroups as m (m.group.key)}
        <ReplayGroupCard
          group={m.group}
          deckOverlap={deckOverlaps.get(m.group.key) ?? null}
          isBound={bindings.has(m.group.key)}
          onInfo={() => (infoKey = m.group.key)}
          selectable={selectMode}
          selected={selectedKeys.has(m.group.key)}
          onToggleSelect={selectMode ? () => toggleSelectKey(m.group.key) : undefined}
          onReplay={() => goto(`/replay/${encodeURIComponent(m.group.key)}`)}
          onDelete={selectMode
            ? undefined
            : () => onDelete(m.fileId, m.group.key, m.group.meta?.roomCode ?? m.group.key)}
        />
      {/each}
    </div>
    {#if brokenIds.length > 0}
      <div class="broken-box">
        <div class="broken-title">{$t('replay.libraryBrokenTitle')}</div>
        <div class="broken-hint">{$t('replay.libraryBrokenHint')}</div>
        <div class="broken-list">
          {#each brokenIds as id (id)}
            <button class="broken-del" onclick={() => onRemoveBroken(id)}>
              {id} · {$t('replay.deleteReplay')}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<CommonModal
  open={importOpen}
  title={importStage === 'select' ? $t('replay.selectSeriesTitle') : $t('replay.importTitle')}
  subtitle={importStage === 'select' ? $t('replay.selectSeriesHint') : undefined}
  width="min(620px, 100%)"
  onclose={() => void closeImportModal()}
>
  {#if importStage === 'parsing'}
    <div class="loading-hint">
      <span class="spin"><LoaderCircle size={18} /></span>
      <span>{$t('replay.importParsing')}</span>
    </div>
  {:else if importStage === 'select' && pendingGroups.length > 0}
    <ReplayImportSelect
      groups={pendingGroups}
      selectedKeys={importSelectKeys}
      {importing}
      onToggle={toggleImportSelect}
      onToggleAll={toggleAllImport}
      onImport={() => void confirmImport()}
      onCancel={() => void closeImportModal()}
    />
  {:else}
    <ReplayImportDropzone onFile={onFileFromModal} />
    {#if errorText}
      <div class="error-box">{errorText}</div>
    {/if}
  {/if}
</CommonModal>

<SortModal
  bind:sortByList={sortList}
  fields={REPLAY_SORT_FIELDS}
  open={sortOpen}
  onClose={(v) => (sortOpen = v)}
  showTrigger={false}
/>

{#if infoGroup}
  <ReplayInfoModal
    open
    group={infoGroup}
    onClose={() => (infoKey = null)}
    onChanged={() => void loadBindings()}
  />
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    max-width: 1200px;
    margin: 0 auto;
  }
  .error-box {
    background: #fdecea;
    color: #b42318;
    border: 1px solid #f5b5ad;
    border-radius: var(--radius-lg);
    padding: 10px 12px;
    font-size: var(--text-base);
  }
  .empty-hint {
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-base);
    padding: 16px 0;
  }
  .loading-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-tertiary);
    font-size: var(--text-base);
    padding: 48px 0;
  }
  .spin {
    animation: loading-spin 0.9s linear infinite;
  }
  @keyframes loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .group-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin-top: 4px;
  }
  .group-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
    padding: 4px 2px 24px;
  }
  .broken-box {
    background: #fff8ec;
    border: 1px solid #fcd9a8;
    border-radius: var(--radius-lg);
    padding: 10px 12px;
    font-size: var(--text-sm);
  }
  .broken-title {
    font-weight: 600;
    color: #b45309;
  }
  .broken-hint {
    color: var(--text-tertiary);
    margin: 2px 0 8px;
  }
  .broken-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .broken-del {
    background: var(--surface-muted);
    color: #b42318;
    border: 1px solid #f5b5ad;
    border-radius: var(--radius-md);
    padding: 3px 10px;
    cursor: pointer;
    font-size: var(--text-sm);
  }
  .broken-del:hover {
    background: #fdecea;
  }
</style>
