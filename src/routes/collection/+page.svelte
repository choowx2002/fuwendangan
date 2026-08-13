<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import type { CollectionStats } from '$lib/db'
  import {
    getCollectionStats,
    importOwnedCounts,
    getCollectionFullRows,
    importFullCollection,
  } from '$lib/db'
  import {
    Save,
    Plus,
    Upload,
    ScrollText,
    Download,
    History,
    Boxes,
    Heart,
    ArrowLeftRight,
    ShoppingCart,
  } from '@lucide/svelte'
  import { isTauri } from '$lib/db/env'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { parseMissingListCsv } from '$lib/collection/collection-csv'
  import { saveTextFile } from '$lib/collection/collection-export'
  import {
    buildFullCollectionCsv,
    buildFullCollectionCsvTemplate,
    parseFullCollectionCsv,
  } from '$lib/collection/full-collection-csv'
  import { createCsvTemplate } from '$lib/csv/csv-utils'
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
  let loading = $state(true)
  let showCustomCreate = $state(false)

  let importing = $state(false)
  let showImportModal = $state(false)
  let importKind = $state<'missing' | 'full'>('missing')
  // 待确认的导入项与模式
  let importPreview = $state<{
    rows: {
      cardNoExtend: string
      language: string
      ownedQty: number
      normalQty?: number
      foilQty?: number
    }[]
    errors: string[]
    fileName: string
  } | null>(null)
  let importMode = $state<'add' | 'overwrite'>('add')

  async function loadAll() {
    loading = true
    try {
      stats = await getCollectionStats()
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
    if (importKind === 'full') {
      const parsed = parseFullCollectionCsv(content)
      importPreview = {
        rows: parsed.rows.map((r) => ({
          cardNoExtend: r.cardNoExtend,
          language: r.language,
          ownedQty: r.normalQty + r.foilQty,
          normalQty: r.normalQty,
          foilQty: r.foilQty,
        })),
        errors: parsed.errors.map((e) =>
          get(t)('collection.csvLineError', { values: { line: e.line, reason: e.reason } })
        ),
        fileName,
      }
    } else {
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
    }
    importMode = 'add'
    showImportModal = true
  }

  async function confirmImport() {
    if (!importPreview) return
    importing = true
    try {
      if (importKind === 'full') {
        const result = await importFullCollection(
          importPreview.rows.map((r) => ({
            cardNoExtend: r.cardNoExtend,
            language: r.language,
            normalQty: r.normalQty ?? 0,
            foilQty: r.foilQty ?? 0,
          }))
        )
        const skippedText = result.skipped.length
          ? get(t)('collection.fullCsvImportSkipped', { values: { count: result.skipped.length } })
          : ''
        showToast(
          get(t)('collection.fullCsvImported', {
            values: {
              count: result.applied,
              updated: result.updated,
              created: result.created,
              skipped: skippedText,
            },
          }),
          'success'
        )
      } else {
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
      }
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

  async function exportFullCollection() {
    try {
      const rows = await getCollectionFullRows()
      if (rows.length === 0) {
        showToast(get(t)('collection.emptyTitle'), 'info')
        return
      }
      const content = buildFullCollectionCsv(rows)
      const stamp = new Date().toISOString().slice(0, 10)
      const ok = await saveTextFile(content, `收藏完整导出-${stamp}.csv`, {
        format: 'csv',
        title: get(t)('collection.exportFullCsvTitle'),
      })
      if (ok) {
        showToast(
          get(t)('collection.exportFullCsvSaved', { values: { count: rows.length } }),
          'success'
        )
      } else {
        showToast(get(t)('collection.saveCancelled'), 'info')
      }
    } catch (err) {
      showToast(
        get(t)('collection.exportFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    }
  }

  async function downloadImportTemplate() {
    const content =
      importKind === 'full'
        ? buildFullCollectionCsvTemplate()
        : createCsvTemplate(
            ['编号', '卡名', '稀有度', '语言', '拥有数', '需求量'],
            [['ABC-001', '示例卡牌', '普通', 'SC', 0, 3]]
          )
    const name = importKind === 'full' ? '收藏导入模板.csv' : '缺卡清单导入模板.csv'
    const ok = await saveTextFile(content, name, {
      format: 'csv',
      title: get(t)('collection.downloadTemplate'),
    })
    if (!ok) showToast(get(t)('collection.saveCancelled'), 'info')
  }

  function handleGlobalSelect(card: { card_prints?: { card_no_extend: string }[] }) {
    const code = deriveSeriesCode(card.card_prints?.[0]?.card_no_extend)
    if (code) {
      void goto(`/collection/${code}`)
    }
  }

  onMount(() => {
    void loadAll()
  })

  $effect(() => {
    setTopbar({
      title: $t('collection.title'),
      actions: [
        {
          key: 'locker',
          label: $t('nav.locker'),
          icon: Boxes,
          title: $t('nav.locker'),
          onClick: () => void goto('/locker'),
          priority: 1,
        },
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
          onClick: () => {
            importKind = 'missing'
            importPreview = null
            pickImportFile()
          },
          priority: 1,
        },
        {
          key: 'export-full',
          label: $t('collection.exportFullCsv'),
          icon: Upload,
          variant: 'ghost',
          title: $t('collection.exportFullCsvTitle'),
          onClick: () => void exportFullCollection(),
          priority: 5,
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
  <div class="header-row">
    <div class="search-row">
      <GlobalCollectionSearch onSelect={handleGlobalSelect} />
    </div>

    <div class="tools-row">
      <button class="tool-link" onclick={() => void goto('/collection/wishlist')}>
        <Heart size={15} />
        {$t('wishlist.title')}
      </button>
      <button class="tool-link" onclick={() => void goto('/collection/loans')}>
        <ArrowLeftRight size={15} />
        {$t('loans.title')}
      </button>
      <button class="tool-link" onclick={() => void goto('/collection/purchase-lists')}>
        <ShoppingCart size={15} />
        {$t('purchase.title')}
      </button>
    </div>
  </div>

  <div class="hero-area">
    <CollectionHero stats={stats ?? undefined} />
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
    <div class="import-kind-group">
      <button
        class="import-format-option"
        class:active={importKind === 'missing'}
        disabled={importing}
        onclick={() => {
          importKind = 'missing'
          importPreview = null
        }}
      >
        <span class="import-format-name">{$t('collection.importKindMissing')}</span>
      </button>
      <button
        class="import-format-option"
        class:active={importKind === 'full'}
        disabled={importing}
        onclick={() => {
          importKind = 'full'
          importPreview = null
        }}
      >
        <span class="import-format-name">{$t('collection.importKindFull')}</span>
      </button>
    </div>

    <button
      class="import-template-btn"
      disabled={importing}
      onclick={() => void downloadImportTemplate()}
    >
      <Download size={14} />
      {$t('collection.downloadTemplate')}
    </button>

    {#if importPreview}
      {#if importKind === 'missing'}
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
      {/if}
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

  .header-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    width: 100%;
  }

  .search-row {
    flex-shrink: 0;
  }

  .tools-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .tool-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .tool-link:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
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

  .import-kind-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .import-template-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .import-template-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .import-template-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
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
