<script lang="ts">
  import { goto, beforeNavigate, afterNavigate } from '$app/navigation'
  import { page } from '$app/state'
  import { RefreshCw, Trash2, Save, Minus, Plus, Copy, FileDown, FileText, Pencil, Upload } from '@lucide/svelte'
  import {
    getPurchaseList,
    getPurchaseListItems,
    removePurchaseListItem,
    refreshPurchaseListFromDeck,
    savePurchaseListBatch,
    getCardOtherVariantOwned,
    isTauri,
    printCacheName,
    type PurchaseList,
    type PurchaseListChange,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { defaultLanguage } from '$lib/stores/settings'
  import { confirmAction } from '$lib/utils/confirm'
  import { combineCardName } from '$lib/collection/collection-utils'
  import {
    buildPurchaseListCsv,
    PURCHASE_LIST_CSV_HEADERS,
    type PurchaseListCsvRow,
  } from '$lib/collection/purchase-list-csv'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  const listId = $derived(page.params.listId ?? '')

  type ItemRow = Awaited<ReturnType<typeof getPurchaseListItems>>[number]
  type SortKey = 'status' | 'category' | 'color' | 'needed' | 'rarity'

  let list = $state<PurchaseList | null>(null)
  let items = $state<ItemRow[]>([])
  let loading = $state(true)
  let loadError = $state(false)
  let refreshing = $state(false)
  let saving = $state(false)
  let sortKey = $state<SortKey>('status')
  let showSaveConfirm = $state(false)
  let showExport = $state(false)
  let showOtherOwned = $state(false)
  let otherOwnedRows = $state<
    {
      card_no_extend: string
      rarity: string | null
      normal_qty: number
      foil_qty: number
      total: number
    }[]
  >([])
  let allowLeave = $state(false)

  interface Edit {
    qtyOrdered: number
    qtyBorrowed: number
    qtyBought: number
    skipped: boolean
  }
  let edits = $state<Record<string, Edit>>({})

  const dirty = $derived(Object.keys(edits).length > 0)

  interface RowView {
    item: ItemRow
    qtyOrdered: number
    qtyBorrowed: number
    qtyBought: number
    skipped: boolean
    owned: number
    toBuy: number
  }

  const rowViews = $derived(
    items.map((item): RowView => {
      const e = edits[item.id]
      const qtyOrdered = e?.qtyOrdered ?? item.qty_ordered
      const qtyBorrowed = e?.qtyBorrowed ?? item.qty_borrowed
      const qtyBought = e?.qtyBought ?? item.qty_bought
      const skipped = e?.skipped ?? item.status === 'skipped'
      const owned = item.owned_live
      const toBuy = skipped
        ? 0
        : Math.max(0, item.qty_required - owned - qtyOrdered - qtyBorrowed - qtyBought)
      return { item, qtyOrdered, qtyBorrowed, qtyBought, skipped, owned, toBuy }
    })
  )

  const changedRows = $derived(rowViews.filter((v) => edits[v.item.id] !== undefined))

  type StatusFilter = 'all' | 'pending' | 'met' | 'skipped'
  let statusFilter = $state<StatusFilter>('all')

  function matchesFilter(v: RowView, f: StatusFilter): boolean {
    // 排序/筛选基于条目原始状态（编辑期间行位置保持稳定，不随 toBuy/skipped 跳动）
    const skipped = v.item.status === 'skipped'
    const toBuy = oldToBuy(v)
    if (f === 'all') return true
    if (f === 'skipped') return skipped
    if (f === 'pending') return !skipped && toBuy > 0
    return !skipped && toBuy === 0
  }

  const filteredRows = $derived(rowViews.filter((v) => matchesFilter(v, statusFilter)))

  function sortRows(list: RowView[]): RowView[] {
    const byNo = (a: ItemRow, b: ItemRow) =>
      a.card_no.localeCompare(b.card_no, undefined, { numeric: true })
    const sorted = [...list]
    switch (sortKey) {
      case 'status':
        sorted.sort(
          (a, b) =>
            statusOrder(a) - statusOrder(b) ||
            oldToBuy(b) - oldToBuy(a) ||
            byNo(a.item, b.item)
        )
        break
      case 'needed':
        sorted.sort((a, b) => b.item.qty_required - a.item.qty_required || byNo(a.item, b.item))
        break
      case 'category':
        sorted.sort(
          (a, b) =>
            (firstOf(a.item.card_category) ?? '').localeCompare(
              firstOf(b.item.card_category) ?? ''
            ) || byNo(a.item, b.item)
        )
        break
      case 'color':
        sorted.sort(
          (a, b) =>
            colorOrder(a.item.card_color_list) - colorOrder(b.item.card_color_list) ||
            byNo(a.item, b.item)
        )
        break
      case 'rarity':
        sorted.sort(
          (a, b) => rarityOrder(a.item.rarity) - rarityOrder(b.item.rarity) || byNo(a.item, b.item)
        )
        break
    }
    return sorted
  }

  const sortedRows = $derived(sortRows(filteredRows))

  /** 导出使用全部条目（不受状态筛选影响），仅按当前排序，与「导出全部条目」提示一致 */
  const exportRowsSorted = $derived(sortRows(rowViews))

  function statusOrder(v: RowView): number {
    if (v.item.status === 'skipped') return 2
    return oldToBuy(v) > 0 ? 0 : 1
  }

  function colorOrder(raw: string | null): number {
    const order = ['red', 'green', 'blue', 'orange', 'purple', 'yellow']
    const first = firstOf(raw)
    if (!first) return 99
    const idx = order.indexOf(first.toLowerCase())
    return idx === -1 ? 90 : idx
  }

  function rarityOrder(rarity: string | null): number {
    const order = ['普通', '不凡', '稀有', '史诗', '异画', '超编', '签名超编']
    if (!rarity) return 99
    const idx = order.indexOf(rarity)
    return idx === -1 ? 80 : idx
  }

  function firstOf(json: string | null): string | null {
    if (!json) return null
    try {
      const arr = JSON.parse(json)
      return Array.isArray(arr) && arr.length ? String(arr[0]) : null
    } catch {
      return json
    }
  }

  function oldToBuy(v: RowView): number {
    const it = v.item
    const skipped = it.status === 'skipped'
    return skipped
      ? 0
      : Math.max(
          0,
          it.qty_required - it.owned_live - it.qty_ordered - it.qty_borrowed - it.qty_bought
        )
  }

  function statusText(v: RowView): string {
    if (v.skipped) return get(t)('purchase.itemStatus.skipped')
    return v.toBuy > 0 ? get(t)('purchase.itemStatus.pending') : get(t)('purchase.itemStatus.met')
  }

  function statusClass(v: RowView): string {
    if (v.skipped) return 'skipped'
    return v.toBuy > 0 ? 'pending' : 'met'
  }

  function statusLabel(status: string): string {
    return get(t)(`purchase.listStatus.${status}`)
  }

  async function load() {
    loading = true
    try {
      const [listRes, itemRes] = await Promise.all([
        getPurchaseList(listId),
        getPurchaseListItems(listId),
      ])
      list = listRes
      items = itemRes
      loadError = false
    } catch (err) {
      loadError = true
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      loading = false
    }
  }

  async function refresh() {
    if (!list?.deck_id) {
      showToast(get(t)('purchase.noDeckLinked'), 'error')
      return
    }
    if (dirty) {
      showToast(get(t)('purchase.dirtyNeedSave'), 'info')
      return
    }
    refreshing = true
    try {
      const count = await refreshPurchaseListFromDeck(listId)
      showToast(get(t)('purchase.refreshed', { values: { count } }), 'success')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      refreshing = false
    }
  }

  async function openOtherOwned(item: ItemRow) {
    try {
      otherOwnedRows = await getCardOtherVariantOwned(item.card_no, item.card_no_extend)
      showOtherOwned = true
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
  }

  function openEditInfo() {
    void goto(`/collection/purchase-lists/${listId}/edit`)
  }

  function setEdit(item: ItemRow, patch: Partial<Edit>) {
    const base = edits[item.id]
    const next: Edit = {
      qtyOrdered: base?.qtyOrdered ?? item.qty_ordered,
      qtyBorrowed: base?.qtyBorrowed ?? item.qty_borrowed,
      qtyBought: base?.qtyBought ?? item.qty_bought,
      skipped: base?.skipped ?? item.status === 'skipped',
      ...patch,
    }
    next.qtyOrdered = Math.max(0, Math.floor(Number(next.qtyOrdered) || 0))
    next.qtyBorrowed = Math.max(0, Math.floor(Number(next.qtyBorrowed) || 0))
    next.qtyBought = Math.max(0, Math.floor(Number(next.qtyBought) || 0))
    if (
      next.qtyOrdered === item.qty_ordered &&
      next.qtyBorrowed === item.qty_borrowed &&
      next.qtyBought === item.qty_bought &&
      next.skipped === (item.status === 'skipped')
    ) {
      delete edits[item.id]
    } else {
      edits[item.id] = next
    }
  }

  async function confirmSave() {
    if (!list || saving) return
    saving = true
    try {
      const changes: PurchaseListChange[] = Object.entries(edits).map(([itemId, e]) => ({
        itemId,
        qtyOrdered: e.qtyOrdered,
        qtyBorrowed: e.qtyBorrowed,
        qtyBought: e.qtyBought,
        skipped: e.skipped,
      }))
      const result = await savePurchaseListBatch(listId, changes)
      showToast(
        get(t)('purchase.saved', {
          values: {
            items: result.updatedItems,
            created: result.loansCreated,
            cancelled: result.loansCancelled,
            written: result.writtenQty,
          },
        }),
        'success'
      )
      showSaveConfirm = false
      edits = {}
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      saving = false
    }
  }

  async function remove(item: ItemRow) {
    const confirmed = await confirmAction(
      get(t)('purchase.deleteItemConfirm', {
        values: { card: item.card_name_cn || item.card_no_extend },
      }),
      {
        title: get(t)('purchase.title'),
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!confirmed) return
    try {
      await removePurchaseListItem(item.id)
      delete edits[item.id]
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
  }

  // ---------- 导出 ----------
  function exportRows(): PurchaseListCsvRow[] {
    return exportRowsSorted.map((v) => ({
      cardNoExtend: v.item.card_no_extend || v.item.card_no,
      cardNameCn: combineCardName(v.item.card_name_cn, v.item.sub_title_cn) || v.item.card_no,
      rarity: v.item.rarity,
      language: v.item.language_pref || get(defaultLanguage),
      // 拥有数 = 已有 + 已借入（own + borrowed）
      ownedQty: v.owned + v.qtyBorrowed,
      needed: v.item.qty_required,
    }))
  }

  function toCsv(): string {
    return buildPurchaseListCsv(exportRows())
  }

  function toTxt(): string {
    return [
      [...PURCHASE_LIST_CSV_HEADERS].join('\t'),
      ...exportRows().map((r) =>
        [r.cardNoExtend, r.cardNameCn, r.rarity ?? '', r.language, r.ownedQty, r.needed].join('\t')
      ),
    ].join('\n')
  }

  async function copyExport(format: 'txt' | 'csv') {
    const text = format === 'csv' ? toCsv() : toTxt()
    try {
      if (isTauri) {
        const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
        await writeText(text)
      } else {
        await navigator.clipboard.writeText(text)
      }
      showToast(get(t)('purchase.exportCopied'), 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
  }

  async function downloadExport(format: 'txt' | 'csv') {
    const content = format === 'csv' ? toCsv() : toTxt()
    const name = (list?.name || 'purchase-list').replace(/[\\/:*?"<>|]/g, '-')
    const filename = `${name}-${new Date().toISOString().slice(0, 10)}.${format}`
    try {
      if (isTauri) {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const { writeTextFile } = await import('$lib/services/db-file-service')
        const dest = await save({
          defaultPath: filename,
          filters: [{ name: format.toUpperCase(), extensions: [format] }],
        })
        if (!dest) return
        await writeTextFile(String(dest), content)
      } else {
        const blob = new Blob([content], {
          type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      }
      showToast(get(t)('purchase.exported'), 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
  }

  beforeNavigate(({ cancel, to }) => {
    if (!dirty || allowLeave || !to) return
    cancel()
    void (async () => {
      const ok = await confirmAction(get(t)('purchase.dirtyConfirm'), {
        title: get(t)('purchase.title'),
        okLabel: get(t)('purchase.discard'),
        cancelLabel: get(t)('common.cancel'),
      })
      if (ok) {
        allowLeave = true
        try {
          await goto(to.url)
        } catch {
          // 导航失败：恢复拦截，避免后续导航绕过未保存提醒
          allowLeave = false
        }
      }
    })()
  })

  afterNavigate(() => {
    allowLeave = false
  })

  // listId 变化时（同 [listId] 路由参数复用）重新加载，避免展示上一份清单的数据
  $effect(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: list?.name ?? $t('purchase.detail'),
      onBack: () => void goto('/collection/purchase-lists'),
      actions: [
        {
          key: 'refresh',
          label: $t('purchase.refresh'),
          icon: RefreshCw,
          title: $t('purchase.refreshHint'),
          disabled: refreshing,
          onClick: () => void refresh(),
        },
        {
          key: 'export',
          label: $t('purchase.export'),
          icon: Upload,
          title: $t('purchase.export'),
          priority: 5,
          onClick: () => (showExport = true),
        },
        {
          key: 'edit',
          label: $t('purchase.editList'),
          icon: Pencil,
          title: $t('purchase.editList'),
          priority: 5,
          onClick: openEditInfo,
        },
        {
          key: 'save',
          label: $t('common.save'),
          icon: Save,
          variant: 'primary',
          priority: 0,
          disabled: !dirty || saving,
          onClick: () => (showSaveConfirm = true),
        },
      ],
    })
  })
</script>

<div class="page">
  {#if loading}
    <div class="loading-tip">{$t('common.loading')}</div>
  {:else if loadError}
    <EmptyState
      title={$t('common.unknownError')}
      actionLabel={$t('common.retry')}
      onAction={() => void load()}
    />
  {:else if !list}
    <EmptyState title={$t('purchase.notFound')} />
  {:else if items.length === 0}
    <EmptyState
      title={$t('purchase.itemsEmpty')}
      description={$t('purchase.refreshHint')}
      actionLabel={$t('purchase.refresh')}
      onAction={() => void refresh()}
    />
  {:else}
    <div class="toolbar">
      <div class="toolbar-group">
        <div class="filter-row">
          <span class="badge badge-list-{list.status}">{statusLabel(list.status)}</span>
          <button
            class="filter-chip"
            class:active={statusFilter === 'all'}
            onclick={() => (statusFilter = 'all')}
          >
            {$t('common.all')}
          </button>
          <button
            class="filter-chip"
            class:active={statusFilter === 'pending'}
            onclick={() => (statusFilter = 'pending')}
          >
            {$t('purchase.itemStatus.pending')}
          </button>
          <button
            class="filter-chip"
            class:active={statusFilter === 'met'}
            onclick={() => (statusFilter = 'met')}
          >
            {$t('purchase.itemStatus.met')}
          </button>
          <button
            class="filter-chip"
            class:active={statusFilter === 'skipped'}
            onclick={() => (statusFilter = 'skipped')}
          >
            {$t('purchase.itemStatus.skipped')}
          </button>
        </div>

        <label class="sort-wrap">
          <span class="sort-label">{$t('purchase.sort')}</span>
          <select class="sort-select" bind:value={sortKey}>
            <option value="status">{$t('purchase.sort.status')}</option>
            <option value="category">{$t('purchase.sort.category')}</option>
            <option value="color">{$t('purchase.sort.color')}</option>
            <option value="needed">{$t('purchase.sort.needed')}</option>
            <option value="rarity">{$t('purchase.sort.rarity')}</option>
          </select>
        </label>
      </div>

      <!-- {#if dirty}
        <div class="summary">
          <span class="dirty-dot">•</span>
          <span class="dirty-text">{$t('purchase.dirtyHint')}</span>
        </div>
      {/if} -->
    </div>

    <div class="list">
      {#each sortedRows as v (v.item.id)}
        <div class="row" class:skipped={v.skipped}>
          <div class="row-head">
            <CardSimpleImage
              url={v.item.img_cdn}
              name={printCacheName({
                card_no_extend: v.item.card_no_extend,
                language: v.item.img_lang,
                id: v.item.card_no,
              })}
              className="row-thumb"
            />
            <div class="row-head-main">
              <span class="row-name">{v.item.card_name_cn || v.item.card_no}</span>
              <span class="row-extend">
                {v.item.card_no_extend ? v.item.card_no_extend : $t('purchase.anyVariant')}
              </span>
            </div>
            <span class="badge badge-{statusClass(v)}">{statusText(v)}</span>
            <button
              class="icon-btn danger"
              title={$t('common.delete')}
              onclick={() => remove(v.item)}
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div class="row-stats">
            <span class="stat">
              <span class="stat-label">{$t('purchase.required')}</span>
              <b>{v.item.qty_required}</b>
            </span>
            <span class="stat">
              <span class="stat-label">{$t('purchase.owned')}</span>
              <b>{v.owned}</b>
            </span>
            {#if v.item.other_owned > 0}
              <button class="other-owned" onclick={() => void openOtherOwned(v.item)}>
                {$t('purchase.otherOwned', { values: { n: v.item.other_owned } })}
              </button>
            {/if}
            <span class="stat">
              <span class="stat-label">{$t('purchase.toBuy')}</span>
              <b class="to-buy">{v.toBuy}</b>
            </span>
            <button
              class="skip-btn"
              class:on={v.skipped}
              onclick={() => setEdit(v.item, { skipped: !v.skipped })}
            >
              {v.skipped ? $t('purchase.unskip') : $t('purchase.skip')}
            </button>
          </div>

          <div class="row-edits">
            <div class="qty-field">
              <span class="qty-label">{$t('purchase.ordered')}</span>
              <div class="qty-control">
                <button
                  class="step"
                  aria-label="−"
                  disabled={v.qtyOrdered <= 0}
                  onclick={() => setEdit(v.item, { qtyOrdered: v.qtyOrdered - 1 })}
                >
                  <Minus size={14} />
                </button>
                <input
                  class="qty-input"
                  type="number"
                  min="0"
                  value={v.qtyOrdered}
                  oninput={(e) =>
                    setEdit(v.item, {
                      qtyOrdered: Number((e.currentTarget as HTMLInputElement).value),
                    })}
                />
                <button
                  class="step"
                  aria-label="+"
                  onclick={() => setEdit(v.item, { qtyOrdered: v.qtyOrdered + 1 })}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div class="qty-field">
              <span class="qty-label">{$t('purchase.borrowed')}</span>
              <div class="qty-control">
                <button
                  class="step"
                  aria-label="−"
                  disabled={v.qtyBorrowed <= 0}
                  onclick={() => setEdit(v.item, { qtyBorrowed: v.qtyBorrowed - 1 })}
                >
                  <Minus size={14} />
                </button>
                <input
                  class="qty-input"
                  type="number"
                  min="0"
                  value={v.qtyBorrowed}
                  oninput={(e) =>
                    setEdit(v.item, {
                      qtyBorrowed: Number((e.currentTarget as HTMLInputElement).value),
                    })}
                />
                <button
                  class="step"
                  aria-label="+"
                  onclick={() => setEdit(v.item, { qtyBorrowed: v.qtyBorrowed + 1 })}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div class="qty-field">
              <span class="qty-label">{$t('purchase.bought')}</span>
              <div class="qty-control">
                <button
                  class="step"
                  aria-label="−"
                  disabled={v.qtyBought <= 0}
                  onclick={() => setEdit(v.item, { qtyBought: v.qtyBought - 1 })}
                >
                  <Minus size={14} />
                </button>
                <input
                  class="qty-input"
                  type="number"
                  min="0"
                  value={v.qtyBought}
                  oninput={(e) =>
                    setEdit(v.item, {
                      qtyBought: Number((e.currentTarget as HTMLInputElement).value),
                    })}
                />
                <button
                  class="step"
                  aria-label="+"
                  onclick={() => setEdit(v.item, { qtyBought: v.qtyBought + 1 })}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <CommonModal
    open={showSaveConfirm}
    title={$t('purchase.saveConfirmTitle')}
    subtitle={$t('purchase.saveConfirmDesc')}
    onclose={() => (showSaveConfirm = false)}
  >
    <div class="save-list">
      {#each changedRows as v (v.item.id)}
        <div class="save-row">
          <span class="save-name">{v.item.card_name_cn || v.item.card_no_extend}</span>
          <span class="save-detail">
            {$t('purchase.ordered')}
            {v.item.qty_ordered}→{v.qtyOrdered} · {$t('purchase.borrowed')}{' '}
            {v.item.qty_borrowed}→{v.qtyBorrowed} · {$t('purchase.bought')}{' '}
            {v.item.qty_bought}→{v.qtyBought} · {$t('purchase.toBuy')}
            {oldToBuy(v)}→{v.toBuy}
            {#if v.skipped}
              · {$t('purchase.itemStatus.skipped')}
            {/if}
          </span>
        </div>
      {/each}
    </div>

    {#snippet footer()}
      <button class="button button-ghost" onclick={() => (showSaveConfirm = false)}>
        {$t('common.cancel')}
      </button>
      <button class="button button-primary" disabled={saving} onclick={confirmSave}>
        {saving ? $t('common.saving') : $t('common.save')}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={showExport}
    title={$t('purchase.export')}
    subtitle={$t('purchase.exportHint')}
    onclose={() => (showExport = false)}
  >
    <div class="export-entity">
      <div class="export-entity-title">{$t('purchase.exportEntityTitle')}</div>
      <div class="export-entity-list">
        <div class="export-entity-row">{$t('purchase.entityNo')}</div>
        <div class="export-entity-row">{$t('purchase.entityName')}</div>
        <div class="export-entity-row">{$t('purchase.entityRarity')}</div>
        <div class="export-entity-row">{$t('purchase.entityLang')}</div>
        <div class="export-entity-row">{$t('purchase.entityOwned')}</div>
        <div class="export-entity-row">{$t('purchase.entityNeeded')}</div>
      </div>
    </div>
    <div class="export-actions">
      <button
        class="export-btn"
        onclick={() => {
          showExport = false
          void copyExport('txt')
        }}
      >
        <Copy size={16} />
        <span>{$t('purchase.copyTxt')}</span>
      </button>
      <button
        class="export-btn"
        onclick={() => {
          showExport = false
          void copyExport('csv')
        }}
      >
        <Copy size={16} />
        <span>{$t('purchase.copyCsv')}</span>
      </button>
      <button
        class="export-btn"
        onclick={() => {
          showExport = false
          void downloadExport('txt')
        }}
      >
        <FileText size={16} />
        <span>{$t('purchase.downloadTxt')}</span>
      </button>
      <button
        class="export-btn"
        onclick={() => {
          showExport = false
          void downloadExport('csv')
        }}
      >
        <FileDown size={16} />
        <span>{$t('purchase.downloadCsv')}</span>
      </button>
    </div>
  </CommonModal>

  <CommonModal
    open={showOtherOwned}
    title={$t('purchase.otherOwnedTitle')}
    onclose={() => (showOtherOwned = false)}
  >
    <div class="other-list">
      {#each otherOwnedRows as r (r.card_no_extend)}
        <div class="other-row">
          <span class="other-name">
            {r.card_no_extend}
            {#if r.rarity}
              <span class="other-rarity">· {r.rarity}</span>
            {/if}
          </span>
          <span class="other-qty">
            {$t('wishlist.finish.normal')} × {r.normal_qty}
            {#if r.foil_qty > 0}
              · {$t('wishlist.finish.foil')} × {r.foil_qty}
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </CommonModal>
</div>

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

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px 4px;
    flex-wrap: wrap;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
        width: 100%;
  }

  .filter-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .filter-chip {
    padding: 4px 12px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .filter-chip.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
    border-color: var(--text-tertiary);
  }

  .sort-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left:auto;
  }

  .sort-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .sort-select {
    padding: 4px 8px;
    font-size: var(--text-xs);
    font-family: inherit;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .dirty-dot {
    color: #d97706;
  }

  .dirty-text {
    color: #d97706;
  }

  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 8px;
    padding: 12px 16px 24px;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .row.skipped {
    opacity: 0.5;
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  :global(.row-thumb) {
    width: 56px;
    height: 78px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .row-head-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
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
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--text-xs);
    background: var(--bg-hover);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .badge-pending {
    color: #d97706;
    background: rgba(217, 119, 6, 0.14);
  }

  .badge-met {
    color: #0e8a3e;
    background: rgba(14, 138, 62, 0.12);
  }

  .badge-skipped {
    color: var(--text-tertiary);
  }

  .badge-list-open {
    color: #0e8a3e;
    background: rgba(14, 138, 62, 0.12);
  }

  .badge-list-completed,
  .badge-list-archived {
    opacity: 0.65;
  }

  .row-stats {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--border-color);
  }

  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .stat b {
    font-size: var(--text-base);
    color: var(--text-primary);
  }

  .to-buy {
    color: #d97706;
    font-weight: 600;
  }

  .skip-btn {
    margin-left: auto;
    padding: 4px 12px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: transparent;
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .skip-btn:hover {
    background: var(--bg-hover);
  }

  .skip-btn.on {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .other-owned {
    padding: 3px 10px;
    border: 1px solid color-mix(in oklab, #2563eb 40%, var(--border-color));
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.1);
    color: #2563eb;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .other-owned:hover {
    background: rgba(37, 99, 235, 0.18);
  }

  .other-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 320px;
    overflow-y: auto;
  }

  .other-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .other-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    font-family: monospace;
  }

  .other-rarity {
    font-family: inherit;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .other-qty {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .row-edits {
    display: flex;
    align-items: center;
    gap: 16px;
    justify-content: space-between;
    flex-wrap: wrap;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--border-color);
  }

  .qty-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    /* flex: 1 1 150px; */
    /* min-width: 150px; */
  }

  @media (max-width: 767.99px){
    .qty-field {
      min-width: 200px;  
    }
  }

  @media (max-width: 479.99px){
    .qty-field {
      width: 100%;
    }
  }

  .qty-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .qty-control {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .step {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .step:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .step:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .qty-input {
    width: 52px;
    padding: 4px 6px;
    text-align: center;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-sm);
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
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
  }

  .icon-btn.danger:hover {
    color: #e5484d;
  }

  .save-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 300px;
    overflow-y: auto;
  }

  .save-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .save-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .save-detail {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .export-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .export-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .export-btn:hover {
    background: var(--bg-hover);
  }

  .loading-tip {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .export-entity {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }

  .export-entity-title {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .export-entity-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    border-radius: 8px;
    background: var(--bg-secondary);
  }

  .export-entity-row {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  @media (max-width: 767.99px) {
    .list {
      display: flex;
      flex-direction: column;
    }

    .step {
      width: 36px;
      height: 36px;
    }

    .toolbar {
      flex-direction: column;
      align-items: flex-start;
    }

    .toolbar-group {
      width: 100%;
      justify-content: space-between;
    }
  }
</style>
