<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { Plus, Trash2, Check, Archive, Heart, Upload, Download, ShoppingCart } from '@lucide/svelte'
  import {
    getWishlistItems,
    upsertWishlistItem,
    updateWishlistStatus,
    deleteWishlistItem,
    markWishlistAcquired,
    getCardOwnedQty,
    listCardVariants,
    getCustomLanguages,
    PRESET_LANGUAGE_CODES,
    printCacheName,
    importWishlistCsv,
    generatePurchaseListFromWishlist,
    isTauri,
    type WishlistStatus,
    type WishlistImportRow,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { defaultLanguage } from '$lib/stores/settings'
  import { confirmAction } from '$lib/utils/confirm'
  import { saveTextFile } from '$lib/collection/collection-export'
  import { combineCardName } from '$lib/collection/collection-utils'
  import {
    buildWishlistCsv,
    buildWishlistCsvTemplate,
    parseWishlistCsv,
  } from '$lib/collection/wishlist-csv'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import WritebackModal from '$lib/components/collection/WritebackModal.svelte'
  import VariantPicker from '$lib/components/collection/VariantPicker.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  type Filter = 'active' | 'acquired' | 'archived' | 'all'
  type Finish = 'any' | 'normal' | 'foil'

  type WishlistRow = Awaited<ReturnType<typeof getWishlistItems>>[number]

  let items = $state<WishlistRow[]>([])
  let loading = $state(true)
  let filter = $state<Filter>('active')
  let langOptions = $state<string[]>([...PRESET_LANGUAGE_CODES])

  let showAdd = $state(false)
  let showPicker = $state(false)
  let saving = $state(false)
  let form = $state({
    cardNo: '',
    cardNoExtend: '',
    cardName: '',
    languageCode: get(defaultLanguage),
    finish: 'any' as Finish,
    qtyWanted: 1,
    priority: 3,
    note: '',
  })

  const filtered = $derived(filter === 'all' ? items : items.filter((i) => i.status === filter))

  let showImport = $state(false)
  let importing = $state(false)
  let importRows = $state<{
    rows: WishlistImportRow[]
    errors: string[]
    fileName: string
  } | null>(null)

  let showToPurchase = $state(false)
  let toPurchaseName = $state('')
  let toPurchaseBusy = $state(false)

  function finishLabel(finish: string): string {
    if (finish === 'normal') return get(t)('wishlist.finish.normal')
    if (finish === 'foil') return get(t)('wishlist.finish.foil')
    return get(t)('wishlist.finish.any')
  }

  async function load() {
    loading = true
    try {
      items = await getWishlistItems()
      const customs = await getCustomLanguages()
      langOptions = [...PRESET_LANGUAGE_CODES, ...customs.map((c) => c.code)]
    } finally {
      loading = false
    }
  }

  function openAdd() {
    form = {
      cardNo: '',
      cardNoExtend: '',
      cardName: '',
      languageCode: get(defaultLanguage),
      finish: 'any',
      qtyWanted: 1,
      priority: 3,
      note: '',
    }
    showPicker = true
  }

  function pickCard(v: { cardNo: string; cardNoExtend: string; card_name_cn: string | null }) {
    form.cardNo = v.cardNo
    form.cardNoExtend = v.cardNoExtend
    form.cardName = v.card_name_cn ?? ''
    showPicker = false
    showAdd = true
  }

  async function submit() {
    if (!form.cardNoExtend) return
    saving = true
    try {
      await upsertWishlistItem({
        cardNo: form.cardNo,
        cardNoExtend: form.cardNoExtend,
        languageCode: form.languageCode,
        finish: form.finish,
        qtyWanted: form.qtyWanted,
        priority: form.priority,
        note: form.note.trim() || null,
      })
      showToast(get(t)('wishlist.saved'), 'success')
      showAdd = false
      void load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      saving = false
    }
  }

  async function setStatus(item: WishlistRow, status: WishlistStatus) {
    if (status === 'acquired') {
      await openAcquire(item)
      return
    }
    await updateWishlistStatus(item.id, status)
    void load()
  }

  let showWriteback = $state(false)
  let writebackTarget = $state<WishlistRow | null>(null)
  let writebackVariants = $state<
    { cardNoExtend: string; rarityName: string | null; extendRarityName: string | null; isCustom: boolean }[]
  >([])
  let writebackOwnedQty = $state(0)

  async function openAcquire(item: WishlistRow) {
    try {
      const [variants, ownedQty] = await Promise.all([
        listCardVariants(item.card_no),
        getCardOwnedQty(item.card_no, item.card_no_extend),
      ])
      const seen = new Set<string>()
      writebackVariants = variants
        .filter((p) => {
          if (seen.has(p.card_no_extend)) return false
          seen.add(p.card_no_extend)
          return true
        })
        .map((p) => ({
          cardNoExtend: p.card_no_extend,
          rarityName: p.rarity_name,
          extendRarityName: p.extend_rarity_name,
          isCustom: !!p.is_custom,
        }))
      writebackOwnedQty = ownedQty
    } catch {
      writebackVariants = []
      writebackOwnedQty = 0
    }
    writebackTarget = item
    showWriteback = true
  }

  async function onWritebackConfirm(payload: { qty: number; cardNoExtend: string }) {
    const item = writebackTarget
    if (!item) return
    showWriteback = false
    writebackTarget = null
    try {
      const { written } = await markWishlistAcquired(item.id, {
        qty: payload.qty,
        cardNoExtend: payload.cardNoExtend,
      })
      showToast(
        get(t)(written ? 'wishlist.acquiredWithWriteback' : 'wishlist.acquiredAlreadyOwned'),
        written ? 'success' : 'info'
      )
    } catch (err) {
      console.error('[心愿单] 标记已拥有写回收藏失败:', err)
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
    void load()
  }

  async function remove(item: WishlistRow) {
    const confirmed = await confirmAction(
      get(t)('wishlist.deleteConfirm', {
        values: { card: item.card_name_cn || item.card_no_extend },
      }),
      {
        title: get(t)('wishlist.title'),
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!confirmed) return
    await deleteWishlistItem(item.id)
    showToast(get(t)('wishlist.deleted'), 'info')
    void load()
  }

  async function exportWishlistCsv() {
    try {
      const all = await getWishlistItems()
      if (all.length === 0) {
        showToast(get(t)('wishlist.emptyTitle'), 'info')
        return
      }
      const rows = all.map((i) => ({
        cardNoExtend: i.card_no_extend,
        cardNameCn: combineCardName(i.card_name_cn, i.card_sub_cn),
        languageCode: i.language_code,
        finish: i.finish,
        qtyWanted: i.qty_wanted,
        priority: i.priority,
        status: i.status,
        note: i.note,
      }))
      const content = buildWishlistCsv(rows)
      const stamp = new Date().toISOString().slice(0, 10)
      const ok = await saveTextFile(content, `心愿单-${stamp}.csv`, {
        format: 'csv',
        title: get(t)('wishlist.exportTitle'),
      })
      if (ok) {
        showToast(get(t)('wishlist.exported', { values: { count: rows.length } }), 'success')
      } else {
        showToast(get(t)('collection.saveCancelled'), 'info')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
  }

  async function pickWishlistImport() {
    try {
      if (isTauri) {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readTextFile } = await import('$lib/services/db-file-service')
        const src = await open({
          title: get(t)('wishlist.importCsvTitle'),
          multiple: false,
          filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
        })
        if (!src) return
        const content = await readTextFile(String(src))
        const fileName = String(src).split(/[\\/]/).pop() ?? String(src)
        reviewWishlistImport(fileName, content)
      } else {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.csv,text/csv'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => reviewWishlistImport(file.name, String(reader.result ?? ''))
          reader.readAsText(file)
        }
        input.click()
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
  }

  function reviewWishlistImport(fileName: string, content: string) {
    const parsed = parseWishlistCsv(content)
    importRows = {
      rows: parsed.rows,
      errors: parsed.errors.map((e) =>
        get(t)('collection.csvLineError', { values: { line: e.line, reason: e.reason } })
      ),
      fileName,
    }
    showImport = true
  }

  async function confirmWishlistImport() {
    if (!importRows) return
    importing = true
    try {
      const result = await importWishlistCsv(importRows.rows)
      const skippedText = result.skipped.length
        ? get(t)('collection.fullCsvImportSkipped', { values: { count: result.skipped.length } })
        : ''
      showToast(
        get(t)('wishlist.imported', {
          values: {
            count: result.applied,
            created: result.created,
            updated: result.updated,
            skipped: skippedText,
          },
        }),
        'success'
      )
      showImport = false
      importRows = null
      void load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      importing = false
    }
  }

  async function downloadWishlistTemplate() {
    const ok = await saveTextFile(
      buildWishlistCsvTemplate(),
      '心愿单导入模板.csv',
      { format: 'csv', title: get(t)('collection.downloadTemplate') }
    )
    if (!ok) showToast(get(t)('collection.saveCancelled'), 'info')
  }

  async function confirmToPurchase() {
    if (toPurchaseBusy) return
    toPurchaseBusy = true
    try {
      const listId = await generatePurchaseListFromWishlist({ name: toPurchaseName.trim() })
      showToPurchase = false
      showToast(get(t)('purchase.created'), 'success')
      await goto(`/collection/purchase-lists/${listId}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      toPurchaseBusy = false
    }
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: $t('wishlist.title'),
      onBack: () => void goto('/collection'),
      actions: [
        {
          key: 'export',
          label: $t('wishlist.exportCsv'),
          icon: Upload,
          title: $t('wishlist.exportTitle'),
          onClick: () => void exportWishlistCsv(),
        },
        {
          key: 'import',
          label: $t('wishlist.importCsv'),
          icon: Download,
          title: $t('wishlist.importCsvTitle'),
          onClick: pickWishlistImport,
        },
        {
          key: 'toPurchase',
          label: $t('purchase.fromWishlist'),
          icon: ShoppingCart,
          title: $t('purchase.fromWishlistTitle'),
          onClick: () => {
            toPurchaseName = ''
            showToPurchase = true
          },
        },
        {
          key: 'add',
          label: $t('wishlist.add'),
          icon: Plus,
          onClick: openAdd,
          variant: 'primary',
        },
      ],
    })
  })
</script>

<div class="page">
  <div class="filter-row">
    {#each ['active', 'acquired', 'archived', 'all'] as f (f)}
      <button
        class="filter-chip"
        class:active={filter === f}
        onclick={() => (filter = f as Filter)}
      >
        {$t(`wishlist.filter.${f}`)}
      </button>
    {/each}
  </div>

  {#if loading && items.length === 0}
    <div class="loading-tip">{$t('common.loading')}</div>
  {:else if filtered.length === 0}
    <EmptyState
      title={$t('wishlist.emptyTitle')}
      description={$t('wishlist.emptyDesc')}
      actionLabel={$t('wishlist.add')}
      onAction={openAdd}
    />
  {:else}
    <div class="list">
      {#each filtered as item (item.id)}
        <div class="row" class:inactive={item.status !== 'active'}>
          <CardSimpleImage
            url={item.img_cdn}
            name={printCacheName({ card_no_extend: item.card_no_extend, language: item.img_lang })}
            className="row-thumb"
          />
          <div class="row-main">
            <div class="row-title">
              <span class="row-name">{item.card_name_cn || item.card_no}</span>
              <span class="row-extend">{item.card_no_extend}</span>
            </div>
            <div class="row-meta">
              <span class="tag">{item.language_code}</span>
              <span class="tag">{finishLabel(item.finish)}</span>
              <span class="tag">{$t('wishlist.qtyWanted')} × {item.qty_wanted}</span>
              <span class="tag">{$t('wishlist.priority')} {item.priority}</span>
              {#if item.note}
                <span class="note">{item.note}</span>
              {/if}
            </div>
          </div>
          <div class="row-actions">
            {#if item.status === 'active'}
              <button
                class="icon-btn"
                title={$t('wishlist.markAcquired')}
                onclick={() => openAcquire(item)}
              >
                <Check size={16} />
              </button>
              <button
                class="icon-btn"
                title={$t('wishlist.archive')}
                onclick={() => setStatus(item, 'archived')}
              >
                <Archive size={16} />
              </button>
            {:else}
              <button
                class="icon-btn"
                title={$t('wishlist.reactivate')}
                onclick={() => setStatus(item, 'active')}
              >
                <Heart size={16} />
              </button>
            {/if}
            <button
              class="icon-btn danger"
              title={$t('common.delete')}
              onclick={() => remove(item)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<VariantPicker open={showPicker} onClose={() => (showPicker = false)} onSelect={pickCard} />

<WritebackModal
  open={showWriteback}
  title={$t('wishlist.markAcquired')}
  subtitle={
    writebackTarget
      ? `${writebackTarget.card_name_cn || writebackTarget.card_no_extend} · ${
          writebackTarget.card_no_extend
        }`
      : ''
  }
  cardName={writebackTarget?.card_name_cn || ''}
  cardNo={writebackTarget?.card_no || ''}
  cardNoExtend={writebackTarget?.card_no_extend || ''}
  defaultQty={writebackTarget?.qty_wanted ?? 1}
  ownedQty={writebackOwnedQty}
  variants={writebackVariants}
  confirmLabel={$t('common.confirm')}
  onConfirm={(p) => void onWritebackConfirm(p)}
  onClose={() => {
    showWriteback = false
    writebackTarget = null
  }}
/>

<CommonModal
  open={showAdd}
  title={$t('wishlist.add')}
  subtitle={form.cardNoExtend ? `${form.cardName} · ${form.cardNoExtend}` : ''}
  onclose={() => (showAdd = false)}
>
  <div class="form">
    <div class="field">
      <label class="label" for="wish-card">{$t('wishlist.card')}</label>
      <button class="card-pick" id="wish-card" onclick={() => (showPicker = true)}>
        {form.cardNoExtend
          ? `${form.cardName || form.cardNo} · ${form.cardNoExtend}`
          : $t('wishlist.pickCardHint')}
      </button>
    </div>
    <div class="field">
      <label class="label" for="wish-lang">{$t('wishlist.language')}</label>
      <select class="select" id="wish-lang" bind:value={form.languageCode}>
        {#each langOptions as code (code)}
          <option value={code}>{code}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label class="label" for="wish-finish">{$t('wishlist.finish')}</label>
      <select class="select" id="wish-finish" bind:value={form.finish}>
        <option value="any">{$t('wishlist.finish.any')}</option>
        <option value="normal">{$t('wishlist.finish.normal')}</option>
        <option value="foil">{$t('wishlist.finish.foil')}</option>
      </select>
    </div>
    <div class="form-row">
      <div class="field">
        <label class="label" for="wish-qty">{$t('wishlist.qtyWanted')}</label>
        <input class="input" id="wish-qty" type="number" min="1" bind:value={form.qtyWanted} />
      </div>
      <div class="field">
        <label class="label" for="wish-priority">{$t('wishlist.priority')}</label>
        <select class="select" id="wish-priority" bind:value={form.priority}>
          {#each [1, 2, 3, 4, 5] as p (p)}
            <option value={p}>{p}</option>
          {/each}
        </select>
      </div>
    </div>
    <div class="field">
      <label class="label" for="wish-note">{$t('common.note')}</label>
      <input
        class="input"
        id="wish-note"
        bind:value={form.note}
        placeholder={$t('common.optional')}
      />
    </div>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (showAdd = false)}>
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" disabled={saving || !form.cardNoExtend} onclick={submit}>
      {saving ? $t('common.saving') : $t('common.save')}
    </button>
  {/snippet}
</CommonModal>

<CommonModal
  open={showImport}
  title={$t('wishlist.importCsvTitle')}
  subtitle={importRows?.fileName ?? ''}
  closable={!importing}
  onclose={() => {
    if (!importing) showImport = false
  }}
>
  <div class="import-preview">
    <div class="import-hint">{$t('wishlist.importHint')}</div>
    <button
      class="import-template-btn"
      disabled={importing}
      onclick={() => void downloadWishlistTemplate()}
    >
      <Download size={14} />
      {$t('collection.downloadTemplate')}
    </button>
    {#if importRows}
      <div class="import-stats">
        {$t('collection.parsedRows', { values: { count: importRows.rows.length } })}
        {#if importRows.errors.length > 0}
          · {$t('collection.skippedRows', { values: { count: importRows.errors.length } })}
        {/if}
      </div>
      {#if importRows.errors.length > 0}
        <div class="import-errors">
          {#each importRows.errors as e (e)}
            <div class="import-error-line">{e}</div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    <button class="button button-ghost" disabled={importing} onclick={() => (showImport = false)}>
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      disabled={importing || !importRows || importRows.rows.length === 0}
      onclick={confirmWishlistImport}
    >
      {importing ? $t('collection.importing') : $t('collection.confirmImport')}
    </button>
  {/snippet}
</CommonModal>

<CommonModal
  open={showToPurchase}
  title={$t('purchase.fromWishlistTitle')}
  subtitle={$t('purchase.fromWishlistDesc')}
  closable={!toPurchaseBusy}
  onclose={() => {
    if (!toPurchaseBusy) showToPurchase = false
  }}
>
  <div class="form">
    <div class="field">
      <label class="label" for="to-purchase-name">{$t('purchase.listName')}</label>
      <input
        class="input"
        id="to-purchase-name"
        bind:value={toPurchaseName}
        placeholder={$t('purchase.listNamePlaceholder')}
      />
    </div>
  </div>

  {#snippet footer()}
    <button
      class="button button-ghost"
      disabled={toPurchaseBusy}
      onclick={() => (showToPurchase = false)}
    >
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" disabled={toPurchaseBusy} onclick={confirmToPurchase}>
      {toPurchaseBusy ? $t('purchase.generating') : $t('purchase.create')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
  }

  .filter-row {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .filter-chip {
    padding: 5px 14px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .filter-chip.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
  }

  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 8px;
    padding: 12px 16px 24px;
  }
    @media (max-width: 767.99px) {
    .list {
      display: flex;
      flex-direction: column;
    }
  }

  .row {
    display: flex;
    align-items: center;
    /* justify-content: space-between; */
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .row.inactive {
    opacity: 0.55;
  }

  :global(.row-thumb) {
    width: 56px;
    height: 78px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .row-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row-title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .row-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-extend {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: monospace;
    flex-shrink: 0;
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .note {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .row-actions {
    display: flex;
    gap: 4px;
    flex: 1 1 100%;
    justify-content: end;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.danger:hover {
    color: #e5484d;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-row {
    display: flex;
    gap: 12px;
  }

  .form-row .field {
    flex: 1;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .input,
  .select {
    padding: 9px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .card-pick {
    padding: 10px 12px;
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .card-pick:hover {
    border-color: var(--text-tertiary);
  }

  .loading-tip {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .import-preview {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .import-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .import-template-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
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
</style>
