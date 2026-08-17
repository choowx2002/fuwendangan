<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { setReplayBundle } from '$lib/stores/replay-import.svelte'
  import { isTauri } from '$lib/db/env'
  import { parseRiftExport, ReplayImportError } from '$lib/replay/import-parser'
  import type { ImportBundle, ReplayGroup } from '$lib/replay/types'
  import {
    loadLibrary,
    saveLibraryFile,
    removeRoom,
    removeFile,
    hashText,
    type StoredReplayFile,
  } from '$lib/services/replay-library-service'
  import ReplayImportDropzone from '$lib/components/replay/ReplayImportDropzone.svelte'
  import ReplayGroupCard from '$lib/components/replay/ReplayGroupCard.svelte'

  interface MergedGroup {
    group: ReplayGroup
    fileId: string
  }

  let files = $state<StoredReplayFile[]>([])
  let brokenIds = $state<string[]>([])
  let errorText = $state<string | null>(null)
  let loaded = $state(false)
  let deleting = $state(false)

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

  $effect(() => {
    setTopbar({ title: $t('replay.title'), onBack: () => void goto('/') })
  })

  onMount(refresh)

  async function refresh() {
    const res = await loadLibrary()
    files = res.files
    brokenIds = res.brokenIds
    loaded = true
  }

  function onFile(text: string, name: string) {
    errorText = null
    let bundle: ImportBundle
    try {
      bundle = parseRiftExport(text, { fileName: name })
    } catch (e) {
      if (e instanceof ReplayImportError) {
        errorText = get(t)(
          e.code === 'not-json'
            ? 'replay.parseNotJson'
            : e.code === 'no-matches'
              ? 'replay.noMatches'
              : 'replay.parseFailed',
          { values: { error: e.message } }
        )
      } else {
        errorText = get(t)('replay.parseFailed', { values: { error: String(e) } })
      }
      return
    }
    setReplayBundle(bundle)
    void (async () => {
      const saved = await saveLibraryFile(name, text, bundle.groups)
      if (saved) {
        await refresh()
      } else {
        // 非桌面环境无持久化：以会话内伪文件展示本次导入
        const sessionFile: StoredReplayFile = {
          id: `session-${Date.now()}`,
          fileName: name,
          importedAt: Date.now(),
          hash: hashText(text),
          groups: bundle.groups,
        }
        files = [sessionFile, ...files]
        loaded = true
      }
      showToast(
        get(t)('replay.importSaved', { values: { count: bundle.groups.length } }),
        'success'
      )
    })()
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
      showToast(get(t)('replay.deleted'), 'success')
    } finally {
      deleting = false
    }
  }

  async function onRemoveBroken(id: string) {
    await removeFile(id)
    await refresh()
  }
</script>

<div class="page">
  <ReplayImportDropzone {onFile} />
  {#if errorText}
    <div class="error-box">{errorText}</div>
  {/if}

  {#if !loaded}
    <div class="empty-hint">{$t('replay.libraryLoading')}</div>
  {:else if mergedGroups.length === 0 && brokenIds.length === 0}
    <div class="empty-hint">{$t('replay.emptySaved')}</div>
  {:else}
    <div class="group-title">{$t('replay.savedTitle')} · {mergedGroups.length}</div>
    <div class="group-list">
      {#each mergedGroups as m (m.group.key)}
        <ReplayGroupCard
          group={m.group}
          deckOverlap={null}
          onReplay={() => goto(`/replay/${encodeURIComponent(m.group.key)}`)}
          onDelete={() => onDelete(m.fileId, m.group.key, m.group.roomCode ?? m.group.key)}
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

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    max-width: 860px;
    margin: 0 auto;
  }
  .error-box {
    background: #fdecea;
    color: #b42318;
    border: 1px solid #f5b5ad;
    border-radius: var(--radius-lg);
    padding: 10px 12px;
    font-size: 13px;
  }
  .empty-hint {
    text-align: center;
    color: var(--text-tertiary);
    font-size: 13px;
    padding: 16px 0;
  }
  .group-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-top: 4px;
  }
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .broken-box {
    background: #fff8ec;
    border: 1px solid #fcd9a8;
    border-radius: var(--radius-lg);
    padding: 10px 12px;
    font-size: 12px;
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
    font-size: 12px;
  }
  .broken-del:hover {
    background: #fdecea;
  }
</style>
