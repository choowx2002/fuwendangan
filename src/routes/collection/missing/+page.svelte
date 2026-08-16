<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import type { CollectionStats, MissingListRow } from '$lib/db'
  import {
    getCollectionStats,
    getCustomLanguages,
    getFilterOptions,
    getMissingListRarityOptions,
    getMissingVariants,
    languageDisplayName,
    PRESET_LANGUAGE_CODES,
  } from '$lib/db'
  import { ChevronDown, FileText, Filter, Save, X } from '@lucide/svelte'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import type { MissingExportFormat, MissingListTextRow } from '$lib/collection/collection-export'
  import {
    buildMissingListCsv,
    buildMissingListText,
    saveMissingList,
  } from '$lib/collection/collection-export'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import type { VariantBucket } from '$lib/cards/utils/variant-utils'
  import { BUCKET_LABELS } from '$lib/cards/utils/variant-utils'
  import { combineCardName } from '$lib/collection/collection-utils'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  const DEFAULT_NEED = 3

  const BUCKET_LABEL_KEYS: Record<VariantBucket, string> = {
    base: 'collection.bucketBase',
    alt: 'collection.bucketAlt',
    overnum: 'collection.bucketOvernum',
    rune: 'collection.bucketRune',
    token: 'collection.bucketToken',
  }

  const urlSeries = page.url.searchParams.get('seriesCode') ?? ''
  const urlBucket = page.url.searchParams.get('bucket')
  const isNarrowLayout = window.matchMedia('(max-width: 899.98px)').matches

  let stats = $state<CollectionStats | null>(null)
  let series = $state<string>(urlSeries)
  let bucket = $state<string | null>(urlBucket && urlBucket in BUCKET_LABELS ? urlBucket : null)
  let selectedRarities = $state<string[]>([])
  let selectedCategories = $state<string[]>([])
  let selectedColors = $state<string[]>([])
  let rarityOptions = $state<string[]>([])
  let categoryOptions = $state<string[]>([])
  let colorOptions = $state<string[]>([])
  let language = $state<string>('SC')
  let langOptions = $state<string[]>([])
  let customLangNames = $state<Map<string, string>>(new Map())

  let rows = $state<MissingListRow[]>([])
  let needs = $state<Map<string, number>>(new Map())
  let includeComplete = $state(false)
  let loadingRows = $state(false)
  let loadSeq = 0
  let exporting = $state(false)
  type SortKey = 'no' | 'name' | 'rarity' | 'owned' | 'need'

  let showExportModal = $state(false)
  let exportFormat = $state<MissingExportFormat>('txt')
  let filtersCollapsed = $state(isNarrowLayout)
  let sortKey = $state<SortKey>('no')
  let sortAsc = $state(true)

  const seriesOptions = $derived(stats?.series ?? [])
  const seriesTitle = $derived(seriesOptions.find((s) => s.code === series)?.nameCn ?? series ?? '')
  const selectedCount = $derived(
    (series ? 1 : 0) +
      (bucket ? 1 : 0) +
      selectedRarities.length +
      selectedCategories.length +
      selectedColors.length +
      (language !== 'SC' ? 1 : 0)
  )

  const variantKey = (r: MissingListRow) => `${r.cardNo}|${r.cardNoExtend}`
  const needOf = (r: MissingListRow) => needs.get(variantKey(r)) ?? DEFAULT_NEED
  const satisfiedOf = (r: MissingListRow) => r.ownedQty >= needOf(r)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortAsc = !sortAsc
    } else {
      sortKey = key
      sortAsc = true
    }
  }

  const sortedRows = $derived(
    [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'no':
          cmp = String(a.cardNoExtend ?? '').localeCompare(
            String(b.cardNoExtend ?? ''),
            undefined,
            {
              numeric: true,
            }
          )
          break
        case 'name':
          cmp = `${a.cardNameCn ?? ''}${a.subCn ?? ''}`.localeCompare(
            `${b.cardNameCn ?? ''}${b.subCn ?? ''}`,
            'zh'
          )
          break
        case 'rarity':
          cmp = (a.rarity ?? '').localeCompare(b.rarity ?? '', 'zh')
          break
        case 'owned':
          cmp = a.ownedQty - b.ownedQty
          break
        case 'need':
          cmp = needOf(a) - needOf(b)
          break
      }
      return sortAsc ? cmp : -cmp
    })
  )

  const missingRows = $derived(sortedRows.filter((r) => !satisfiedOf(r)))
  const satisfiedCount = $derived(sortedRows.length - missingRows.length)

  async function loadOptions() {
    const [opts, rarities, customs, statsRes] = await Promise.all([
      getFilterOptions(),
      getMissingListRarityOptions(),
      getCustomLanguages(),
      getCollectionStats(),
    ])
    rarityOptions = rarities
    categoryOptions = opts?.categories ?? []
    colorOptions = opts?.colors ?? []
    customLangNames = new Map(customs.map((c) => [c.code, c.name]))
    langOptions = [...PRESET_LANGUAGE_CODES, ...customs.map((c) => c.code)]
    stats = statsRes
  }

  async function loadRows() {
    const seq = ++loadSeq
    loadingRows = true
    try {
      const result = await getMissingVariants({
        seriesCode: series || undefined,
        bucket: bucket ?? undefined,
        rarities: selectedRarities.length ? selectedRarities : undefined,
        categories: selectedCategories.length ? selectedCategories : undefined,
        colors: selectedColors.length ? selectedColors : undefined,
        language: language || undefined,
      })
      if (seq !== loadSeq) return
      rows = result
    } catch {
      if (seq !== loadSeq) return
      rows = []
    } finally {
      if (seq === loadSeq) loadingRows = false
    }
  }

  function resetFilters() {
    series = ''
    bucket = null
    selectedRarities = []
    selectedCategories = []
    selectedColors = []
    language = 'SC'
  }

  function toggle(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
  }

  function updateNeed(key: string, raw: number) {
    needs.set(key, Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0)))
  }

  async function handleExport(format: MissingExportFormat) {
    // CSV 要求语言明确：避免“全部语言”的跨语言汇总数量被回导到单一语言
    if (format === 'csv' && !language) {
      showToast(get(t)('collection.csvNeedsLanguage'), 'error')
      showExportModal = false
      return
    }
    exporting = true
    try {
      const items = includeComplete ? rows : missingRows
      const textRows: MissingListTextRow[] = items.map((r) => ({
        cardNoExtend: r.cardNoExtend,
        cardNameCn: combineCardName(r.cardNameCn, r.subCn),
        rarity: r.rarity,
        language,
        ownedQty: r.ownedQty,
        needed: needOf(r),
        satisfied: satisfiedOf(r),
      }))
      const chosen = series ? seriesOptions.find((s) => s.code === series) : undefined
      const content =
        format === 'csv'
          ? buildMissingListCsv(textRows)
          : buildMissingListText(
              textRows,
              chosen?.nameCn ?? series ?? null,
              series ? (chosen?.totalOwned ?? 0) : (stats?.overallOwned ?? 0),
              series ? (chosen?.totalCount ?? 0) : (stats?.overallCount ?? 0)
            )
      const stamp = new Date().toISOString().slice(0, 10)
      const code = series || get(t)('collection.allSeries')
      const ok = await saveMissingList(
        content,
        `${get(t)('collection.missingListPrefix')}-${code}-${stamp}.${format}`,
        format
      )
      if (ok) {
        showToast(
          get(t)('collection.savedDetail', { values: { count: textRows.length } }),
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
    } finally {
      exporting = false
      showExportModal = false
    }
  }

  onMount(() => {
    void loadOptions()
  })

  $effect(() => {
    void loadRows()
  })

  $effect(() => {
    setTopbar({
      title: $t('collection.missingList'),
      description: seriesTitle,
      onBack: () => goto('/collection'),
    })
  })
</script>

<div class="page-wrapper">
  <div class="layout">
    <aside class="filter-panel" class:collapsed={filtersCollapsed}>
      <div class="filter-bar">
        <button class="filter-toggle" onclick={() => (filtersCollapsed = !filtersCollapsed)}>
          <Filter size={14} />
          {$t('collection.filter')}
          {#if selectedCount > 0}<span class="filter-count"
              >{$t('collection.selectedCount', { values: { count: selectedCount } })}</span
            >{/if}
          <span class="chevron-wrap" class:rotated={!filtersCollapsed}>
            <ChevronDown class="chevron" size={14} />
          </span>
        </button>
        {#if bucket}
          <span class="bucket-badge">
            {$t('collection.bucketLabel')}: {$t(BUCKET_LABEL_KEYS[bucket as VariantBucket])}
            <button
              class="badge-clear"
              onclick={() => (bucket = null)}
              aria-label={$t('collection.clearBucket')}
            >
              <X size={12} />
            </button>
          </span>
        {/if}
        <button class="reset-btn" onclick={resetFilters}>{$t('common.reset')}</button>
      </div>

      <div class="filter-body" class:hidden={filtersCollapsed}>
        <div class="select-row">
          <div class="option-group">
            <div class="option-label">{$t('collection.setLabel')}</div>
            <select class="series-select" bind:value={series}>
              <option value="">{$t('collection.allSeries')}</option>
              {#each seriesOptions as s (s.code)}
                <option value={s.code}>{s.nameCn ?? s.code}</option>
              {/each}
            </select>
          </div>
          <div class="option-group">
            <div class="option-label">{$t('collection.languageLabel')}</div>
            <select class="series-select" bind:value={language}>
              <option value="">{$t('collection.allLanguages')}</option>
              {#each langOptions as code (code)}
                <option value={code}>{languageDisplayName(code, customLangNames)}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="option-group">
          <div class="option-label">{$t('collection.rarityLabel')}</div>
          <div class="chips">
            {#each rarityOptions as r (r)}
              <button
                class="chip"
                class:active={selectedRarities.includes(r)}
                onclick={() => (selectedRarities = toggle(selectedRarities, r))}
              >
                {r}
              </button>
            {/each}
          </div>
        </div>

        <div class="option-group">
          <div class="option-label">{$t('collection.typeLabel')}</div>
          <div class="chips">
            {#each categoryOptions as c (c)}
              <button
                class="chip"
                class:active={selectedCategories.includes(c)}
                onclick={() => (selectedCategories = toggle(selectedCategories, c))}
              >
                {c}
              </button>
            {/each}
          </div>
        </div>

        <div class="option-group">
          <div class="option-label">{$t('collection.colorLabel')}</div>
          <div class="chips">
            {#each colorOptions as c (c)}
              <button
                class="chip"
                class:active={selectedColors.includes(c)}
                onclick={() => (selectedColors = toggle(selectedColors, c))}
              >
                {c}
              </button>
            {/each}
          </div>
        </div>
      </div>
    </aside>

    <section class="table-area">
      <div class="table-head">
        <span class="head-cell">
          <button class="sort-btn" class:active={sortKey === 'no'} onclick={() => toggleSort('no')}>
            {$t('collection.noCol')}
            <span class="sort-glyph">{sortKey === 'no' ? (sortAsc ? '↑' : '↓') : '↕'}</span>
          </button>
        </span>
        <span class="head-cell">
          <button
            class="sort-btn"
            class:active={sortKey === 'name'}
            onclick={() => toggleSort('name')}
          >
            {$t('collection.nameCol')}
            <span class="sort-glyph">{sortKey === 'name' ? (sortAsc ? '↑' : '↓') : '↕'}</span>
          </button>
        </span>
        <span class="head-cell rarity-col">
          <button
            class="sort-btn"
            class:active={sortKey === 'rarity'}
            onclick={() => toggleSort('rarity')}
          >
            {$t('collection.rarityCol')}
            <span class="sort-glyph">{sortKey === 'rarity' ? (sortAsc ? '↑' : '↓') : '↕'}</span>
          </button>
        </span>
        <span class="head-cell center">
          <button
            class="sort-btn"
            class:active={sortKey === 'owned'}
            onclick={() => toggleSort('owned')}
          >
            {$t('collection.ownedCol')}
            <span class="sort-glyph">{sortKey === 'owned' ? (sortAsc ? '↑' : '↓') : '↕'}</span>
          </button>
        </span>
        <span class="head-cell center">
          <button
            class="sort-btn"
            class:active={sortKey === 'need'}
            onclick={() => toggleSort('need')}
          >
            {$t('collection.needCol')}
            <span class="sort-glyph">{sortKey === 'need' ? (sortAsc ? '↑' : '↓') : '↕'}</span>
          </button>
        </span>
      </div>
      {#if loadingRows}
        <div class="table-tip">{$t('common.loading')}</div>
      {:else if rows.length === 0}
        <div class="table-tip">{$t('collection.noRows')}</div>
      {:else}
        <div class="table-body">
          {#each sortedRows as row (variantKey(row))}
            <div class="table-row" class:satisfied={satisfiedOf(row)}>
              <span class="cell-no">{row.cardNoExtend}</span>
              <span class="cell-name">
                {row.cardNameCn ?? ''}
                {row.subCn}
                {#if satisfiedOf(row)}
                  <span class="satisfied-badge">{$t('collection.satisfied')}</span>
                {/if}
              </span>
              <span class="cell-rarity rarity-col">{row.rarity ?? ''}</span>
              <span class="cell-owned">{row.ownedQty}</span>
              <input
                class="cell-need"
                type="number"
                min="0"
                value={needOf(row)}
                oninput={(e) =>
                  updateNeed(variantKey(row), Number((e.currentTarget as HTMLInputElement).value))}
              />
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>

  <div class="action-bar">
    <div class="action-stats">
      {$t('collection.statsSummary', {
        values: { total: rows.length, missing: missingRows.length, satisfied: satisfiedCount },
      })}
    </div>
    <label class="include-check">
      <input type="checkbox" bind:checked={includeComplete} />
      {$t('collection.includeComplete')}
    </label>
    <button
      class="button button-primary export-btn"
      onclick={() => (showExportModal = true)}
      disabled={exporting || loadingRows || rows.length === 0}
    >
      <Save size={14} />
      {exporting ? $t('collection.exporting') : $t('common.export')}
    </button>
  </div>
</div>

<CommonModal
  open={showExportModal}
  title={$t('collection.exportMissingTitle')}
  subtitle={$t('collection.exportCount', {
    values: { count: includeComplete ? rows.length : missingRows.length },
  })}
  closable={!exporting}
  onclose={() => (showExportModal = false)}
>
  <div class="export-format-label">{$t('collection.fileFormat')}</div>
  <div class="export-format-group">
    <button
      class="export-format-option"
      class:active={exportFormat === 'txt'}
      disabled={exporting}
      onclick={() => (exportFormat = 'txt')}
    >
      <FileText size={16} />
      <span class="export-format-name">{$t('deckDetail.txtOption')}</span>
      <span class="export-format-desc">{$t('collection.txtFormatDesc')}</span>
    </button>
    <button
      class="export-format-option"
      class:active={exportFormat === 'csv'}
      disabled={exporting}
      onclick={() => (exportFormat = 'csv')}
    >
      <FileText size={16} />
      <span class="export-format-name">{$t('deckDetail.csvOption')}</span>
      <span class="export-format-desc">{$t('collection.csvFormatDesc')}</span>
    </button>
  </div>

  {#snippet footer()}
    <button
      class="button button-ghost"
      disabled={exporting}
      onclick={() => (showExportModal = false)}
    >
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      disabled={exporting || rows.length === 0}
      onclick={() => handleExport(exportFormat)}
    >
      {exporting ? $t('collection.exporting') : $t('common.export')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .page-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 14px 20px 0;
    gap: 12px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .layout {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
    overflow-y: auto;
  }

  .filter-panel {
    flex: 0 0 280px;
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    position: sticky;
    top: 0;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-secondary);
  }

  .filter-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .filter-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .filter-toggle:hover {
    color: var(--text-primary);
    border-color: var(--accent-color);
  }

  .filter-count {
    padding: 1px 7px;
    border-radius: 99px;
    background: var(--accent-color);
    color: #fff;
    font-size: var(--text-xs);
  }

  .chevron-wrap {
    display: inline-flex;
  }

  :global(.chevron-wrap .chevron) {
    transition: transform 0.15s;
  }

  :global(.chevron-wrap.rotated .chevron) {
    transform: rotate(180deg);
  }

  .bucket-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    border-radius: 99px;
    border: 1px solid var(--accent-color);
    color: var(--accent-color);
    font-size: var(--text-xs);
  }

  .badge-clear {
    display: flex;
    align-items: center;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  .reset-btn {
    margin-left: auto;
    padding: 5px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: none;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .reset-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-color);
  }

  .filter-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .filter-body.hidden {
    display: none;
  }

  .select-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .series-select {
    width: 100%;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    padding: 5px 12px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .chip:hover {
    border-color: var(--accent-color);
    color: var(--text-primary);
  }

  .chip.active {
    background: var(--accent-color);
    color: #fff;
    border-color: var(--accent-color);
  }

  .table-area {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    /* border: 1px solid var(--border-color); */
    border-radius: 12px;
    /* overflow: hidden; */
    position: relative;
    width: 100%;
  }

  .table-head {
    display: grid;
    grid-template-columns: 96px 1fr 72px 48px 72px;
    gap: 8px;
    padding: 9px 12px;
    background: var(--bg-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    position: sticky;
    top: 0;
    border: 1px solid var(--border-color);
    z-index: 10;
  }

  .table-body {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-top: none;
  }

  .table-row {
    display: grid;
    grid-template-columns: 96px 1fr 72px 48px 72px;
    gap: 8px;
    align-items: center;
    padding: 7px 12px;
    font-size: var(--text-sm);
    border-top: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .center {
    text-align: center;
  }

  .head-cell {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .head-cell.center {
    justify-content: center;
  }

  .sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .sort-btn:hover {
    color: var(--accent-color);
  }

  .sort-btn.active {
    color: var(--accent-color);
  }

  .sort-glyph {
    font-size: 11px;
    line-height: 1;
    opacity: 0.7;
  }

  .sort-btn.active .sort-glyph {
    opacity: 1;
  }

  .cell-no {
    font-family: monospace;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cell-name {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .satisfied-badge {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 99px;
    font-size: var(--text-xs);
    color: var(--accent-color);
    border: 1px solid var(--accent-color);
  }

  .table-row.satisfied {
    opacity: 0.55;
  }

  .cell-rarity {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .cell-owned {
    text-align: center;
  }

  .cell-need {
    width: 100%;
    padding: 5px 6px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    text-align: center;
  }

  .table-tip {
    padding: 32px 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .action-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
    padding: 10px 0 14px;
    border-top: 1px solid var(--border-color);
    flex-wrap: wrap;
  }

  .action-stats {
    margin-right: auto;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .include-check {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 38px;
    padding: 8px 18px;
  }

  .export-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .export-format-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .export-format-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .export-format-option {
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

  .export-format-option:hover:not(:disabled) {
    border-color: var(--accent-color);
  }

  .export-format-option.active {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: #fff;
  }

  .export-format-option:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .export-format-name {
    font-size: var(--text-sm);
    font-weight: 600;
    flex-shrink: 0;
  }

  .export-format-desc {
    font-size: var(--text-xs);
    opacity: 0.75;
  }

  @media (max-width: 899.98px) {
    .page-wrapper {
      padding: 10px 12px 0;
      gap: 10px;
    }

    .layout {
      flex-direction: column;
      overflow-y: auto;
    }

    .filter-panel {
      flex: none;
      width: 100%;
      position: static;
    }

    .filter-body {
      gap: 10px;
    }

    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 2px;
      -webkit-overflow-scrolling: touch;
    }
  }

  @media (max-width: 639.98px) {
    .table-head,
    .table-row {
      grid-template-columns: 84px 1fr 44px 64px;
    }

    .rarity-col {
      display: none;
    }

    .cell-need {
      min-height: 32px;
    }

    .action-bar {
      justify-content: space-between;
      gap: 10px;
    }
  }
</style>
