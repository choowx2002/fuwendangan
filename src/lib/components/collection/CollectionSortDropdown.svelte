<script lang="ts">
  import type { CollectionSort, CollectionSortKey } from '$lib/db'
  import { ArrowDownAZ, ArrowUpAZ, ChevronDown } from '@lucide/svelte'

  let {
    sort = { key: 'card_no', isAsc: true } as CollectionSort,
    onChange = undefined as ((sort: CollectionSort) => void) | undefined,
  } = $props()

  const OPTIONS: { key: CollectionSortKey; label: string }[] = [
    { key: 'card_no', label: '卡号' },
    { key: 'rarity', label: '稀有度' },
    { key: 'owned', label: '持有数' },
    { key: 'progress', label: '进度' },
  ]

  let open = $state(false)

  const currentLabel = $derived(OPTIONS.find((o) => o.key === sort.key)?.label ?? '卡号')
</script>

<div class="sort-dropdown">
  <button class="sort-trigger" onclick={() => (open = !open)}>
    <span>排序：{currentLabel}</span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="dir-toggle"
      title={sort.isAsc ? '升序' : '降序'}
      onclick={(e) => {
        e.stopPropagation()
        onChange?.({ key: sort.key, isAsc: !sort.isAsc })
      }}
    >
      {#if sort.isAsc}
        <ArrowUpAZ size={15} />
      {:else}
        <ArrowDownAZ size={15} />
      {/if}
    </span>
    <span class="chevron" class:rotated={open}>
      <ChevronDown size={14} />
    </span>
  </button>

  {#if open}
    <div class="menu">
      {#each OPTIONS as opt (opt.key)}
        <button
          class="menu-item"
          class:active={sort.key === opt.key}
          onclick={() => {
            onChange?.({ key: opt.key, isAsc: sort.key === opt.key ? !sort.isAsc : opt.key === 'card_no' })
            open = false
          }}
        >
          {opt.label}
          {#if sort.key === opt.key}
            {sort.isAsc ? '↑' : '↓'}
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sort-dropdown {
    position: relative;
  }

  .sort-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .sort-trigger:hover {
    border-color: var(--accent-color);
  }

  .dir-toggle {
    display: inline-flex;
    color: var(--text-secondary);
  }

  .dir-toggle:hover {
    color: var(--accent-color);
  }

  .rotated {
    transform: rotate(180deg);
  }

  .chevron {
    display: inline-flex;
    transition: transform 0.2s ease;
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    min-width: 130px;
    padding: 4px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .menu-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .menu-item:hover,
  .menu-item.active {
    background: var(--bg-secondary);
  }
</style>
