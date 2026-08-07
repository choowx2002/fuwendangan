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
  import { ChevronDown, Filter, Save, X } from '@lucide/svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import type { MissingListTextRow } from '$lib/collection/collection-export'
  import { buildMissingListText, saveMissingList } from '$lib/collection/collection-export'
  import type { VariantBucket } from '$lib/cards/utils/variant-utils'
  import { BUCKET_LABELS } from '$lib/cards/utils/variant-utils'

  const DEFAULT_NEED = 3

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
  let filtersCollapsed = $state(isNarrowLayout)
  let toastMsg = $state('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const seriesOptions = $derived(stats?.series ?? [])
  const seriesTitle = $derived(
    seriesOptions.find((s) => s.code === series)?.nameCn ?? series ?? ''
  )
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
  const missingRows = $derived(rows.filter((r) => !satisfiedOf(r)))
  const satisfiedCount = $derived(rows.length - missingRows.length)

  function showToast(msg: string) {
    toastMsg = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastMsg = ''), 2200)
  }

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

  async function handleExport() {
    exporting = true
    try {
      const items = includeComplete ? rows : missingRows
      const textRows: MissingListTextRow[] = items.map((r) => ({
        cardNoExtend: r.cardNoExtend,
        cardNameCn: r.cardNameCn,
        rarity: r.rarity,
        ownedQty: r.ownedQty,
        needed: needOf(r),
        satisfied: satisfiedOf(r),
      }))
      const chosen = series ? seriesOptions.find((s) => s.code === series) : undefined
      const text = buildMissingListText(
        textRows,
        chosen?.nameCn ?? series ?? null,
        series ? (chosen?.totalOwned ?? 0) : stats?.overallOwned ?? 0,
        series ? (chosen?.totalCount ?? 0) : stats?.overallCount ?? 0
      )
      const stamp = new Date().toISOString().slice(0, 10)
      const code = series || '全部系列'
      const ok = await saveMissingList(text, `缺卡清单-${code}-${stamp}.txt`)
      if (ok) {
        showToast(`已保存 ${textRows.length} 条缺卡明细`)
      } else {
        showToast('已取消保存')
      }
    } catch (err) {
      showToast(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      exporting = false
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
      title: '缺卡清单',
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
          筛选
          {#if selectedCount > 0}<span class="filter-count">{selectedCount} 项</span>{/if}
          <span class="chevron-wrap" class:rotated={!filtersCollapsed}>
            <ChevronDown class="chevron" size={14} />
          </span>
        </button>
        {#if bucket}
          <span class="bucket-badge">
            桶：{BUCKET_LABELS[bucket as VariantBucket]}
            <button class="badge-clear" onclick={() => (bucket = null)} aria-label="清除桶筛选">
              <X size={12} />
            </button>
          </span>
        {/if}
        <button class="reset-btn" onclick={resetFilters}>重置</button>
      </div>

      <div class="filter-body" class:hidden={filtersCollapsed}>
        <div class="select-row">
          <div class="option-group">
            <div class="option-label">弹</div>
            <select class="series-select" bind:value={series}>
              <option value="">全部系列</option>
              {#each seriesOptions as s (s.code)}
                <option value={s.code}>{s.nameCn ?? s.code}</option>
              {/each}
            </select>
          </div>
          <div class="option-group">
            <div class="option-label">语言</div>
            <select class="series-select" bind:value={language}>
              <option value="">全部语言</option>
              {#each langOptions as code (code)}
                <option value={code}>{languageDisplayName(code, customLangNames)}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="option-group">
          <div class="option-label">稀有度</div>
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
          <div class="option-label">类型</div>
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
          <div class="option-label">颜色</div>
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
        <span>编号</span>
        <span>名字</span>
        <span class="rarity-col">稀有度</span>
        <span class="center">拥有</span>
        <span class="center">需求</span>
      </div>
      {#if loadingRows}
        <div class="table-tip">加载中...</div>
      {:else if rows.length === 0}
        <div class="table-tip">该条件下没有卡牌变体</div>
      {:else}
        <div class="table-body">
          {#each rows as row (variantKey(row))}
            <div class="table-row" class:satisfied={satisfiedOf(row)}>
              <span class="cell-no">{row.cardNoExtend}</span>
              <span class="cell-name">
                {row.cardNameCn ?? ''}
                {#if satisfiedOf(row)}
                  <span class="satisfied-badge">已集齐</span>
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
      共 {rows.length} · 缺 {missingRows.length} · 已集齐 {satisfiedCount}
    </div>
    <label class="include-check">
      <input type="checkbox" bind:checked={includeComplete} />
      包含已集齐
    </label>
    <button
      class="button button-primary export-btn"
      onclick={handleExport}
      disabled={exporting || loadingRows || rows.length === 0}
    >
      <Save size={14} />
      {exporting ? '导出中...' : '导出'}
    </button>
  </div>

  {#if toastMsg}
    <div class="toast">{toastMsg}</div>
  {/if}
</div>

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
    border: 1px solid var(--border-color);
    border-radius: 12px;
    overflow: hidden;
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
  }

  .table-body {
    background: var(--bg-primary);
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

  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1200;
    padding: 9px 18px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.82);
    color: #fff;
    font-size: var(--text-sm);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    animation: toast-in 0.2s ease;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
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
