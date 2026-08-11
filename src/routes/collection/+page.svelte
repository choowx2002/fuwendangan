<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import type { CollectionStats, RecentCollectionCard } from '$lib/db'
  import { getCollectionStats, getRecentCollectionCards, importOwnedCounts } from '$lib/db'
  import { Save, Plus, Upload, ScrollText, Download, History } from '@lucide/svelte'
  import { isTauri } from '$lib/db/env'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { parseMissingListCsv } from '$lib/collection/collection-csv'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import CollectionHero from '$lib/components/collection/CollectionHero.svelte'
  import SeriesCardGrid from '$lib/components/collection/SeriesCardGrid.svelte'
  import GlobalCollectionSearch from '$lib/components/collection/GlobalCollectionSearch.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import CustomPrintCreator from '$lib/components/collection/CustomPrintCreator.svelte'
  import { deriveSeriesCode } from '$lib/collection/collection-utils'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  let stats = $state<CollectionStats | null>(null)
  let recent = $state<RecentCollectionCard[]>([])
  let loading = $state(true)
  let showCustomCreate = $state(false)

  let importing = $state(false)
  let showImportModal = $state(false)
  // 待确认的导入项与模式
  let importPreview = $state<{
    rows: { cardNoExtend: string; language: string; ownedQty: number }[]
    errors: string[]
    fileName: string
  } | null>(null)
  let importMode = $state<'add' | 'overwrite'>('add')

  async function loadAll() {
    loading = true
    try {
      const [statsRes, recentRes] = await Promise.all([
        getCollectionStats(),
        getRecentCollectionCards(6),
      ])
      stats = statsRes
      recent = recentRes
    } finally {
      loading = false
    }
  }

  async function pickImportFile() {
    try {
      if (isTauri) {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readTextFile } = await import('$lib/services/db-file-service')
        const src = await open({
          title: get(t)('collection.pickMissingCsv'),
          multiple: false,
          filters: [{ name: get(t)('collection.csvFile'), extensions: ['csv'] }],
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
        get(t)('collection.readFileFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    }
  }

  function reviewImport(fileName: string, content: string) {
    const parsed = parseMissingListCsv(content)
    importPreview = {
      rows: parsed.rows.map((r) => ({
        cardNoExtend: r.cardNoExtend,
        language: r.language,
        ownedQty: r.ownedQty,
      })),
      errors: parsed.errors.map((e) =>
        get(t)('collection.csvLineError', { values: { line: e.line, reason: e.reason } })
      ),
      fileName,
    }
    importMode = 'add'
    showImportModal = true
  }

  async function confirmImport() {
    if (!importPreview) return
    importing = true
    try {
      const result = await importOwnedCounts(importPreview.rows, importMode)
      const skippedText = result.skipped.length
        ? get(t)('collection.skippedInfo', { values: { count: result.skipped.length } })
        : ''
      showToast(
        get(t)('collection.importedCount', {
          values: { count: result.applied, skipped: skippedText },
        }),
        'success'
      )
      showImportModal = false
      importPreview = null
      void loadAll()
    } catch (err) {
      showToast(
        get(t)('collection.importFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    } finally {
      importing = false
    }
  }

  function handleGlobalSelect(card: { card_prints?: { card_no_extend: string }[] }) {
    const code = deriveSeriesCode(card.card_prints?.[0]?.card_no_extend)
    if (code) {
      void goto(`/collection/${code}`)
    }
  }

  function handleRecentClick(c: RecentCollectionCard) {
    if (c.seriesCode) void goto(`/collection/${c.seriesCode}`)
  }

  onMount(() => {
    void loadAll()
  })

  $effect(() => {
    setTopbar({
      title: $t('collection.title'),
      actions: [
        {
          key: 'history',
          label: $t('collection.history'),
          icon: History,
          variant: 'ghost',
          title: $t('collection.historyTitle'),
          onClick: () => void goto('/collection/history'),
          priority: 1,
        },
        {
          key: 'import',
          label: $t('collection.importCsv'),
          icon: Download,
          variant: 'ghost',
          title: $t('collection.importCsvTitle'),
          onClick: pickImportFile,
          priority: 1,
        },
        {
          key: 'custom',
          label: $t('collection.customCards'),
          icon: Plus,
          title: $t('collection.newCustomCard'),
          onClick: () => (showCustomCreate = true),
        },
        {
          key: 'missing',
          label: $t('collection.missingList'),
          icon: ScrollText,
          onClick: () => void goto('/collection/missing'),
          variant: 'primary',
          priority: 0,
        },
      ],
    })
  })
</script>

<div class="page-wrapper">
  <div class="search-row">
    <GlobalCollectionSearch onSelect={handleGlobalSelect} />
  </div>

  <div class="hero-area">
    <CollectionHero stats={stats ?? undefined} {recent} onRecentClick={handleRecentClick} />
  </div>

  <div class="series-area">
    {#if loading && !stats}
      <div class="loading-tip">{$t('collection.loadingProgress')}</div>
    {:else if stats && stats.series.length === 0}
      <EmptyState
        title={$t('collection.emptyTitle')}
        description={$t('collection.emptyDesc')}
        actionLabel={$t('collection.browseCards')}
        onAction={() => void goto('/cards')}
      />
    {:else}
      <SeriesCardGrid
        series={stats?.series ?? []}
        onSelect={(code) => void goto(`/collection/${code}`)}
      />
    {/if}
  </div>

  <CustomPrintCreator
    isOpen={showCustomCreate}
    onClose={() => (showCustomCreate = false)}
    onSaved={() => void loadAll()}
  />
</div>

<CommonModal
  open={showImportModal}
  title={$t('collection.importCsvTitle')}
  subtitle={importPreview?.fileName ?? ''}
  closable={!importing}
  onclose={() => {
    if (!importing) showImportModal = false
  }}
>
  <div class="import-preview">
    {#if importPreview}
      <div class="import-mode-group">
        <button
          class="import-format-option"
          class:active={importMode === 'add'}
          disabled={importing}
          onclick={() => (importMode = 'add')}
        >
          <span class="import-format-name">{$t('collection.addMode')}</span>
          <span class="import-format-desc">{$t('collection.addModeDesc')}</span>
        </button>
        <button
          class="import-format-option"
          class:active={importMode === 'overwrite'}
          disabled={importing}
          onclick={() => (importMode = 'overwrite')}
        >
          <span class="import-format-name">{$t('collection.overwriteMode')}</span>
          <span class="import-format-desc">{$t('collection.overwriteModeDesc')}</span>
        </button>
      </div>
      <div class="import-stats">
        {$t('collection.parsedRows', { values: { count: importPreview.rows.length } })}
        {#if importPreview.errors.length > 0}
          · {$t('collection.skippedRows', { values: { count: importPreview.errors.length } })}
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
      onclick={() => (showImportModal = false)}
    >
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      disabled={importing || !importPreview || importPreview.rows.length === 0}
      onclick={confirmImport}
    >
      {importing ? $t('collection.importing') : $t('collection.confirmImport')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .page-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px 24px 0;
    gap: 14px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .search-row {
    flex-shrink: 0;
  }

  .hero-area {
    flex-shrink: 0;
  }

  .series-area {
    flex: 1;
    /* overflow-y: auto; */
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
  }

  .loading-tip {
    padding: 48px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
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

  @media (max-width: 600.99px) {
    .page-wrapper {
      padding: 12px 16px 0;
    }
  }
</style>
