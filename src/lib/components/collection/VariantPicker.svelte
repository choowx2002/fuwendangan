<script lang="ts">
  import { onMount } from 'svelte'
  import { Search, LoaderCircle } from '@lucide/svelte'
  import { searchCardVariants, type VariantWithOwned } from '$lib/db'
  import CommonModal from '../ui/CommonModal.svelte'
  import { t } from '$lib/i18n'

  interface Props {
    open: boolean
    onClose: () => void
    onSelect: (variant: VariantWithOwned) => void
    /** 仅列出收藏中已拥有的卡牌（借出场景） */
    ownedOnly?: boolean
  }

  let { open, onClose, onSelect, ownedOnly = false }: Props = $props()

  let text = $state('')
  let results = $state<VariantWithOwned[]>([])
  let loading = $state(false)
  let searched = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function scheduleSearch() {
    clearTimeout(timer)
    searched = false
    if (!text.trim()) {
      results = []
      return
    }
    timer = setTimeout(() => void runSearch(), 250)
  }

  async function runSearch() {
    loading = true
    try {
      const res = await searchCardVariants({
        searchText: text.trim(),
        pageSize: 30,
        ownership: ownedOnly ? 'owned' : 'all',
      })
      results = res.data
      searched = true
    } finally {
      loading = false
    }
  }

  function pick(variant: VariantWithOwned) {
    text = ''
    results = []
    onSelect(variant)
  }

  onMount(() => {
    scheduleSearch()
  })
</script>

<CommonModal
  {open}
  title={$t('wishlist.pickCard')}
  subtitle={$t(ownedOnly ? 'loans.ownedOnlyHint' : 'wishlist.pickCardHint')}
  width="min(560px, 100%)"
  onclose={onClose}
>
  <div class="picker-search">
    <Search size={15} />
    <input
      class="picker-input"
      placeholder={$t('wishlist.searchPlaceholder')}
      bind:value={text}
      oninput={scheduleSearch}
      onkeydown={(e) => {
        if (e.key === 'Enter' && results.length > 0) pick(results[0])
        if (e.key === 'Escape') onClose()
      }}
    />
    {#if loading}
      <LoaderCircle size={14} class="animate-spin" />
    {/if}
  </div>

  <div class="picker-results">
    {#if results.length === 0}
      <div class="picker-empty">
        {loading ? '' : searched ? $t('cards.noResults') : $t('wishlist.typeToSearch')}
      </div>
    {:else}
      {#each results as v (v.cardNo + '|' + v.cardNoExtend)}
        <button class="picker-row" onclick={() => pick(v)}>
          <div class="picker-row-main">
            <span class="picker-name">{v.card_name_cn || v.cardNo}</span>
            <span class="picker-extend">{v.cardNoExtend}</span>
          </div>
          {#if v.extendRarityName}
            <span class="picker-rarity">{v.extendRarityName}</span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</CommonModal>

<style>
  .picker-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .picker-input {
    flex: 1;
    min-width: 0;
    padding: 9px 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .picker-search :global(.lucide) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .picker-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 320px;
    overflow-y: auto;
  }

  .picker-empty {
    padding: 24px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .picker-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }

  .picker-row:hover {
    background: var(--bg-hover);
  }

  .picker-row-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .picker-name {
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker-extend {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    flex-shrink: 0;
    font-family: monospace;
  }

  .picker-rarity {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    flex-shrink: 0;
  }
</style>
