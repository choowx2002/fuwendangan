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
  import { Star, Plus, Search, X, Trash2, Pencil, ChevronRight } from '@lucide/svelte'
  import { ask } from '@tauri-apps/plugin-dialog'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  let lockers = $state<LockerSummary[]>([])
  let loading = $state(true)

  let lockerModalOpen = $state(false)
  let editingLocker = $state<LockerSummary | null>(null)
  let lockerName = $state('')
  let lockerDesc = $state('')
  let saving = $state(false)

  // 找卡
  let findQuery = $state('')
  let findResults = $state<{ id: string; card_no: string; name: string }[]>([])
  let finding = $state(false)
  let findError = $state('')
  let locations = $state<CardLocation[] | null>(null)
  let locatedName = $state('')
  let findDebounce: ReturnType<typeof setTimeout> | null = null

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
    lockerModalOpen = true
  }

  function openEdit(l: LockerSummary) {
    editingLocker = l
    lockerName = l.name
    lockerDesc = l.description ?? ''
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
        await updateLocker(editingLocker.id, { name: lockerName.trim(), description: lockerDesc.trim() || null })
      } else {
        await createLocker({ name: lockerName.trim(), description: lockerDesc.trim() || null })
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
      const res = await searchCards({ page: 1, pageSize: 8, searchText: q, is_banned: false })
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

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: $t('locker.title'),
      actions: [
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
  <div class="find-card">
    <div class="find-row">
      <Search size={15} class="find-icon" />
      <input
        class="find-input"
        bind:value={findQuery}
        placeholder={$t('locker.findCardPlaceholder')}
        oninput={onFindInput}
        onkeydown={(e) => {
          if (e.key === 'Enter') void runFind()
        }}
      />
      {#if findQuery}
        <button class="find-clear" title={$t('common.clear')} onclick={() => {
          findQuery = ''
          findResults = []
          locations = null
        }}>
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
  </div>

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
          <div class="locker-top">
            <span class="locker-name">{l.name}</span>
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
          </div>
          {#if l.description}
            <div class="locker-desc">{l.description}</div>
          {/if}
          <div class="locker-meta">
            <span>{$t('locker.sections', { values: { count: l.sectionCount } })}</span>
            <span>{$t('locker.cards', { values: { count: l.cardCount } })}</span>
          </div>
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
      <input class="input" bind:value={lockerName} placeholder={$t('locker.lockerNamePlaceholder')} />
    </label>
    <label class="field">
      <span class="field-label">{$t('locker.description')}</span>
      <input class="input" bind:value={lockerDesc} placeholder={$t('locker.descriptionPlaceholder')} />
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

<style>
  .page-wrapper {
    max-width: 1000px;
    margin: 0 auto;
    padding: calc(16px + env(safe-area-inset-top)) 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .find-card {
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-secondary);
    padding: 12px;
  }

  .find-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :global(.find-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .find-input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
    outline: none;
  }

  .find-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: var(--bg-hover);
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .find-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    border-top: 1px solid var(--border-color);
    padding-top: 8px;
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
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .locker-card:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
  }

  .locker-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .locker-name {
    font-size: var(--text-md);
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .locker-actions {
    position: absolute;
    top: 12px;
    right: 44px;
    display: none;
    gap: 4px;
  }

  .locker-card:hover .locker-actions {
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
