<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { Plus, Trash2, ListChecks, Check, Archive, Pencil } from '@lucide/svelte'
  import {
    getPurchaseLists,
    deletePurchaseList,
    updatePurchaseList,
    updatePurchaseListStatus,
    getPurchaseListItemCounts,
    type PurchaseList,
    type PurchaseListStatus,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { confirmAction } from '$lib/utils/confirm'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  let lists = $state<PurchaseList[]>([])
  let itemCounts = $state<Map<string, number>>(new Map())
  let loading = $state(true)

  let editingList = $state<PurchaseList | null>(null)
  let editSaving = $state(false)
  let editForm = $state({ name: '' })

  async function load() {
    loading = true
    try {
      const [listRes, countRes] = await Promise.all([
        getPurchaseLists(),
        getPurchaseListItemCounts(),
      ])
      lists = listRes
      itemCounts = countRes
    } finally {
      loading = false
    }
  }

  function openCreate() {
    void goto('/collection/purchase-lists/new')
  }

  async function setStatus(list: PurchaseList, status: PurchaseListStatus) {
    await updatePurchaseListStatus(list.id, status)
    void load()
  }

  function openEdit(list: PurchaseList) {
    editingList = list
    editForm.name = list.name
  }

  async function submitEdit() {
    if (!editingList || editSaving) return
    editSaving = true
    try {
      await updatePurchaseList(editingList.id, { name: editForm.name })
      showToast(get(t)('purchase.listUpdated'), 'success')
      editingList = null
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      editSaving = false
    }
  }

  async function remove(list: PurchaseList) {
    const confirmed = await confirmAction(
      get(t)('purchase.deleteListConfirm', { values: { name: list.name } }),
      {
        title: get(t)('purchase.title'),
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!confirmed) return
    await deletePurchaseList(list.id)
    showToast(get(t)('purchase.deleted'), 'info')
    void load()
  }

  function statusLabel(status: PurchaseListStatus): string {
    return get(t)(`purchase.listStatus.${status}`)
  }

  function displayDate(iso: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso.slice(0, 10)
    return d.toISOString().slice(0, 10)
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: $t('purchase.title'),
      onBack: () => void goto('/collection'),
      actions: [
        {
          key: 'create',
          label: $t('purchase.create'),
          icon: Plus,
          onClick: openCreate,
          variant: 'primary',
        },
      ],
    })
  })
</script>

<div class="page">
  {#if loading && lists.length === 0}
    <div class="loading-tip">{$t('common.loading')}</div>
  {:else if lists.length === 0}
    <EmptyState
      title={$t('purchase.emptyTitle')}
      description={$t('purchase.emptyDesc')}
      actionLabel={$t('purchase.create')}
      onAction={openCreate}
    />
  {:else}
    <div class="list">
      {#each lists as list (list.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="row"
          role="button"
          tabindex="0"
          onclick={() => void goto(`/collection/purchase-lists/${list.id}`)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              void goto(`/collection/purchase-lists/${list.id}`)
            }
          }}
        >
          <div class="row-main">
            <div class="row-title">
              <span class="row-name">{list.name}</span>
              <span class="badge badge-{list.status}">{statusLabel(list.status)}</span>
            </div>
            <div class="row-meta">
              <span class="meta-item">{itemCounts.get(list.id) ?? 0} {$t('purchase.items')}</span>
              <span class="meta-item">{displayDate(list.created_at)}</span>
            </div>
          </div>
          <div class="row-actions">
            {#if list.status === 'open'}
              <button
                class="icon-btn"
                title={$t('purchase.complete')}
                onclick={(e) => {
                  e.stopPropagation()
                  void setStatus(list, 'completed')
                }}
              >
                <Check size={16} />
              </button>
              <button
                class="icon-btn"
                title={$t('purchase.archive')}
                onclick={(e) => {
                  e.stopPropagation()
                  void setStatus(list, 'archived')
                }}
              >
                <Archive size={16} />
              </button>
            {:else}
              <button
                class="icon-btn"
                title={$t('purchase.reopen')}
                onclick={(e) => {
                  e.stopPropagation()
                  void setStatus(list, 'open')
                }}
              >
                <ListChecks size={16} />
              </button>
            {/if}
            <button
              class="icon-btn"
              title={$t('purchase.editList')}
              onclick={(e) => {
                e.stopPropagation()
                openEdit(list)
              }}
            >
              <Pencil size={16} />
            </button>
            <button
              class="icon-btn danger"
              title={$t('common.delete')}
              onclick={(e) => {
                e.stopPropagation()
                void remove(list)
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<CommonModal
  open={editingList !== null}
  title={$t('purchase.editList')}
  onclose={() => (editingList = null)}
>
  <div class="form">
    <div class="field">
      <label class="label" for="pl-edit-name">{$t('purchase.listName')}</label>
      <input
        class="input"
        id="pl-edit-name"
        bind:value={editForm.name}
        placeholder={$t('purchase.listNamePlaceholder')}
      />
    </div>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (editingList = null)}>
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      disabled={editSaving || editForm.name.trim() === ''}
      onclick={submitEdit}
    >
      {editSaving ? $t('common.saving') : $t('common.save')}
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

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
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
    cursor: pointer;
  }

  .row:hover {
    border-color: var(--text-tertiary);
  }

  .row-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row-title {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .row-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--text-xs);
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .badge-open {
    color: #0e8a3e;
    background: rgba(14, 138, 62, 0.12);
  }

  .badge-completed,
  .badge-archived {
    opacity: 0.65;
  }

  .badge-merge {
    color: #2563eb;
    background: rgba(37, 99, 235, 0.12);
  }

  .row-meta {
    display: flex;
    gap: 12px;
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

  .mode-toggle {
    display: flex;
    gap: 8px;
  }

  .mode-option {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .mode-option.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
    border-color: var(--text-tertiary);
  }

  .mode-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .loading-tip {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }
</style>
