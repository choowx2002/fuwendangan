<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import type { LockerSummary, CardLocation } from '$lib/db'
  import {
    getLockers,
    createLocker,
    updateLocker,
    deleteLocker,
    findCardLocations,
    searchCards,
  } from '$lib/db'
  import { Star, Plus, Search, X, Trash2, Pencil, ChevronRight, Download, Upload } from '@lucide/svelte'
  import { ask } from '@tauri-apps/plugin-dialog'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { isTauri } from '$lib/db/env'
  import { parseLockerCsv, type LockerCsvParseRow } from '$lib/locker/locker-csv'
  import { exportLockerCsv, importLockerCsv } from '$lib/services/locker-csv-service'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import TagInput from '$lib/components/ui/TagInput.svelte'
  import LockerIconPicker from '$lib/components/locker/LockerIconPicker.svelte'
  import { resolveLockerIcon } from '$lib/components/locker/locker-icons'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  let lockers = $state<LockerSummary[]>([])
  let loading = $state(true)

  let lockerModalOpen = $state(false)
  let editingLocker = $state<LockerSummary | null>(null)
  let lockerName = $state('')
  let lockerDesc = $state('')
  let lockerIcon = $state<string | null>(null)
  let lockerTags = $state<string[]>([])
  let saving = $state(false)

  // 找卡
  let findQuery = $state('')
  let findResults = $state<{ id: string; card_no: string; name: string }[]>([])
  let finding = $state(false)
  let findError = $state('')
  let locations = $state<CardLocation[] | null>(null)
  let locatedName = $state('')
  let findDebounce: ReturnType<typeof setTimeout> | null = null

  // 导出 / 导入
  let exportModalOpen = $state(false)
  let exportOnlyUnplaced = $state(false)
  let exporting = $state(false)
  let importModalOpen = $state(false)
  let importing = $state(false)
  let importPreview = $state<{
    rows: LockerCsvParseRow[]
    errors: string[]
    fileName: string
    content: string
  } | null>(null)

  async function load() {
    loading = true
    try {
      lockers = await getLockers()
    } finally {
      loading = false
    }
  }

  function openCreate() {
    editingLocker = null
    lockerName = ''
    lockerDesc = ''
    lockerIcon = null
    lockerTags = []
    lockerModalOpen = true
  }

  function openEdit(l: LockerSummary) {
    editingLocker = l
    lockerName = l.name
    lockerDesc = l.description ?? ''
    lockerIcon = l.icon
    lockerTags = [...(l.tags ?? [])]
    lockerModalOpen = true
  }

  async function saveLocker() {
    if (!lockerName.trim()) {
      showToast(get(t)('locker.lockerName'), 'error')
      return
    }
    saving = true
    try {
      if (editingLocker) {
        await updateLocker(editingLocker.id, {
          name: lockerName.trim(),
          description: lockerDesc.trim() || null,
          icon: lockerIcon,
          tags: lockerTags,
        })
      } else {
        await createLocker({
          name: lockerName.trim(),
          description: lockerDesc.trim() || null,
          icon: lockerIcon,
          tags: lockerTags,
        })
      }
      lockerModalOpen = false
      void load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      saving = false
    }
  }

  async function toggleFavorite(l: LockerSummary) {
    await updateLocker(l.id, { is_favorite: l.is_favorite ? 0 : 1 })
    void load()
  }

  async function removeLocker(l: LockerSummary) {
    const ok = await ask(get(t)('locker.deleteConfirm', { values: { name: l.name } }), {
      title: get(t)('locker.delete'),
      kind: 'warning',
      okLabel: get(t)('locker.delete'),
      cancelLabel: get(t)('common.cancel'),
    })
    if (!ok) return
    await deleteLocker(l.id)
    void load()
  }

  async function runFind() {
    const q = findQuery.trim()
    if (!q) return
    finding = true
    findError = ''
    try {
      const res = await searchCards({ page: 1, pageSize: 8, searchText: q, is_banned: false, ownership: 'owned' })
      findResults = res.data.map((c) => ({
        id: c.id,
        card_no: c.card_no ?? '',
        name: c.card_name_cn ?? c.card_name_en ?? c.card_no ?? '',
      }))
    } catch (err) {
      findError = get(t)('common.searchFailedRetry')
      findResults = []
    } finally {
      finding = false
    }
  }

  function onFindInput() {
    locations = null
    if (findDebounce) clearTimeout(findDebounce)
    const q = findQuery.trim()
    if (!q) {
      findResults = []
      return
    }
    findDebounce = setTimeout(() => void runFind(), 250)
  }

  async function selectLocatedCard(c: { card_no: string; name: string }) {
    findResults = []
    locatedName = c.name
    locations = await findCardLocations(c.card_no)
  }

  async function handleExport() {
    if (exporting) return
    exporting = true
    try {
      const result = await exportLockerCsv({ onlyUnplaced: exportOnlyUnplaced })
      if (result.saved) {
        showToast(get(t)('locker.exportSaved', { values: { count: result.count } }), 'success')
      } else {
        showToast(get(t)('locker.exportCancelled'), 'info')
      }
      exportModalOpen = false
    } catch (err) {
      showToast(
        get(t)('locker.exportFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    } finally {
      exporting = false
    }
  }

  async function pickImportFile() {
    try {
      if (isTauri) {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readTextFile } = await import('$lib/services/db-file-service')
        const src = await open({
          title: get(t)('locker.pickLockerCsv'),
          multiple: false,
          filters: [{ name: get(t)('locker.csvFile'), extensions: ['csv'] }],
        })
        if (!src) return
        const content = await readTextFile(String(src))
        const fileName = String(src).split(/[\\/]/).pop() ?? String(src)
        reviewImport(fileName, content)
      } else {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.csv,text/csv'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => reviewImport(file.name, String(reader.result ?? ''))
          reader.readAsText(file)
        }
        input.click()
      }
    } catch (err) {
      showToast(
        get(t)('locker.readFileFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    }
  }

  function reviewImport(fileName: string, content: string) {
    const parsed = parseLockerCsv(content)
    importPreview = {
      rows: parsed.rows,
      errors: parsed.errors.map((e) =>
        get(t)('collection.csvLineError', { values: { line: e.line, reason: e.reason } })
      ),
      fileName,
      content,
    }
    importModalOpen = true
  }

  async function confirmImport() {
    if (!importPreview || importing) return
    importing = true
    try {
      const result = await importLockerCsv(importPreview.content)
      const skippedText = result.skipped.length
        ? get(t)('locker.skippedInfo', { values: { count: result.skipped.length } })
        : ''
      showToast(
        get(t)('locker.importedCount', {
          values: { count: result.applied, skipped: skippedText },
        }),
        result.applied > 0 ? 'success' : 'info'
      )
      importModalOpen = false
      importPreview = null
      void load()
    } catch (err) {
      showToast(
        get(t)('locker.importFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    } finally {
      importing = false
    }
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: $t('locker.title'),
      actions: [
        {
          key: 'export',
          label: $t('locker.exportCsv'),
          icon: Download,
          title: $t('locker.exportCsvTitle'),
          variant: 'ghost',
          priority: 1,
          onClick: () => (exportModalOpen = true),
        },
        {
          key: 'import',
          label: $t('locker.importCsv'),
          icon: Upload,
          title: $t('locker.importCsvTitle'),
          variant: 'ghost',
          priority: 1,
          onClick: () => void pickImportFile(),
        },
        {
          key: 'new',
          label: $t('locker.newLocker'),
          icon: Plus,
          title: $t('locker.newLocker'),
          onClick: openCreate,
        },
      ],
    })
  })
</script>

<div class="page-wrapper">
  <div class="find-card search-bar search-bar--sm">
    <Search size={15} class="search-bar-icon" />
    <input
      class="search-bar-input"
      bind:value={findQuery}
      placeholder={$t('locker.findCardPlaceholder')}
      oninput={onFindInput}
      onkeydown={(e) => {
        if (e.key === 'Enter') void runFind()
      }}
    />
    {#if findQuery}
      <button
        class="search-bar-clear"
        title={$t('common.clear')}
        onclick={() => {
          findQuery = ''
          findResults = []
          locations = null
        }}
      >
        <X size={14} />
      </button>
    {/if}
  </div>

    {#if findResults.length > 0}
      <div class="find-results">
        {#each findResults as r (r.id)}
          <button class="find-item" onclick={() => selectLocatedCard(r)}>
            <span class="find-no">{r.card_no}</span>
            <span class="find-name">{r.name}</span>
          </button>
        {/each}
      </div>
    {:else if finding}
      <div class="find-hint">{$t('locker.searching')}</div>
    {:else if findError}
      <div class="find-hint error">{findError}</div>
    {:else if findQuery && !locations}
      <div class="find-hint">{$t('locker.noResults')}</div>
    {/if}

    {#if locations}
      <div class="locations">
        <div class="locations-title">
          {$t('locker.foundLocations', { values: { name: locatedName } })}
        </div>
        {#if locations.length === 0}
          <div class="locations-empty">{$t('locker.noLocation')}</div>
        {:else}
          {#each locations as loc (loc.lockerId + loc.sectionId + loc.quantity)}
            <button
              class="location-item"
              onclick={() => void goto(`/locker/${loc.lockerId}/${loc.sectionId}`)}
            >
              <span class="location-path">
                {loc.lockerName}
                {#if loc.sectionName}· {loc.sectionName}{/if}
              </span>
              <span class="location-qty">×{loc.quantity}</span>
              <ChevronRight size={14} class="location-arrow" />
            </button>
          {/each}
        {/if}
      </div>
    {/if}

  <div class="locker-list">
    {#if loading}
      <div class="list-tip">{$t('common.loading')}</div>
    {:else if lockers.length === 0}
      <div class="list-tip">{$t('locker.empty')}</div>
    {:else}
      {#each lockers as l (l.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="locker-card"
          role="button"
          tabindex="0"
          onclick={() => void goto(`/locker/${l.id}`)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              void goto(`/locker/${l.id}`)
            }
          }}
        >
          <div class="locker-plate">
            <span class="locker-name-row">
              <img class="locker-icon" src={resolveLockerIcon(l.icon)} alt="" />
              <span class="locker-name">{l.name}</span>
            </span>
            <button
              class="favorite-btn"
              class:active={l.is_favorite === 1}
              title={$t('locker.favorite')}
              onclick={(e) => {
                e.stopPropagation()
                void toggleFavorite(l)
              }}
            >
              <Star size={15} class={l.is_favorite === 1 ? 'fav-filled' : ''} />
            </button>
            <div class="locker-actions">
              <button
                class="mini-btn"
                title={$t('locker.editLocker')}
                onclick={(e) => {
                  e.stopPropagation()
                  openEdit(l)
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                class="mini-btn danger"
                title={$t('locker.delete')}
                onclick={(e) => {
                  e.stopPropagation()
                  void removeLocker(l)
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {#if l.description}
            <div class="locker-desc">{l.description}</div>
          {/if}
          <div class="locker-meta">
            <span>{$t('locker.sections', { values: { count: l.sectionCount } })}</span>
            <span>{$t('locker.cards', { values: { count: l.cardCount } })}</span>
          </div>
          {#if l.tags && l.tags.length > 0}
            <div class="locker-tags">
              {#each l.tags.slice(0, 3) as tag (tag)}
                <span class="locker-tag">{tag}</span>
              {/each}
              {#if l.tags.length > 3}
                <span class="locker-tag-more">+{l.tags.length - 3}</span>
              {/if}
            </div>
          {/if}
          <span class="locker-handle" aria-hidden="true"></span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<CommonModal
  open={lockerModalOpen}
  title={editingLocker ? $t('locker.editLocker') : $t('locker.newLocker')}
  width="min(460px, 100%)"
  onclose={() => (lockerModalOpen = false)}
>
  <div class="form">
    <label class="field">
      <span class="field-label">{$t('locker.lockerName')}</span>
      <input
        class="input"
        bind:value={lockerName}
        placeholder={$t('locker.lockerNamePlaceholder')}
      />
    </label>
    <label class="field">
      <span class="field-label">{$t('locker.description')}</span>
      <input
        class="input"
        bind:value={lockerDesc}
        placeholder={$t('locker.descriptionPlaceholder')}
      />
    </label>
    <div class="field">
      <span class="field-label">{$t('locker.icon')}</span>
      <LockerIconPicker value={lockerIcon} onChange={(v) => (lockerIcon = v)} />
    </div>
    <label class="field">
      <span class="field-label">{$t('locker.tags')}</span>
      <TagInput value={lockerTags} placeholder={$t('locker.tagPlaceholder')} onChange={(v) => (lockerTags = v)} />
    </label>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (lockerModalOpen = false)}>
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" disabled={saving} onclick={saveLocker}>
      {saving ? $t('common.loading') : $t('locker.save')}
    </button>
  {/snippet}
</CommonModal>

<CommonModal
  open={exportModalOpen}
  title={$t('locker.exportCsvTitle')}
  closable={!exporting}
  onclose={() => {
    if (!exporting) exportModalOpen = false
  }}
>
  <div class="import-preview">
    <div class="import-mode-group">
      <button
        class="import-format-option"
        class:active={!exportOnlyUnplaced}
        disabled={exporting}
        onclick={() => (exportOnlyUnplaced = false)}
      >
        <span class="import-format-name">{$t('locker.exportAllOwned')}</span>
        <span class="import-format-desc">{$t('locker.exportAllOwnedDesc')}</span>
      </button>
      <button
        class="import-format-option"
        class:active={exportOnlyUnplaced}
        disabled={exporting}
        onclick={() => (exportOnlyUnplaced = true)}
      >
        <span class="import-format-name">{$t('locker.exportUnplacedOnly')}</span>
        <span class="import-format-desc">{$t('locker.exportUnplacedOnlyDesc')}</span>
      </button>
    </div>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" disabled={exporting} onclick={() => (exportModalOpen = false)}>
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" disabled={exporting} onclick={() => void handleExport()}>
      {exporting ? $t('locker.exporting') : $t('locker.exportConfirm')}
    </button>
  {/snippet}
</CommonModal>

<CommonModal
  open={importModalOpen}
  title={$t('locker.importCsvTitle')}
  subtitle={importPreview?.fileName ?? ''}
  closable={!importing}
  onclose={() => {
    if (!importing) importModalOpen = false
  }}
>
  <div class="import-preview">
    {#if importPreview}
      <div class="import-stats">
        {$t('locker.parsedRows', { values: { count: importPreview.rows.length } })}
        {#if importPreview.errors.length > 0}
          · {$t('locker.skippedRows', { values: { count: importPreview.errors.length } })}
        {/if}
      </div>
      {#if importPreview.errors.length > 0}
        <div class="import-errors">
          {#each importPreview.errors as e (e)}
            <div class="import-error-line">{e}</div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    <button
      class="button button-ghost"
      disabled={importing}
      onclick={() => (importModalOpen = false)}
    >
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      disabled={importing || !importPreview || importPreview.rows.length === 0}
      onclick={() => void confirmImport()}
    >
      {importing ? $t('locker.importing') : $t('locker.confirmImport')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .page-wrapper {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .find-card {
    flex-shrink: 0;
  }

  .find-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    padding: 6px;
  }

  .find-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    font-size: var(--text-sm);
  }

  .find-item:hover {
    background: var(--bg-hover);
  }

  .find-no {
    font-weight: 600;
    color: var(--accent-color);
    flex-shrink: 0;
  }

  .find-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .find-hint {
    margin-top: 8px;
    padding: 4px 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .find-hint.error {
    color: #ef4444;
  }

  .locations {
    margin-top: 10px;
    border-top: 1px solid var(--border-color);
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .locations-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .locations-empty {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .location-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    font-size: var(--text-sm);
  }

  .location-item:hover {
    border-color: var(--accent-color);
  }

  .location-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .location-qty {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--accent-color);
  }

  :global(.location-arrow) {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }

  .locker-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  .locker-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid var(--border-color);
    background: var(--surface);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .locker-card:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.25);
  }

  .locker-plate {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid color-mix(in oklab, var(--accent-color) 28%, transparent);
    background: color-mix(in oklab, var(--accent-color) 8%, var(--surface));
  }

  .locker-handle {
    position: absolute;
    top: 14px;
    right: 8px;
    width: 4px;
    height: 40px;
    border-radius: 2px;
    background: var(--accent-color);
  }

  .locker-name {
    font-size: var(--text-md);
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .locker-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .locker-icon {
    width: 22px;
    height: 22px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .favorite-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .favorite-btn.active {
    color: #eab308;
  }

  :global(.fav-filled) {
    fill: currentColor;
  }

  .locker-desc {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    min-height: 16px;
  }

  .locker-meta {
    display: flex;
    gap: 10px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .locker-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .locker-tag {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .locker-tag-more {
    padding: 1px 6px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .locker-actions {
    position: absolute;
    top: 50%;
    right: 38px;
    transform: translateY(-50%);
    display: none;
    gap: 4px;
  }

  .locker-card:hover .locker-actions,
  .locker-card:focus-visible .locker-actions {
    display: flex;
  }

  .mini-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .mini-btn.danger {
    color: #ef4444;
  }

  .list-tip {
    grid-column: 1 / -1;
    padding: 40px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .import-preview {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .import-mode-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .import-format-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: all 0.15s;
  }

  .import-format-option:hover:not(:disabled) {
    border-color: var(--accent-color);
  }

  .import-format-option.active {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: #fff;
  }

  .import-format-option:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .import-format-name {
    font-size: var(--text-sm);
    font-weight: 600;
    flex-shrink: 0;
  }

  .import-format-desc {
    font-size: var(--text-xs);
    opacity: 0.75;
  }

  .import-stats {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .import-errors {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    border-radius: 8px;
    background: var(--bg-secondary);
    max-height: 140px;
    overflow-y: auto;
  }

  .import-error-line {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .input {
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    outline: none;
  }

  .input:focus {
    border-color: var(--accent-color);
  }

  @media (max-width: 600.99px) {
    .page-wrapper {
      padding: 12px 16px 24px;
    }

    .locker-list {
      grid-template-columns: 1fr;
    }

    .locker-actions {
      display: flex;
    }
  }
</style>
