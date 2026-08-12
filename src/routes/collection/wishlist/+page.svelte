<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { Plus, Trash2, Check, Archive, Heart } from '@lucide/svelte'
  import {
    getWishlistItems,
    upsertWishlistItem,
    updateWishlistStatus,
    deleteWishlistItem,
    PRESET_LANGUAGE_CODES,
    printCacheName,
    type WishlistStatus,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
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

  let showAdd = $state(false)
  let showPicker = $state(false)
  let saving = $state(false)
  let form = $state({
    cardNo: '',
    cardNoExtend: '',
    cardName: '',
    languageCode: '*',
    finish: 'any' as Finish,
    qtyWanted: 1,
    priority: 3,
    note: '',
  })

  const filtered = $derived(filter === 'all' ? items : items.filter((i) => i.status === filter))

  function finishLabel(finish: string): string {
    if (finish === 'normal') return get(t)('wishlist.finish.normal')
    if (finish === 'foil') return get(t)('wishlist.finish.foil')
    return get(t)('wishlist.finish.any')
  }

  async function load() {
    loading = true
    try {
      items = await getWishlistItems()
    } finally {
      loading = false
    }
  }

  function openAdd() {
    form = {
      cardNo: '',
      cardNoExtend: '',
      cardName: '',
      languageCode: '*',
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
    await updateWishlistStatus(item.id, status)
    void load()
  }

  async function remove(item: WishlistRow) {
    await deleteWishlistItem(item.id)
    showToast(get(t)('wishlist.deleted'), 'info')
    void load()
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
              <span class="tag"
                >{item.language_code === '*' ? $t('wishlist.anyLang') : item.language_code}</span
              >
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
                onclick={() => setStatus(item, 'acquired')}
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
        <option value="*">{$t('wishlist.anyLang')}</option>
        {#each PRESET_LANGUAGE_CODES as code (code)}
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
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 16px 24px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    flex-shrink: 0;
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
</style>
