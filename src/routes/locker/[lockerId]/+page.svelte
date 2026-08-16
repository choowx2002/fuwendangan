<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import type { LockerDetail } from '$lib/db'
  import { getLockerDetail, createSection } from '$lib/db'
  import { Plus } from '@lucide/svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import TagInput from '$lib/components/ui/TagInput.svelte'
  import LockerListView from '$lib/components/locker/LockerListView.svelte'
  import LockerIconPicker from '$lib/components/locker/LockerIconPicker.svelte'
  import { t } from '$lib/i18n'

  const lockerId = page.params.lockerId ?? ''

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

  let detail = $state<LockerDetail | null>(null)
  let loading = $state(true)

  let sectionModalOpen = $state(false)
  let sectionName = $state('')
  let sectionDesc = $state('')
  let sectionColor = $state<string | null>(null)
  let sectionIcon = $state<string | null>(null)
  let sectionTags = $state<string[]>([])

  async function load() {
    loading = true
    try {
      detail = await getLockerDetail(lockerId)
    } finally {
      loading = false
    }
  }

  function openSectionCreate() {
    sectionName = ''
    sectionDesc = ''
    sectionColor = null
    sectionIcon = null
    sectionTags = []
    sectionModalOpen = true
  }

  async function saveSection() {
    if (!sectionName.trim()) return
    await createSection(lockerId, {
      name: sectionName.trim(),
      description: sectionDesc.trim() || undefined,
      color: sectionColor,
      icon: sectionIcon,
      tags: sectionTags,
    })
    sectionModalOpen = false
    void load()
  }

  function openNode(id: string) {
    void goto(`/locker/${lockerId}/${id}`)
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: detail?.locker.name ?? $t('locker.title'),
      onBack: () => goto('/locker'),
      actions: [
        {
          key: 'section',
          label: $t('locker.newSection'),
          icon: Plus,
          title: $t('locker.newSection'),
          onClick: openSectionCreate,
        },
      ],
    })
  })
</script>

<div class="detail-page">
  {#if loading && !detail}
    <div class="tip">{$t('common.loading')}</div>
  {:else if !detail}
    <div class="tip">{$t('common.notFound')}</div>
  {:else if detail.sections.length === 0}
    <div class="empty-state">
      <span class="empty-title">{$t('locker.noSections')}</span>
      <button class="button button-primary" onclick={openSectionCreate}>
        <Plus size={14} />
        {$t('locker.newSection')}
      </button>
    </div>
  {:else}
    <LockerListView sections={detail.sections} onSectionClick={openNode} />
  {/if}
</div>

<CommonModal
  open={sectionModalOpen}
  title={$t('locker.newSection')}
  width="min(440px, 100%)"
  onclose={() => (sectionModalOpen = false)}
>
  <div class="form">
    <label class="field">
      <span class="field-label">{$t('locker.sectionName')}</span>
      <input
        class="input"
        bind:value={sectionName}
        placeholder={$t('locker.sectionNamePlaceholder')}
      />
    </label>
    <label class="field">
      <span class="field-label">{$t('locker.sectionDesc')}</span>
      <input class="input" bind:value={sectionDesc} />
    </label>
    <div class="field">
      <span class="field-label">{$t('locker.drawerColor')}</span>
      <div class="color-row">
        <button
          class="color-swatch color-default"
          class:selected={sectionColor === null}
          title={$t('locker.colorDefault')}
          onclick={() => (sectionColor = null)}
        >
          <span class="color-default-text">{$t('locker.colorDefault')}</span>
        </button>
        {#each DRAWER_COLORS as color (color)}
          <button
            class="color-swatch"
            class:selected={sectionColor === color}
            style={`background: ${color}`}
            title={color}
            onclick={() => (sectionColor = color)}
          ></button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span class="field-label">{$t('locker.icon')}</span>
      <LockerIconPicker value={sectionIcon} onChange={(v) => (sectionIcon = v)} />
    </div>
    <label class="field">
      <span class="field-label">{$t('locker.tags')}</span>
      <TagInput
        value={sectionTags}
        placeholder={$t('locker.tagPlaceholder')}
        onChange={(v) => (sectionTags = v)}
      />
    </label>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (sectionModalOpen = false)}>
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" disabled={!sectionName.trim()} onclick={saveSection}>
      {$t('locker.save')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .detail-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: calc(12px + env(safe-area-inset-top)) 24px 24px;
    gap: 12px;
    min-height: 0;
  }

  .tip {
    padding: 40px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .empty-title {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
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
    .detail-page {
      padding: 10px 12px 16px;
    }
  }
</style>
