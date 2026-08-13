<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import type { LockerSection, LockerCard, VariantWithOwned } from '$lib/db'
  import {
    getLocker,
    getSection,
    updateSection,
    deleteSection,
    getSectionCards,
    addSectionCard,
    addSectionCardsBatch,
    updateSectionCard,
    removeSectionCard,
    removeSectionCardsBatch,
    getGlobalSectionCardQtys,
    searchCardVariants,
    printCacheName,
    type Locker,
    type CollectionSort,
  } from '$lib/db'
  import { Pencil, Trash2, X, CheckSquare, ListChecks, Boxes } from '@lucide/svelte'
  import { ask } from '@tauri-apps/plugin-dialog'
  import { confirmAction } from '$lib/utils/confirm'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import TagInput from '$lib/components/ui/TagInput.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import VariantPool from '$lib/components/locker/VariantPool.svelte'
  import LockerIconPicker from '$lib/components/locker/LockerIconPicker.svelte'
  import { resolveLockerIcon } from '$lib/components/locker/locker-icons'
  import type { VariantPoolFilters } from '$lib/components/locker/variant-pool-types'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  const lockerId = page.params.lockerId ?? ''
  const sectionId = page.params.sectionId ?? ''

  const DRAWER_COLORS = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#94a3b8',
    '#92400e',
  ]

  let locker = $state<Locker | null>(null)
  let section = $state<LockerSection | null>(null)
  let cards = $state<LockerCard[]>([])
  let globalQty = $state(new Map<string, number>())
  let loading = $state(true)

  // 抽屉编辑
  let editOpen = $state(false)
  let editName = $state('')
  let editDesc = $state('')
  let editColor = $state<string | null>(null)
  let editIcon = $state<string | null>(null)
  let editTags = $state<string[]>([])

  // 已收录管理
  let manageOpen = $state(false)

  // 卡池筛选与多选
  let filters = $state<VariantPoolFilters>({
    seriesCode: '',
    bucket: '',
    searchText: '',
    sort: { key: 'card_no', isAsc: true } as CollectionSort,
  })
  let variants = $state<VariantWithOwned[]>([])
  let poolTotal = $state(0)
  let batchMode = $state(false)
  let selectedMap = $state(new Map<string, VariantWithOwned>())
  let busy = $state(false)

  const variantKey = (v: VariantWithOwned) =>
    `${v.cardNo}:${v.cardNoExtend}:${v.printLanguage ?? ''}`

  const selectedIds = $derived(new Set(selectedMap.keys()))
  const existingQty = $derived(
    new Map(
      cards.map((c) => [`${c.card_no}:${c.card_no_extend ?? ''}:${c.language ?? ''}`, c.quantity])
    )
  )
  const drawerTotal = $derived(cards.reduce((a, c) => a + c.quantity, 0))

  async function load() {
    loading = true
    try {
      const [l, s, cs, gq] = await Promise.all([
        getLocker(lockerId),
        getSection(sectionId),
        getSectionCards(sectionId),
        getGlobalSectionCardQtys(),
      ])
      locker = l
      section = s
      cards = cs
      globalQty = gq
    } finally {
      loading = false
    }
  }

  async function removeDrawer() {
    if (!section) return
    const ok = await ask(
      get(t)('locker.deleteSectionConfirm', { values: { name: section.name ?? '' } }),
      {
        title: get(t)('locker.delete'),
        kind: 'warning',
        okLabel: get(t)('locker.delete'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!ok) return
    await deleteSection(section.id)
    await goto(`/locker/${lockerId}`)
  }

  function openEdit() {
    if (!section) return
    editName = section.name ?? ''
    editDesc = section.description ?? ''
    editColor = section.color
    editIcon = section.icon
    editTags = [...(section.tags ?? [])]
    editOpen = true
  }

  async function saveEdit() {
    if (!section) return
    await updateSection(section.id, {
      name: editName.trim() || null,
      description: editDesc.trim() || null,
      color: editColor,
      icon: editIcon,
      tags: editTags,
    })
    editOpen = false
    void load()
  }

  // ===== 点击加入（数量 = 全局剩余 = 收藏量 − 所有抽屉合计） =====

  async function handleCardClick(v: VariantWithOwned) {
    const remaining = Math.max(0, v.ownedTotal - (globalQty.get(variantKey(v)) ?? 0))
    if (remaining <= 0) {
      showToast(get(t)('locker.atLimit', { values: { name: v.card_name_cn ?? v.cardNo } }), 'info')
      return
    }
    await addSectionCard(sectionId, {
      card_no: v.cardNo,
      card_no_extend: v.cardNoExtend,
      language: v.printLanguage,
      quantity: remaining,
    })
    void load()
  }

  // ===== 快捷 +1 / -1（仿收藏页 stepper） =====

  async function handleQuickInc(v: VariantWithOwned) {
    if ((globalQty.get(variantKey(v)) ?? 0) >= v.ownedTotal) {
      showToast(get(t)('locker.atLimit', { values: { name: v.card_name_cn ?? v.cardNo } }), 'info')
      return
    }
    const entry = cards.find(
      (c) =>
        c.card_no === v.cardNo &&
        (c.card_no_extend ?? '') === v.cardNoExtend &&
        (c.language ?? '') === (v.printLanguage ?? '')
    )
    if (entry) {
      await updateSectionCard(entry.id, { quantity: entry.quantity + 1 })
    } else {
      await addSectionCard(sectionId, {
        card_no: v.cardNo,
        card_no_extend: v.cardNoExtend,
        language: v.printLanguage,
        quantity: 1,
      })
    }
    void load()
  }

  async function handleQuickDec(v: VariantWithOwned) {
    const entry = cards.find(
      (c) =>
        c.card_no === v.cardNo &&
        (c.card_no_extend ?? '') === v.cardNoExtend &&
        (c.language ?? '') === (v.printLanguage ?? '')
    )
    if (!entry) return
    if (entry.quantity <= 1) {
      const ok = await confirmAction(
        get(t)('locker.removeCardConfirm', {
          values: { name: v.card_name_cn ?? v.cardNo, qty: 1 },
        }),
        {
          title: get(t)('locker.removeCard'),
          okLabel: get(t)('locker.removeCard'),
          cancelLabel: get(t)('common.cancel'),
        }
      )
      if (!ok) return
      await removeSectionCard(entry.id)
    } else {
      await updateSectionCard(entry.id, { quantity: entry.quantity - 1 })
    }
    void load()
  }

  // ===== 多选 / 全选 / 批量加入 / 批量移出 =====

  function toggleSelect(v: VariantWithOwned) {
    const key = variantKey(v)
    const m = new Map(selectedMap)
    if (m.has(key)) {
      m.delete(key)
    } else {
      m.set(key, v)
    }
    selectedMap = m
  }

  function cancelSelect() {
    selectedMap = new Map()
    batchMode = false
  }

  /** 全选：遍历全部匹配分页（不受已加载限制） */
  async function selectAll() {
    if (busy) return
    busy = true
    try {
      const m = new Map(selectedMap)
      let p = 0
      let hasMore = true
      while (hasMore) {
        p++
        const res = await searchCardVariants({
          page: p,
          pageSize: 500,
          searchText: filters.searchText.trim() || undefined,
          ownership: 'owned',
          seriesCode: filters.seriesCode || undefined,
          bucket: filters.bucket || undefined,
          collectionSort: filters.sort,
        })
        for (const v of res.data) m.set(variantKey(v), v)
        hasMore = p < res.totalPages
      }
      selectedMap = m
    } finally {
      busy = false
    }
  }

  async function addSelected() {
    if (busy || selectedMap.size === 0) return
    busy = true
    let skipped = 0
    const entries: {
      card_no: string
      card_no_extend: string | null
      language: string | null
      quantity: number
    }[] = []
    for (const v of selectedMap.values()) {
      const add = Math.max(0, v.ownedTotal - (globalQty.get(variantKey(v)) ?? 0))
      if (add <= 0) {
        skipped++
        continue
      }
      entries.push({
        card_no: v.cardNo,
        card_no_extend: v.cardNoExtend,
        language: v.printLanguage,
        quantity: add,
      })
    }
    try {
      if (entries.length > 0) await addSectionCardsBatch(sectionId, entries)
      showToast(
        get(t)('locker.addedResult', { values: { added: entries.length, skipped } }),
        'success'
      )
      selectedMap = new Map()
      batchMode = false
      void load()
    } finally {
      busy = false
    }
  }

  /** 批量移出：选中项中已收录的变体整条删除 */
  async function removeSelected() {
    if (busy || selectedMap.size === 0) return
    const ok = await confirmAction(
      get(t)('locker.removeSelectedConfirm', { values: { count: selectedMap.size } }),
      {
        title: get(t)('locker.batchRemove'),
        okLabel: get(t)('common.delete'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!ok) return
    busy = true
    const ids: string[] = []
    for (const v of selectedMap.values()) {
      const entry = cards.find(
        (c) =>
          c.card_no === v.cardNo &&
          (c.card_no_extend ?? '') === v.cardNoExtend &&
          (c.language ?? '') === (v.printLanguage ?? '')
      )
      if (entry) ids.push(entry.id)
    }
    try {
      if (ids.length > 0) await removeSectionCardsBatch(sectionId, ids)
      showToast(get(t)('locker.removedResult', { values: { count: ids.length } }), 'success')
      selectedMap = new Map()
      batchMode = false
      void load()
    } finally {
      busy = false
    }
  }

  // ===== 已收录管理 =====

  async function changeQty(card: LockerCard, qty: number) {
    await updateSectionCard(card.id, { quantity: qty })
    void load()
  }

  async function removeCard(card: LockerCard) {
    const ok = await confirmAction(
      get(t)('locker.removeCardConfirm', {
        values: { name: card.card_no, qty: card.quantity },
      }),
      {
        title: get(t)('locker.removeCard'),
        okLabel: get(t)('common.delete'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!ok) return
    await removeSectionCard(card.id)
    void load()
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: section?.name ?? $t('locker.title'),
      onBack: () => goto(`/locker/${lockerId}/${sectionId}`),
      actions: [
        {
          key: 'manage',
          label: $t('locker.manageCards', { values: { count: drawerTotal } }),
          icon: Boxes,
          title: $t('locker.manageCards', { values: { count: drawerTotal } }),
          onClick: () => (manageOpen = true),
        },
        {
          key: 'edit',
          label: $t('locker.editSection'),
          icon: Pencil,
          title: $t('locker.editSection'),
          onClick: openEdit,
        },
        {
          key: 'delete',
          label: $t('locker.delete'),
          icon: Trash2,
          title: $t('locker.delete'),
          onClick: () => void removeDrawer(),
        },
      ],
    })
  })
</script>

<div class="page-wrapper">
  {#if loading && !section}
    <div class="tip">{$t('common.loading')}</div>
  {:else if !section}
    <div class="tip">{$t('common.notFound')}</div>
  {:else}
    <div class="drawer-panel" style:--drawer-color={section.color ?? 'var(--accent-color)'}>
      <div class="drawer-head">
        <span class="drawer-dot"></span>
        {#if section.icon}
          <img class="drawer-icon" src={resolveLockerIcon(section.icon)} alt="" />
        {/if}
        <span class="drawer-title">{section.name ?? $t('locker.newSection')}</span>
        {#if section.description}
          <span class="drawer-desc">{section.description}</span>
        {/if}
        <span class="drawer-count">{$t('locker.cards', { values: { count: drawerTotal } })}</span>
        {#if section.tags && section.tags.length > 0}
          <div class="drawer-tags">
            {#each section.tags as tag (tag)}
              <span class="drawer-tag">{tag}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if batchMode}
      <div class="batch-bar">
        <span class="batch-info">
          {$t('locker.selectedCount', { values: { count: selectedMap.size } })}
        </span>
        <div class="batch-actions">
          <button
            class="button button-ghost button-sm"
            disabled={busy}
            onclick={() => void selectAll()}
          >
            <CheckSquare size={14} />
            {$t('locker.selectAll')}
          </button>
          <button
            class="button button-primary button-sm"
            disabled={busy || selectedMap.size === 0}
            onclick={() => void addSelected()}
          >
            {busy ? $t('common.loading') : $t('locker.addToDrawer')}
          </button>
          <button
            class="button button-danger-outline button-sm"
            disabled={busy || selectedMap.size === 0}
            onclick={() => void removeSelected()}
          >
            {busy ? $t('common.loading') : $t('locker.batchRemove')}
          </button>
          <button class="button button-ghost button-sm" disabled={busy} onclick={cancelSelect}>
            <X size={14} />
            {$t('common.cancel')}
          </button>
        </div>
      </div>
    {:else}
      <button
        class="batch-toggle"
        onclick={() => {
          batchMode = true
        }}
      >
        <ListChecks size={14} />
        {$t('locker.multiSelect')}
      </button>
    {/if}

    <VariantPool
      bind:filters
      bind:variants
      bind:total={poolTotal}
      {existingQty}
      {globalQty}
      selectable={batchMode}
      {selectedIds}
      quickEdit={!batchMode}
      onQuickInc={handleQuickInc}
      onQuickDec={handleQuickDec}
      onToggleSelect={toggleSelect}
      onCardClick={handleCardClick}
    />
  {/if}
</div>

<!-- 抽屉编辑弹窗 -->
<CommonModal
  open={editOpen}
  title={$t('locker.editSection')}
  width="min(440px, 100%)"
  onclose={() => (editOpen = false)}
>
  <div class="form">
    <label class="field">
      <span class="field-label">{$t('locker.sectionName')}</span>
      <input
        class="input"
        bind:value={editName}
        placeholder={$t('locker.sectionNamePlaceholder')}
      />
    </label>
    <label class="field">
      <span class="field-label">{$t('locker.sectionDesc')}</span>
      <input class="input" bind:value={editDesc} />
    </label>
    <div class="field">
      <span class="field-label">{$t('locker.drawerColor')}</span>
      <div class="color-row">
        <button
          class="color-swatch color-default"
          class:selected={editColor === null}
          title={$t('locker.colorDefault')}
          onclick={() => (editColor = null)}
        >
          <span class="color-default-text">{$t('locker.colorDefault')}</span>
        </button>
        {#each DRAWER_COLORS as color (color)}
          <button
            class="color-swatch"
            class:selected={editColor === color}
            style={`background: ${color}`}
            title={color}
            onclick={() => (editColor = color)}
          ></button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span class="field-label">{$t('locker.icon')}</span>
      <LockerIconPicker value={editIcon} onChange={(v) => (editIcon = v)} />
    </div>
    <label class="field">
      <span class="field-label">{$t('locker.tags')}</span>
      <TagInput
        value={editTags}
        placeholder={$t('locker.tagPlaceholder')}
        onChange={(v) => (editTags = v)}
      />
    </label>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (editOpen = false)}>
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" onclick={saveEdit}>
      {$t('locker.save')}
    </button>
  {/snippet}
</CommonModal>

<!-- 已收录管理弹窗 -->
<CommonModal
  open={manageOpen}
  title={$t('locker.sectionCards', { values: { name: section?.name ?? '' } })}
  width="min(560px, 100%)"
  onclose={() => (manageOpen = false)}
>
  <div class="manage-list">
    {#if cards.length === 0}
      <div class="empty-hint">{$t('locker.noCardsInSection')}</div>
    {:else}
      {#each cards as card (card.id)}
        <div class="card-row">
          <div class="row-thumb">
            {#if card.print}
              <CardSimpleImage
                url={card.print.img_cdn ?? card.print.tts_cdn ?? ''}
                name={printCacheName(card.print)}
                className="row-thumb-src"
              />
            {:else}
              <span class="row-no">{card.card_no}</span>
            {/if}
          </div>
          <div class="row-info">
            <span class="row-name">{card.card_name ?? card.card_no}</span>
            <span class="row-no-text">
              {card.card_no}{card.card_no_extend ? ` · ${card.card_no_extend}` : ''}
            </span>
            {#if card.ownedTotal > 0}
              <span class="row-owned"
                >{$t('locker.ownedBadge', { values: { count: card.ownedTotal } })}</span
              >
            {/if}
          </div>
          <label class="qty-field">
            <span>{$t('locker.quantity')}</span>
            <input
              class="qty-input"
              type="number"
              min="1"
              value={card.quantity}
              onchange={(e) =>
                void changeQty(card, Number((e.currentTarget as HTMLInputElement).value) || 1)}
            />
          </label>
          <button
            class="mini-btn danger"
            title={$t('locker.removeCard')}
            onclick={() => void removeCard(card)}
          >
            <X size={13} />
          </button>
        </div>
      {/each}
    {/if}
  </div>

  {#snippet footer()}
    <button class="button button-primary" onclick={() => (manageOpen = false)}>
      {$t('common.close')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .page-wrapper {
    max-width: 1200px;
    margin: 0 auto;
    padding: calc(16px + env(safe-area-inset-top)) 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }

  .tip {
    padding: 40px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .drawer-panel {
    position: relative;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 12px 16px 12px 20px;
  }

  .drawer-panel::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--drawer-color, var(--accent-color));
  }

  .drawer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .drawer-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--drawer-color, var(--accent-color));
    flex-shrink: 0;
  }

  .drawer-icon {
    width: 20px;
    height: 20px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .drawer-title {
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--text-primary);
  }

  .drawer-desc {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .drawer-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    padding: 1px 8px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
  }

  .drawer-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
  }

  .drawer-tag {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .batch-toggle {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .batch-toggle:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .batch-bar {
    position: sticky;
    top: calc(var(--topbar-height, 48px) + env(safe-area-inset-top) + 8px);
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 16px;
    border-radius: 12px;
    border: 1px solid var(--accent-color);
    background: var(--bg-secondary);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }

  .batch-info {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--accent-color);
  }

  .batch-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .manage-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 380px;
    overflow-y: auto;
  }

  .empty-hint {
    padding: 8px 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .card-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
  }

  .row-thumb {
    flex-shrink: 0;
    width: 44px;
    height: 62px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-hover);
  }

  :global(.row-thumb-src) {
    display: block;
    width: 44px;
    height: 62px;
    object-fit: cover;
  }

  .row-no {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 62px;
    font-size: 9px;
    color: var(--text-secondary);
  }

  .row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-no-text {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .row-owned {
    font-size: 10px;
    color: var(--accent-color);
    font-weight: 600;
  }

  .qty-field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .qty-input {
    width: 52px;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    text-align: center;
  }

  .mini-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .mini-btn.danger {
    color: #ef4444;
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

  .color-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .color-swatch {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .color-swatch.selected {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--bg-primary);
  }

  .color-default {
    display: flex;
    align-items: center;
    justify-content: center;
    width: auto;
    padding: 0 10px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
  }

  .color-default-text {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  @media (max-width: 600.99px) {
    .page-wrapper {
      padding: 12px 16px 24px;
    }
  }
</style>
