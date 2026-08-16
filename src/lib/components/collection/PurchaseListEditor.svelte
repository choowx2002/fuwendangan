<script lang="ts">
  import { onMount } from 'svelte'
  import { goto, beforeNavigate, afterNavigate } from '$app/navigation'
  import { Plus, Trash2, Save } from '@lucide/svelte'
  import {
    getPurchaseList,
    getPurchaseListItems,
    getCustomLanguages,
    getDecks,
    listCardVariants,
    getDeckPurchasePreview,
    savePurchaseListEditor,
    createPurchaseListEditor,
    PRESET_LANGUAGE_CODES,
    printCacheName,
    type Deck,
    type CardPrint,
    type PurchaseListEditorRow,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { defaultLanguage } from '$lib/stores/settings'
  import { confirmAction } from '$lib/utils/confirm'
  import VariantPicker from './VariantPicker.svelte'
  import CardSimpleImage from '../cards/CardSimpleImage.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import type { VariantWithOwned } from '$lib/db'

  let {
    mode,
    listId = null,
  }: {
    mode: 'create' | 'edit'
    listId?: string | null
  } = $props()

  interface EditRow {
    itemId?: string | null
    cardNo: string
    cardNoExtend: string
    cardName: string
    imgCdn: string | null
    imgLang: string | null
    languagePref: string
    finishPref: string
    qtyRequired: number
  }

  let listName = $state('')
  let rows = $state<EditRow[]>([])
  let langOptions = $state<string[]>([...PRESET_LANGUAGE_CODES])
  let variantsByCard = $state<Record<string, CardPrint[]>>({})
  let decks = $state<Deck[]>([])
  let deckId = $state('')

  let loading = $state(true)
  let saving = $state(false)
  let generating = $state(false)
  let dirty = $state(false)
  let allowLeave = $state(false)
  let showPicker = $state(false)

  const backUrl = $derived(
    mode === 'edit' && listId
      ? `/collection/purchase-lists/${listId}`
      : '/collection/purchase-lists'
  )

  async function load() {
    loading = true
    try {
      const [customs, deckRes] = await Promise.all([getCustomLanguages(), getDecks()])
      langOptions = [...PRESET_LANGUAGE_CODES, ...customs.map((c) => c.code)]
      decks = deckRes
      if (mode === 'edit' && listId) {
        const [listRes, itemRes] = await Promise.all([
          getPurchaseList(listId),
          getPurchaseListItems(listId),
        ])
        if (!listRes) {
          showToast(get(t)('purchase.notFound'), 'error')
          await goto('/collection/purchase-lists')
          return
        }
        listName = listRes.name
        rows = itemRes.map((i) => ({
          itemId: i.id,
          cardNo: i.card_no,
          cardNoExtend: i.card_no_extend,
          cardName: i.card_name_cn || i.card_no,
          imgCdn: i.img_cdn,
          imgLang: i.img_lang,
          languagePref: i.language_pref,
          finishPref: i.finish_pref,
          qtyRequired: i.qty_required,
        }))
        for (const r of rows) void loadVariants(r.cardNo)
      }
    } finally {
      loading = false
    }
  }

  async function loadVariants(cardNo: string) {
    if (variantsByCard[cardNo]) return
    try {
      const list = await listCardVariants(cardNo)
      variantsByCard = { ...variantsByCard, [cardNo]: list }
    } catch {
      // 忽略：该卡无印刷数据时保持空列表
    }
  }

  function variantOptions(cardNo: string): { extend: string; label: string }[] {
    const prints = variantsByCard[cardNo] ?? []
    const seen = new Set<string>()
    const out: { extend: string; label: string }[] = []
    for (const p of prints) {
      if (seen.has(p.card_no_extend)) continue
      seen.add(p.card_no_extend)
      out.push({
        extend: p.card_no_extend,
        label: `${p.card_no_extend}${p.rarity_name ? ' · ' + p.rarity_name : ''}`,
      })
    }
    return out
  }

  function rowKey(r: EditRow, i: number): string {
    return `${i}|${r.cardNo}|${r.cardNoExtend}|${r.languagePref}|${r.finishPref}`
  }

  function addCard(v: VariantWithOwned) {
    const lang = get(defaultLanguage)
    const ex = rows.find(
      (r) =>
        r.cardNo === v.cardNo &&
        r.cardNoExtend === v.cardNoExtend &&
        r.languagePref === lang &&
        r.finishPref === 'any'
    )
    if (ex) {
      ex.qtyRequired += 1
    } else {
      rows.push({
        cardNo: v.cardNo,
        cardNoExtend: v.cardNoExtend,
        cardName: v.card_name_cn || v.cardNo,
        imgCdn: v.imgCdn,
        imgLang: v.printLanguage,
        languagePref: lang,
        finishPref: 'any',
        qtyRequired: 1,
      })
      void loadVariants(v.cardNo)
    }
    dirty = true
    showPicker = false
  }

  function onVariantChange(row: EditRow) {
    const p = (variantsByCard[row.cardNo] ?? []).find((x) => x.card_no_extend === row.cardNoExtend)
    if (p?.img_cdn) row.imgCdn = p.img_cdn
    if (p?.language) row.imgLang = p.language
    dirty = true
  }

  function onQtyChange(row: EditRow, e: Event) {
    row.qtyRequired = Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1)
    dirty = true
  }

  function removeRow(i: number) {
    rows.splice(i, 1)
    dirty = true
  }

  async function generateFromDeck() {
    if (!deckId || generating) return
    generating = true
    try {
      const preview = await getDeckPurchasePreview(deckId)
      const seen = new Set<string>()
      for (const p of preview) {
        const key = `${p.cardNo}|${p.cardNoExtend}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({
          cardNo: p.cardNo,
          cardNoExtend: p.cardNoExtend,
          cardName: p.cardName || p.cardNo,
          imgCdn: null,
          imgLang: null,
          languagePref: get(defaultLanguage),
          finishPref: 'any',
          qtyRequired: Math.max(1, p.needed),
        })
        void loadVariants(p.cardNo)
      }
      dirty = true
      showToast(get(t)('purchase.refreshed', { values: { count: preview.length } }), 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      generating = false
    }
  }

  function toEditorRow(r: EditRow): PurchaseListEditorRow {
    return {
      itemId: r.itemId ?? null,
      cardNo: r.cardNo,
      cardNoExtend: r.cardNoExtend,
      languagePref: r.languagePref,
      finishPref: r.finishPref as PurchaseListEditorRow['finishPref'],
      qtyRequired: Math.max(1, r.qtyRequired),
    }
  }

  async function save() {
    if (saving || !dirty) return
    saving = true
    try {
      if (mode === 'edit' && listId) {
        const res = await savePurchaseListEditor(listId, rows.map(toEditorRow), listName)
        showToast(
          get(t)('purchase.editorSaved', {
            values: { added: res.added, updated: res.updated, removed: res.removed },
          }),
          'success'
        )
        allowLeave = true
        await goto(backUrl)
      } else {
        const id = await createPurchaseListEditor({ name: listName, rows: rows.map(toEditorRow) })
        showToast(get(t)('purchase.created'), 'success')
        allowLeave = true
        await goto(`/collection/purchase-lists/${id}`)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      saving = false
    }
  }

  async function cancel() {
    if (!dirty) {
      await goto(backUrl)
      return
    }
    const ok = await confirmAction(get(t)('purchase.dirtyConfirm'), {
      title: get(t)('purchase.title'),
      okLabel: get(t)('purchase.discard'),
      cancelLabel: get(t)('common.cancel'),
    })
    if (!ok) return
    allowLeave = true
    await goto(backUrl)
  }

  beforeNavigate(({ cancel: cancelNav, to }) => {
    if (!dirty || allowLeave || !to) return
    cancelNav()
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
          allowLeave = false
        }
      }
    })()
  })

  afterNavigate(() => {
    allowLeave = false
  })

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: mode === 'edit' ? listName || $t('purchase.editList') : $t('purchase.editorNewTitle'),
      onBack: () => void cancel(),
      actions: [
        {
          key: 'add',
          label: $t('purchase.addCards'),
          icon: Plus,
          title: $t('purchase.addCards'),
          onClick: () => (showPicker = true),
        },
        {
          key: 'save',
          label: $t('common.save'),
          icon: Save,
          variant: 'primary',
          disabled: saving || !dirty,
          onClick: () => void save(),
        },
      ],
    })
  })
</script>

<div class="editor">
  {#if loading}
    <div class="loading-tip">{$t('common.loading')}</div>
  {:else}
    <div class="editor-header">
      <div class="field name-field">
        <label class="label" for="editor-name">{$t('purchase.listName')}</label>
        <input
          class="input"
          id="editor-name"
          bind:value={listName}
          oninput={() => (dirty = true)}
          placeholder={$t('purchase.listNamePlaceholder')}
        />
      </div>
      {#if mode === 'create'}
        <div class="field deck-field">
          <label class="label" for="editor-deck">{$t('purchase.deckTemplate')}</label>
          <div class="deck-row">
            <select class="select" id="editor-deck" bind:value={deckId}>
              <option value="">{$t('purchase.noDeckOption')}</option>
              {#each decks as d (d.id)}
                <option value={d.id}>{d.name}</option>
              {/each}
            </select>
            <button
              class="button button-secondary"
              disabled={generating || !deckId}
              onclick={generateFromDeck}
            >
              {generating ? $t('common.loading') : $t('purchase.generateFromDeck')}
            </button>
          </div>
        </div>
      {/if}
    </div>

    {#if rows.length === 0}
      <div class="editor-empty">
        <p>{$t('purchase.editorHint')}</p>
        <button class="button button-primary" onclick={() => (showPicker = true)}>
          <Plus size={15} />
          {$t('purchase.addCards')}
        </button>
      </div>
    {:else}
      <div class="table-wrap">
        <table class="editor-table">
          <thead>
            <tr>
              <th class="col-card">{$t('purchase.card')}</th>
              <th>{$t('purchase.variant')}</th>
              <th>{$t('purchase.required')}</th>
              <th>{$t('wishlist.language')}</th>
              <th>{$t('wishlist.finish')}</th>
              <th class="col-op"></th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row, i (rowKey(row, i))}
              <tr>
                <td>
                  <div class="cell-card">
                    <CardSimpleImage
                      url={row.imgCdn}
                      name={printCacheName({
                        card_no_extend: row.cardNoExtend,
                        language: row.imgLang,
                        id: row.cardNo,
                      })}
                      className="cell-thumb"
                    />
                    <div class="cell-main">
                      <span class="cell-name">{row.cardName}</span>
                      <span class="cell-extend">{row.cardNoExtend}</span>
                    </div>
                  </div>
                </td>
                <td data-label={$t('purchase.variant')}>
                  <select
                    class="select cell-select"
                    bind:value={row.cardNoExtend}
                    onchange={() => onVariantChange(row)}
                  >
                    {#each variantOptions(row.cardNo) as opt (opt.extend)}
                      <option value={opt.extend}>{opt.label}</option>
                    {/each}
                  </select>
                </td>
                <td data-label={$t('purchase.required')}>
                  <input
                    class="qty-input"
                    type="number"
                    min="1"
                    value={row.qtyRequired}
                    oninput={(e) => onQtyChange(row, e)}
                  />
                </td>
                <td data-label={$t('wishlist.language')}>
                  <select
                    class="select cell-select"
                    bind:value={row.languagePref}
                    onchange={() => (dirty = true)}
                  >
                    {#each langOptions as c (c)}
                      <option value={c}>{c}</option>
                    {/each}
                  </select>
                </td>
                <td data-label={$t('wishlist.finish')}>
                  <select
                    class="select cell-select"
                    bind:value={row.finishPref}
                    onchange={() => (dirty = true)}
                  >
                    <option value="any">{$t('wishlist.finish.any')}</option>
                    <option value="normal">{$t('wishlist.finish.normal')}</option>
                    <option value="foil">{$t('wishlist.finish.foil')}</option>
                  </select>
                </td>
                <td>
                  <button
                    class="icon-btn danger"
                    title={$t('common.delete')}
                    onclick={() => removeRow(i)}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="editor-footer">
        <button class="button button-ghost" onclick={() => (showPicker = true)}>
          <Plus size={15} />
          {$t('purchase.addCards')}
        </button>
      </div>
    {/if}
  {/if}

  <VariantPicker open={showPicker} onClose={() => (showPicker = false)} onSelect={addCard} />
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 14px 16px 24px;
    gap: 12px;
  }

  .editor-header {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .name-field {
    flex: 1;
    min-width: 220px;
  }

  .deck-field {
    flex: 1;
    min-width: 260px;
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

  .deck-row {
    display: flex;
    gap: 8px;
  }

  .deck-row .select {
    flex: 1;
  }

  .editor-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 48px 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .editor-empty p {
    margin: 0;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }

  .editor-table {
    border-collapse: collapse;
    width: 100%;
    min-width: 780px;
    font-size: var(--text-sm);
  }

  .editor-table th,
  .editor-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    vertical-align: middle;
  }

  .editor-table th {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .editor-table tr:last-child td {
    border-bottom: none;
  }

  .col-card {
    min-width: 220px;
  }

  .col-op {
    width: 44px;
  }

  .cell-card {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  :global(.cell-thumb) {
    width: 40px;
    height: 56px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .cell-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .cell-name {
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell-extend {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: monospace;
  }

  .cell-select {
    max-width: 220px;
    padding: 6px 8px;
    font-size: var(--text-xs);
  }

  .qty-input {
    width: 64px;
    padding: 6px 8px;
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
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.danger:hover {
    color: #e5484d;
  }

  .editor-footer {
    display: flex;
    justify-content: center;
  }

  .loading-tip {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  /* 移动端：表格改为卡片堆叠，行内操作区直接可见 */
  @media (max-width: 767.99px) {
    .editor {
      padding: 12px;
      gap: 10px;
    }

    .editor-header {
      flex-direction: column;
      align-items: stretch;
    }

    .deck-row {
      flex-direction: column;
      align-items: stretch;
    }

    .deck-row .select {
      width: 100%;
    }

    .table-wrap {
      overflow: visible;
      border: none;
      border-radius: 0;
    }

    .editor-table {
      min-width: 0;
    }

    .editor-table,
    .editor-table tbody,
    .editor-table tr,
    .editor-table td {
      display: block;
      width: 100%;
    }

    .editor-table thead {
      display: none;
    }

    .editor-table tr {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-secondary);
      padding: 10px 12px;
      margin-bottom: 10px;
    }

    .editor-table tr:last-child td {
      border-bottom: none;
    }

    .editor-table td {
      border: none;
      border-bottom: 1px dashed var(--border-color);
      padding: 8px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .editor-table td::before {
      content: attr(data-label);
      font-size: var(--text-xs);
      color: var(--text-tertiary);
      flex-shrink: 0;
      width: 72px;
    }

    /* 卡牌标题单元格：不显示标签，卡片信息铺满 */
    .editor-table td:first-child::before {
      display: none;
    }

    .editor-table td:first-child {
      justify-content: flex-start;
    }

    /* 删除按钮：独立一行，右对齐 */
    .editor-table td:last-child {
      border-bottom: none;
      justify-content: flex-end;
      padding-top: 10px;
    }

    .editor-table td:last-child::before {
      display: none;
    }

    .cell-select {
      max-width: 60%;
    }

    .cell-name {
      max-width: 60vw;
    }

    .qty-input {
      width: 72px;
      padding: 8px;
      font-size: var(--text-base);
    }
  }

  @media (max-width: 479.99px) {
    .cell-card {
      gap: 8px;
    }

    :global(.cell-thumb) {
      width: 36px;
      height: 50px;
    }
  }
</style>
